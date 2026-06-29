console.log('SERVER STARTING - node is running')
import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(cors())

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

let ppCache = { data: null, ts: 0 }
const CACHE_TTL = 5 * 60 * 1000

// Stripe webhook MUST come before express.json() — needs the raw body
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.client_reference_id
      const customerId = session.customer
      const subscriptionId = session.subscription
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      await supabaseAdmin.from('subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      console.log('Subscription activated for user', userId)
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      await supabaseAdmin.from('subscriptions').update({
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }).eq('stripe_subscription_id', sub.id)
      console.log('Subscription', sub.id, 'updated to', sub.status)
    }
  } catch (e) {
    console.error('Webhook handler error:', e.message)
  }

  res.json({ received: true })
})

// JSON middleware comes AFTER the webhook
app.use(express.json({ limit: '10mb' }))

// ===== REAL STATS FROM BALLDONTLIE =====
const BDL_KEY = process.env.BALLDONTLIE_KEY

// path          = BDL league slug (note: Counter-Strike is "cs", not "cs2")
// statsPath      = per-game stats endpoint. Differs per sport and was the WNBA 404:
//                 MLB is /stats, WNBA is /player_stats.
// needsGameDates = MLB stat rows carry no date and /mlb/v1/stats has no date,
//                 sort, or season_type filter, so it mixes spring training in with
//                 the regular season. We join real dates from /mlb/v1/games
//                 (season_type=regular) to order by date and drop spring training.
//                 WNBA rows already carry a real game.date, so no join needed.
// kind           = which fetch strategy to use. ball sports (MLB/WNBA) have a
//                 player-centric stats endpoint. LoL has player_match_map_stats
//                 with a player_id filter (one call). CS2 has no player endpoint,
//                 so we go player -> team -> recent matches -> per-match stats.
//                 LoL and CS2 stat logs require the GOAT tier.
const BDL_SPORTS = {
  MLB:  { path: 'mlb',  statsPath: 'stats',        season: 2026, supported: true, needsGameDates: true,  kind: 'ball' },
  WNBA: { path: 'wnba', statsPath: 'player_stats', season: 2026, supported: true, needsGameDates: false, kind: 'ball' },
  LOL:  { path: 'lol',  supported: true, kind: 'lol' },
  CS2:  { path: 'cs',   supported: true, kind: 'cs' },
}

const gamelogCache = {}
const GAMELOG_TTL = 60 * 60 * 1000 // 1 hour

async function bdlFetch(url) {
  const r = await fetch(url, { headers: { Authorization: BDL_KEY } })
  if (!r.ok) throw new Error(`BDL ${r.status}`)
  return r.json()
}

// Pull every row across pages (cursor pagination), capped so one slow player
// can't fan out forever. Three pages of 100 covers a full MLB season.
async function bdlFetchAll(baseUrl, maxPages = 3) {
  let all = []
  let cursor = null
  for (let i = 0; i < maxPages; i++) {
    const url = cursor ? `${baseUrl}&cursor=${cursor}` : baseUrl
    const r = await bdlFetch(url)
    all = all.concat(r.data || [])
    cursor = r.meta && r.meta.next_cursor
    if (!cursor || !(r.data || []).length) break
  }
  return all
}

// Recency key for WNBA, whose rows carry a nested game object with a real date.
function gameSortKey(row) {
  if (row.game && row.game.date) return new Date(row.game.date).getTime()
  if (row.game && row.game.id) return Number(row.game.id) || 0
  return 0
}

// Pull a usable date string off a WNBA row for the normalized `date` field.
function rowDate(row) {
  if (row.game && row.game.date) return row.game.date
  return null
}

// Drop did-not-play rows so a DNP never counts as a miss in a hit-rate.
function bdlPlayed(row, lg) {
  if (lg === 'WNBA') return (Number(row.min) || 0) > 0
  if (lg === 'MLB') {
    const pa = Number(row.plate_appearances) || 0
    const ab = Number(row.at_bats) || 0
    const outs = Number(row.pitching_outs) || 0   // innings are recorded as outs
    const bf = Number(row.batters_faced) || 0
    const pc = Number(row.pitch_count) || 0
    return pa > 0 || ab > 0 || outs > 0 || bf > 0 || pc > 0
  }
  return true
}

// MLB / WNBA: player-centric stats endpoint. MLB needs the date join described
// above; WNBA carries game.date already.
async function ballGamelog(player, lg, sport) {
  const searchTerm = player.trim().split(' ').slice(-1)[0]
  const pData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/players?search=${encodeURIComponent(searchTerm)}`)
  const players = pData.data || []
  if (players.length === 0) return { player, league: lg, games: [], note: 'Player not found in stats database.' }

  const lowerFull = player.trim().toLowerCase()
  let match = players.find(p => `${p.first_name} ${p.last_name}`.toLowerCase() === lowerFull)
  if (!match) match = players.find(p => (p.full_name || '').toLowerCase() === lowerFull)
  if (!match) match = players[0]

  let games = []
  if (sport.needsGameDates) {
    const teamId = match.team && match.team.id
    if (teamId) {
      // Date map from the team's regular-season games (also strips spring training).
      const gameRows = await bdlFetchAll(`https://api.balldontlie.io/${sport.path}/v1/games?seasons[]=${sport.season}&team_ids[]=${teamId}&season_type=regular&per_page=100`)
      const dateMap = {}
      gameRows.forEach(g => { if (g.id && g.date) dateMap[g.id] = g.date })
      // The player's full season stat rows, using single-value params that the
      // API honors reliably (the old game_ids[] list collapsed to one game).
      const statRows = await bdlFetchAll(`https://api.balldontlie.io/${sport.path}/v1/${sport.statsPath}?player_ids[]=${match.id}&seasons[]=${sport.season}&per_page=100`)
      games = statRows
        .filter(g => bdlPlayed(g, lg))
        .map(g => ({ ...g, date: dateMap[g.game_id] || null }))
        .filter(g => g.date) // regular season only (spring training game_ids aren't in the map)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 15)
    }
  } else {
    const sData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/${sport.statsPath}?player_ids[]=${match.id}&seasons[]=${sport.season}&per_page=100`)
    games = (sData.data || [])
      .filter(g => bdlPlayed(g, lg))
      .map(g => ({ ...g, date: rowDate(g) }))
      .sort((a, b) => gameSortKey(b) - gameSortKey(a))
      .slice(0, 15)
  }
  return {
    player: `${match.first_name} ${match.last_name}`,
    player_id: match.id,
    league: lg,
    games,
    note: games.length ? `${games.length} recent games from BALLDONTLIE.` : 'No recent games found for this season.'
  }
}

// LoL: one call. player_match_map_stats accepts a player_id filter and returns
// per-map (per-game) rows directly. No date on the row, so we order by row id
// (auto-increment) as a recency proxy. Each row is one map of one match.
async function lolGamelog(player, lg) {
  const term = player.trim()
  const pData = await bdlFetch(`https://api.balldontlie.io/lol/v1/players?search=${encodeURIComponent(term)}`)
  const players = pData.data || []
  if (!players.length) return { player, league: lg, games: [], note: 'Player not found in LoL database.' }
  const lower = term.toLowerCase()
  const match = players.find(p => (p.nickname || '').toLowerCase() === lower) || players[0]

  const sData = await bdlFetch(`https://api.balldontlie.io/lol/v1/player_match_map_stats?player_id=${match.id}&per_page=100`)
  const games = (sData.data || [])
    .map(g => ({
      kills: g.kills, deaths: g.deaths, assists: g.assists,
      creep_score: g.creep_score, gold_earned: g.gold_earned,
      damage: g.total_damage_dealt_to_champions,
      kill_participation: g.kill_participation,
      wards_placed: g.wards_placed,
      champion: g.champion && g.champion.name,
      match_map_id: g.match_map_id,
      _order: g.id || g.match_map_id || 0,
      date: null
    }))
    .sort((a, b) => (b._order || 0) - (a._order || 0))
    .slice(0, 20)
  return {
    player: match.nickname,
    player_id: match.id,
    league: lg,
    games,
    note: games.length ? `${games.length} recent maps from BALLDONTLIE.` : 'No recent maps found.'
  }
}

// CS2: no player-centric endpoint. Find the player, get their team, list the
// team's recent matches, then pull per-match player stats one match at a time.
// These are match totals (summed across the maps played in that match).
async function csGamelog(player, lg) {
  const term = player.trim()
  const pData = await bdlFetch(`https://api.balldontlie.io/cs/v1/players?search=${encodeURIComponent(term)}`)
  const players = pData.data || []
  if (!players.length) return { player, league: lg, games: [], note: 'Player not found in CS2 database.' }
  const lower = term.toLowerCase()
  const match = players.find(p => (p.nickname || '').toLowerCase() === lower) || players[0]
  const teamId = match.team && match.team.id
  if (!teamId) return { player: match.nickname, player_id: match.id, league: lg, games: [], note: 'No team on record for this player.' }

  const mData = await bdlFetch(`https://api.balldontlie.io/cs/v1/matches?team_ids[]=${teamId}&per_page=25`)
  const matches = (mData.data || [])
    .filter(m => m.id)
    .sort((a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0))
    .slice(0, 10) // bound the per-match fan-out

  const games = []
  for (const m of matches) {
    try {
      const sData = await bdlFetch(`https://api.balldontlie.io/cs/v1/player_match_stats?match_id=${m.id}`)
      const row = (sData.data || []).find(r => r.player && r.player.id === match.id)
      if (row) {
        const mapsPlayed = (Number(m.team1_score) || 0) + (Number(m.team2_score) || 0)
        games.push({
          kills: row.kills, deaths: row.deaths, assists: row.assists,
          adr: row.adr, kast: row.kast, rating: row.rating,
          headshot_percentage: row.headshot_percentage,
          first_kills: row.first_kills, first_deaths: row.first_deaths,
          maps_played: mapsPlayed > 0 ? mapsPlayed : 1,
          match_id: m.id,
          date: m.start_time || null
        })
      }
    } catch (e) { /* skip a match that has no stats yet */ }
  }
  games.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  return {
    player: match.nickname,
    player_id: match.id,
    league: lg,
    games,
    note: games.length ? `${games.length} recent matches from BALLDONTLIE (match totals).` : 'No recent matches found.'
  }
}

app.post('/player-gamelog', async (req, res) => {
  try {
    const { player, league } = req.body
    if (!player) throw new Error('No player provided')
    const lg = (league || '').toUpperCase()
    const sport = BDL_SPORTS[lg]
    if (!sport) return res.json({ player, league: lg, games: [], note: `${lg} stats not available yet.` })
    if (!sport.supported) return res.json({ player, league: lg, games: [], supported: false, note: sport.reason })

    const cacheKey = `${lg}|${player.trim().toLowerCase()}`
    const cached = gamelogCache[cacheKey]
    if (cached && Date.now() - cached.ts < GAMELOG_TTL) return res.json(cached.data)

    let payload
    if (sport.kind === 'lol') payload = await lolGamelog(player, lg)
    else if (sport.kind === 'cs') payload = await csGamelog(player, lg)
    else payload = await ballGamelog(player, lg, sport)

    gamelogCache[cacheKey] = { data: payload, ts: Date.now() }
    res.json(payload)
  } catch (e) {
    console.error('Gamelog error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

function sortLines(rawLines, league) {
  if (!rawLines) return []
  const PRIORITY = { 'NBA': 1, 'MLB': 2, 'NHL': 3, 'NFL': 4, 'CS2': 5, 'LOL': 5, 'VALORANT': 5, 'COD': 5 }
  if (league) {
    return rawLines.filter(l => (l.league || '').toUpperCase() === league.toUpperCase()).slice(0, 100)
  }
  const groups = {}
  rawLines.forEach(l => {
    const lg = (l.league || 'OTHER').toUpperCase()
    if (!groups[lg]) groups[lg] = []
    groups[lg].push(l)
  })
  const sorted = Object.entries(groups).sort(([a], [b]) => (PRIORITY[a] || 99) - (PRIORITY[b] || 99))
  const result = []
  const perSport = Math.max(5, Math.floor(80 / sorted.length))
  sorted.forEach(([, lines]) => result.push(...lines.slice(0, perSport)))
  return result.slice(0, 100)
}

function normalizePicks(raw) {
  return raw.map((p, i) => ({
    id: p.id || i + 1,
    name: p.name || 'Unknown Player',
    meta: p.meta || `${p.sport || ''} · ${p.team || ''}`,
    stat: p.stat || 'Points',
    val: String(p.val || p.line || '0'),
    dir: (() => {
      const d = (p.dir || 'HIGHER').toUpperCase()
      if (d.includes('MORE') || d.includes('OVER') || d.includes('HIGHER')) return 'HIGHER'
      if (d.includes('LESS') || d.includes('UNDER') || d.includes('LOWER')) return 'LOWER'
      return 'HIGHER'
    })(),
    conf: Number(p.conf || p.confidence || 75),
    sport: p.sport || 'Sport',
    league: p.league || p.sport || 'Sport',
    initials: p.initials || (p.name || 'XX').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(),
    bull: p.bull || 'Strong pick based on current form.',
    bear: p.bear || 'Variance possible.',
    record: p.record || null,
    cats: p.cats || [{ n: p.stat || 'Points', p: Number(p.conf || 75) }],
    time: p.time || null,
    date: p.date || null
  }))
}

function dedupe(picks) {
  const seen = new Set()
  return picks.filter(p => {
    const key = p.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function validateLines(picks, rawLines) {
  if (!rawLines || rawLines.length === 0) return picks
  return picks.map(p => {
    const nameMatches = rawLines.filter(l => l.name.toLowerCase() === p.name.toLowerCase())
    let match = null
    if (nameMatches.length) {
      const statMatches = nameMatches.filter(l => l.stat.toLowerCase() === p.stat.toLowerCase())
      const pool = statMatches.length ? statMatches : nameMatches
      const target = parseFloat(p.val)
      if (!isNaN(target) && pool.length > 1) {
        // pin to the real board line closest to the value the AI returned, so a
        // shared stat name (or partial-game line) can never show the wrong number
        match = pool.reduce((best, l) =>
          Math.abs(Number(l.line) - target) < Math.abs(Number(best.line) - target) ? l : best)
      } else {
        match = pool[0]
      }
    }
    if (match) {
      p.val = String(match.line)
      p.stat = match.stat
      p.league = match.league || p.league
      p.team = match.team || p.team
      if (match.start_time) p.time = match.start_time
      if (match.date) p.date = match.date
      if (match.oddsType) p.oddsType = match.oddsType
      if (match.altLines) p.altLines = match.altLines
    }
    return p
  })
}

app.get('/prizepicks/all', async (req, res) => {
  try {
    const now = Date.now()
    if (ppCache.data && now - ppCache.ts < CACHE_TTL) {
      console.log('Serving PrizePicks from cache')
      return res.json(ppCache.data)
    }
    const target = encodeURIComponent(`https://api.prizepicks.com/projections?per_page=250&single_stat=true`)
    const response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}&ultra_premium=true`)
    const data = await response.json()
    ppCache = { data, ts: now }
    res.json(data)
  } catch (e) {
    if (ppCache.data) return res.json(ppCache.data)
    res.status(500).json({ error: e.message })
  }
})

app.get('/prizepicks/:leagueId', async (req, res) => {
  try {
    const { leagueId } = req.params
    const target = encodeURIComponent(`https://api.prizepicks.com/projections?league_id=${leagueId}&per_page=50&single_stat=true`)
    const response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}&ultra_premium=true`)
    const data = await response.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/stripe/create-checkout', async (req, res) => {
  try {
    const { userId, email } = req.body
    if (!userId || !email) throw new Error('Missing user info')

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: userId,
      customer_email: email,
      success_url: 'https://trip-predicts.vercel.app?sub=success',
      cancel_url: 'https://trip-predicts.vercel.app?sub=cancel'
    })

    res.json({ url: session.url })
  } catch (e) {
    console.error('Checkout error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Server-side copy of the card's stat mapping (MLB + WNBA only), kept in sync
// so the grounded confidence equals the hit rate the card draws.
function bdlStatValueServer(league, g, propLabel) {
  const p = String(propLabel || '').toLowerCase()

  if (league === 'WNBA') {
    const pts = +g.pts || 0, reb = +g.reb || 0, ast = +g.ast || 0
    const stl = +g.stl || 0, blk = +g.blk || 0
    const oreb = +g.oreb || 0, dreb = +g.dreb || 0
    const fg3m = +g.fg3m || 0, fg3a = +g.fg3a || 0
    const fgm = +g.fgm || 0, fga = +g.fga || 0
    const ftm = +g.ftm || 0, fta = +g.fta || 0
    const tov = +g.turnover || 0, pf = +g.pf || 0
    const isAtt = p.includes('attempt')
    const hasPts = p.includes('point') || p.includes('pts')
    const hasReb = p.includes('rebound') || p.includes('reb')
    const hasAst = p.includes('assist') || p.includes('ast')
    if (hasPts && hasReb && hasAst) return pts + reb + ast
    if (hasPts && hasReb) return pts + reb
    if (hasPts && hasAst) return pts + ast
    if (hasReb && hasAst) return reb + ast
    if ((p.includes('blk') || p.includes('block')) && (p.includes('stl') || p.includes('steal'))) return blk + stl
    if (p.includes('three') || p.includes('3-pt') || p.includes('3pt') || p.includes('3 pt') || p.includes('3-point')) return isAtt ? fg3a : fg3m
    if (p.includes('free throw')) return isAtt ? fta : ftm
    if (p.includes('field goal') || (p.includes('fg') && !p.includes('fg3'))) return isAtt ? fga : fgm
    if (p.includes('offensive') && hasReb) return oreb
    if (p.includes('defensive') && hasReb) return dreb
    if (p.includes('turnover')) return tov
    if (p.includes('foul')) return pf
    if (p.includes('steal')) return stl
    if (p.includes('block')) return blk
    if (hasReb) return reb
    if (hasAst) return ast
    if (hasPts) return pts
    return null
  }

  if (league === 'MLB') {
    if (p.includes('pitch') || p.includes('allowed') || p.includes('earned run')) {
      if (p.includes('strikeout') || p.includes('strike out')) return +g.p_k || 0
      if (p.includes('hit')) return +g.p_hits || 0
      if (p.includes('earned run')) return +g.er || 0
      if (p.includes('walk')) return +g.p_bb || 0
      if (p.includes('out')) return +g.pitching_outs || 0
      return null
    }
    const hits = +g.hits || 0, runs = +g.runs || 0, rbi = +g.rbi || 0
    const hr = +g.hr || 0, doubles = +g.doubles || 0, triples = +g.triples || 0
    if (p.includes('hits') && p.includes('runs') && p.includes('rbi')) return hits + runs + rbi
    if (p.includes('total base')) return +g.total_bases || 0
    if (p.includes('home run')) return hr
    if (p.includes('stolen')) return +g.stolen_bases || 0
    if (p.includes('single')) return Math.max(0, hits - doubles - triples - hr)
    if (p.includes('double')) return doubles
    if (p.includes('triple')) return triples
    if (p.includes('walk')) return +g.bb || 0
    if (p.includes('rbi')) return rbi
    if (p.includes('run')) return runs
    if (p.includes('strikeout') || p === 'k') return +g.k || 0
    if (p.includes('at bat') || p.includes('at-bat')) return +g.at_bats || 0
    if (p.includes('hit')) return hits
    return null
  }

  return null
}

// Cached gamelog fetch shared by the route and the grounding step.
async function getGamelog(player, lg) {
  const sport = BDL_SPORTS[lg]
  if (!sport || !sport.supported) return { games: [] }
  const cacheKey = `${lg}|${player.trim().toLowerCase()}`
  const cached = gamelogCache[cacheKey]
  if (cached && Date.now() - cached.ts < GAMELOG_TTL) return cached.data
  let payload
  if (sport.kind === 'lol') payload = await lolGamelog(player, lg)
  else if (sport.kind === 'cs') payload = await csGamelog(player, lg)
  else payload = await ballGamelog(player, lg, sport)
  gamelogCache[cacheKey] = { data: payload, ts: Date.now() }
  return payload
}

// The fix for AI direction contradicting the data. For MLB/WNBA picks with a
// real sample, the direction and confidence come from the game logs, not the
// AI's blind guess. We bet the side the player actually hits more often, and
// the confidence IS the real hit rate. Picks with fewer than 10 games are left
// alone (the card hides their chart anyway).
const REAL_GROUND_LEAGUES = ['MLB', 'WNBA']
async function groundPicks(picks) {
  await Promise.all(picks.map(async p => {
    const lg = (p.league || '').toUpperCase()
    if (!REAL_GROUND_LEAGUES.includes(lg)) return
    try {
      const L = parseFloat(p.val)
      if (isNaN(L)) return
      const gl = await getGamelog(p.name, lg)
      const vals = ((gl && gl.games) || [])
        .map(g => bdlStatValueServer(lg, g, p.stat))
        .filter(v => v != null && !isNaN(v))
      if (vals.length < 10) return
      const over = vals.filter(v => v > L).length
      const under = vals.filter(v => v < L).length
      const total = vals.length
      const dir = over >= under ? 'HIGHER' : 'LOWER'
      const hit = dir === 'HIGHER' ? over : under
      const pct = Math.round((hit / total) * 100)
      p.dir = dir
      p.conf = pct
      p.realHit = hit
      p.realTotal = total
      p.record = `${hit} of last ${total} games cleared this line`
      p.bull = `Real game logs back the ${dir === 'HIGHER' ? 'over' : 'under'} here. The line was cleared in ${hit} of the last ${total} games (${pct}%).`
      p.bear = `This is the last ${total} games only. A tough matchup, a lineup or rotation change, or a short rest day could move it.`
    } catch (e) { /* leave the pick untouched on any error */ }
  }))
  return picks
}

app.post('/picks', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league, count = 6 } = req.body
    const lines = sortLines(rawLines, league)
    const pickCount = Math.min(count, 10, lines.length)
    console.log('Analyzing', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const linesText = lines.map(l =>
      `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`
    ).join('\n')

    const spreadRule = league
      ? `All picks must be from ${league}. Select the best ${pickCount} picks from the lines above.`
      : `Select the best ${pickCount} picks. Spread across AT LEAST 3 different sports or leagues. Max 2 picks from the same league. Prioritize NBA, MLB, NHL, NFL, esports over WNBA or niche sports.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{
          role: 'user',
          content: `Current time: ${currentTime} ET

These are REAL live PrizePicks lines. Use ONLY these exact player names and exact line numbers — copy the number after the colon exactly, do not change it:

${linesText}

${spreadRule}

For each pick, determine direction (HIGHER or LOWER) based on concrete statistical evidence. Once you decide a direction, commit to it.

Output ONLY this JSON array:
[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":88,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason","bear":"real risk","record":"12 of last 15 games cleared this line","cats":[{"n":"stat","p":88}]}]

Rules:
- Copy the line number EXACTLY — never change it
- dir must be HIGHER or LOWER based on clear statistical evidence
- conf is 50-95
- record: short specific statement like "11 of last 14 games hit this line"
- Vary stat categories. Do not lean only on points and rebounds. Mix in props like 3-pointers made, shot attempts, steals, blocks, turnovers, total bases, strikeouts and others when the lines and form support them
- NEVER pick the same player more than once
- Give exactly ${pickCount} picks`
        }]
      })
    })

    const data = await response.json()
    if (!data.content) throw new Error(data.error?.message || 'No content')
    const textBlock = data.content.find(b => b.type === 'text')
    if (!textBlock) throw new Error('No response')

    const start = textBlock.text.indexOf('[')
    const end = textBlock.text.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('Please retry in a moment.')

    const picks = await groundPicks(validateLines(dedupe(normalizePicks(JSON.parse(textBlock.text.slice(start, end + 1)))), rawLines))
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/gold', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league } = req.body
    const lines = sortLines(rawLines, league)
    console.log('Finding gold from', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const linesText = lines.map(l =>
      `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`
    ).join('\n')

    const spreadRule = league
      ? `All picks must be from ${league}.`
      : `Prioritize NBA, MLB, NHL, NFL, esports. Spread across AT LEAST 2 different leagues. Max 2 picks per league.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{
          role: 'user',
          content: `Current time: ${currentTime} ET

These are REAL live PrizePicks lines. Find the highest confidence picks at 90%+ confidence only. Copy line numbers exactly — never change them:

${spreadRule}

${linesText}

Find your top 4-6 picks where you are genuinely 90%+ confident based on recent player performance and matchup. You MUST return at least 3 picks — never return an empty array. Only assign 90%+ confidence when genuinely warranted by recent stats and form.

Output ONLY this JSON array:
[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":92,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason why this hits","bear":"real risk factor","record":"Hit this line in 12 of his last 15 games","cats":[{"n":"stat name","p":92}]}]

Rules:
- Copy line numbers EXACTLY — never change them
- conf must be 90 or above — never assign below 90 on this endpoint
- dir is HIGHER or LOWER based on real statistical evidence — never guess
- record: MUST be specific like "Hit in 11 of last 14 games" or "Averaged well above this line over last 10 games"
- Vary stat categories when the data supports it. Do not lean only on points and rebounds. Mix in 3-pointers made, shot attempts, steals, blocks, turnovers, total bases, strikeouts and other categories
- NEVER pick the same player twice
- Always return at least 3 picks`
        }]
      })
    })

    const data = await response.json()
    if (!data.content) throw new Error(data.error?.message || 'No content')
    const textBlock = data.content?.find(b => b.type === 'text')
    if (!textBlock) throw new Error('No response from AI')

    const start = textBlock.text.indexOf('[')
    const end = textBlock.text.lastIndexOf(']')
    if (start === -1 || end === -1) return res.json({ picks: [] })

    const parsed = JSON.parse(textBlock.text.slice(start, end + 1))
    const grounded = await groundPicks(validateLines(dedupe(normalizePicks(parsed)), rawLines))
    const picks = grounded.filter(p => p.conf >= 90)
    console.log('Got', picks.length, 'gold picks')
    res.json({ picks })
  } catch (e) {
    console.error('Gold error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/chat', async (req, res) => {
  try {
    const { messages, currentTime, lines } = req.body
    const linesText = lines ? lines.slice(0, 30).map(l => `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.start_time}`).join('\n') : ''
    const lastMsg = messages[messages.length - 1]?.content || ''
    let current = [...messages]
    current[current.length - 1] = {
      role: 'user',
      content: `Current time: ${currentTime} ET\n\n${lastMsg}\n\nLive PrizePicks lines right now:\n${linesText}`
    }

    for (let i = 0; i < 10; i++) {
      if (i > 0) await sleep(3000)
      const res2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are the Trip Predicts AI analyst for PrizePicks. You have real live prop lines provided to you. Always use the exact line numbers from the data — never change them. Prioritize NBA, MLB, NHL, NFL, and esports. Only recommend WNBA or niche sports if explicitly asked. Look for clear statistical edges — recent form, matchup advantages, usage rates, pace of play. Only recommend picks from games in the next 36 hours. Never recommend the same player twice. Spread picks across multiple sports — never more than 2 from the same league. When recommending direction, commit to it based on data. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Never use em dashes. Bold key info with **text**.`,
          messages: current
        })
      })
      const data = await res2.json()
      if (!data.content) throw new Error('No content')
      if (data.stop_reason === 'tool_use') {
        current = [...current, { role: 'assistant', content: data.content }]
        const toolResults = data.content.filter(b => b.type === 'tool_use').map(t => ({ type: 'tool_result', tool_use_id: t.id, content: `Search done for: ${t.input?.query}` }))
        current = [...current, { role: 'user', content: toolResults }]
        continue
      }
      if (data.stop_reason === 'end_turn') {
        const textBlock = data.content.find(b => b.type === 'text')
        if (textBlock) { res.json({ reply: textBlock.text }); return }
      }
      throw new Error('Unexpected stop')
    }
    throw new Error('Too many turns')
  } catch (e) {
    console.error('Chat error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`Trip Predicts server running on port ${PORT}`))