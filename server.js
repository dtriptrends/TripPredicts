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
// Returns BOTH `games` (last 15, what the card displays) and `gamesFull` (up to
// 40, what the scoring engine uses for season averages and volatility). The
// scoring engine needs the longer window: you cannot detect a shaded line
// without knowing what the player's normal season looks like.
async function ballGamelog(player, lg, sport) {
  const searchTerm = player.trim().split(' ').slice(-1)[0]
  const pData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/players?search=${encodeURIComponent(searchTerm)}`)
  const players = pData.data || []
  if (players.length === 0) return { player, league: lg, games: [], gamesFull: [], note: 'Player not found in stats database.' }

  const lowerFull = player.trim().toLowerCase()
  let match = players.find(p => `${p.first_name} ${p.last_name}`.toLowerCase() === lowerFull)
  if (!match) match = players.find(p => (p.full_name || '').toLowerCase() === lowerFull)
  if (!match) match = players[0]

  let gamesFull = []
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
      gamesFull = statRows
        .filter(g => bdlPlayed(g, lg))
        .map(g => ({ ...g, date: dateMap[g.game_id] || null }))
        .filter(g => g.date) // regular season only (spring training game_ids aren't in the map)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 40)
    }
  } else {
    const sData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/${sport.statsPath}?player_ids[]=${match.id}&seasons[]=${sport.season}&per_page=100`)
    gamesFull = (sData.data || [])
      .filter(g => bdlPlayed(g, lg))
      .map(g => ({ ...g, date: rowDate(g) }))
      .sort((a, b) => gameSortKey(b) - gameSortKey(a))
      .slice(0, 40)
  }
  const games = gamesFull.slice(0, 15)
  return {
    player: `${match.first_name} ${match.last_name}`,
    player_id: match.id,
    league: lg,
    games,
    gamesFull,
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
  if (p.includes('fantasy') || /\bfs\b/.test(p)) return null // weighted formula we can't verify; skip, don't fake

  if (league === 'WNBA') {
    const pts = +g.pts || 0, reb = +g.reb || 0, ast = +g.ast || 0
    const stl = +g.stl || 0, blk = +g.blk || 0
    const oreb = +g.oreb || 0, dreb = +g.dreb || 0
    const fg3m = +g.fg3m || 0, fg3a = +g.fg3a || 0
    const fgm = +g.fgm || 0, fga = +g.fga || 0
    const ftm = +g.ftm || 0, fta = +g.fta || 0
    const tov = +g.turnover || 0, pf = +g.pf || 0
    const isAtt = p.includes('attempt') || /\b(3pta|fga|fta|pta)\b/.test(p)
    const hasPts = p.includes('point') || p.includes('pts')
    const hasReb = p.includes('rebound') || p.includes('reb')
    const hasAst = p.includes('assist') || p.includes('ast')
    if (hasPts && hasReb && hasAst) return pts + reb + ast
    if (hasPts && hasReb) return pts + reb
    if (hasPts && hasAst) return pts + ast
    if (hasReb && hasAst) return reb + ast
    if ((p.includes('blk') || p.includes('block')) && (p.includes('stl') || p.includes('steal'))) return blk + stl
    if (p.includes('three') || p.includes('3-pt') || p.includes('3pt') || p.includes('3 pt') || p.includes('3-point')) return isAtt ? fg3a : fg3m
    if (p.includes('free throw') || /\bft[ma]\b/.test(p)) return isAtt ? fta : ftm
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
      if (p.includes('pitches thrown') || p.includes('pitch count')) return +g.pitch_count || 0
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

// ===== SCORING ENGINE v2 — analyze first, rate after =====
// Raw hit rate is no longer the model. It is one input. Every verifiable prop
// is scored from three weighted components plus a trap detector:
//
//   1) SHRUNK HIT RATE (45%) — the recent hit rate pulled toward 50% based on
//      sample size. 14 of 15 raw is 93%, but 15 games is a tiny sample, so it
//      shrinks to ~76%. A streak can no longer masquerade as a lock.
//   2) PROJECTION EDGE (35%) — blended season + last-10 average vs the line,
//      normalized by the player's own game-to-game volatility. This is the
//      question that actually matters: is the LINE beatable, not was it beaten.
//   3) AVAILABILITY (20%) — their last logged game must be recent. A player
//      who hasn't appeared in days is an injury/rest risk and cannot gold.
//
//   TRAP DETECTOR — an 85%+ streak over the last 15 combined with a line set
//   well past the player's season average means the book has already priced
//   the streak in. Constant greens are the eye candy PrizePicks wants bettors
//   chasing. Those picks get flagged trapRisk, penalized 20 points, and are
//   never gold-eligible.
//
// Tunable knobs, all in one place:
const SHRINK_PRIOR = 10           // phantom 50/50 games blended into the hit rate
const TRAP_STREAK = 0.85          // recent-15 hit rate that counts as eye candy
const TRAP_LINE_INFLATION = 1.12  // line 12%+ past the season avg = book adjusted
const W_HITRATE = 0.45
const W_EDGE = 0.35
const W_AVAIL = 0.20

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0 }
function stdev(a) {
  if (a.length < 2) return 1
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1))
}

// games must be sorted most-recent-first. Returns null when the prop can't be
// verified from real data (unmapped stat, or fewer than 10 usable games).
function scoreProp(games, league, statLabel, L) {
  const rows = (games || [])
    .map(g => ({ v: bdlStatValueServer(league, g, statLabel), date: g.date || null }))
    .filter(r => r.v != null && !isNaN(r.v))
  if (rows.length < 10) return null

  const vals = rows.map(r => r.v)
  const recent15 = vals.slice(0, 15)
  const recent10 = vals.slice(0, 10)

  const seasonMean = mean(vals)             // up to 40 games of context
  const recentMean = mean(recent10)
  const proj = 0.6 * seasonMean + 0.4 * recentMean
  const sd = Math.max(stdev(vals), 0.5)     // floor so tiny-variance stats don't explode the edge

  // Pre-streak baseline for the trap check. The hot streak itself inflates
  // the season mean, so comparing the line against it would hide exactly the
  // shading we're hunting. Games OLDER than the last 15 are the player's true
  // level before the book started chasing the streak. Fewer than 8 older
  // games: fall back to the season mean (early-season, nothing better exists).
  const older = vals.slice(15)
  const baseline = older.length >= 8 ? mean(older) : seasonMean

  // Availability proxy: last logged game must be recent for this sport's cadence.
  const withDate = rows.find(r => r.date)
  const staleDays = league === 'MLB' ? 4 : 7
  let avail = 0.7 // rows without dates: neither credit nor kill it
  if (withDate) {
    const daysSince = (Date.now() - new Date(withDate.date).getTime()) / 86400000
    avail = daysSince <= staleDays ? 1 : 0.4
  }

  const sides = ['HIGHER', 'LOWER'].map(dir => {
    const hits15 = recent15.filter(v => dir === 'HIGHER' ? v > L : v < L).length
    const rawRecent = hits15 / recent15.length
    const shrunk = (hits15 + SHRINK_PRIOR * 0.5) / (recent15.length + SHRINK_PRIOR)
    const edgeRaw = dir === 'HIGHER' ? proj - L : L - proj
    const edgeScore = Math.max(-1, Math.min(1, edgeRaw / sd))
    // Trap: hot streak AND the line already shaded past the pre-streak
    // baseline in the streak's direction. That combination = the book moved first.
    const inflated = dir === 'HIGHER'
      ? L >= baseline * TRAP_LINE_INFLATION
      : L <= baseline * (2 - TRAP_LINE_INFLATION)
    const trap = rawRecent >= TRAP_STREAK && inflated
    let score = 100 * (W_HITRATE * shrunk + W_EDGE * (0.5 + edgeScore / 2) + W_AVAIL * avail)
    if (trap) score -= 20
    if (edgeRaw <= 0) score -= 8 // hit-rate side contradicts the projection
    return { dir, score, rawRecent, hits15, n15: recent15.length, trap, edgeRaw }
  })

  sides.sort((a, b) => b.score - a.score)
  const best = sides[0]
  return {
    dir: best.dir,
    score: Math.max(1, Math.min(99, Math.round(best.score))),
    hit: best.hits15,
    total: best.n15,
    rawPct: Math.round(best.rawRecent * 100),
    trap: best.trap,
    proj: Math.round(proj * 10) / 10,
    seasonAvg: Math.round(seasonMean * 10) / 10,
    baseline: Math.round(baseline * 10) / 10,
    edge: Math.round(best.edgeRaw * 10) / 10,
    avail,
    // Gold demands everything: no trap, projection agrees, player active.
    goldEligible: !best.trap && best.edgeRaw > 0 && avail === 1
  }
}

// The fix for AI direction contradicting the data. For MLB/WNBA picks with a
// real sample, direction and confidence come from the scoring engine, not the
// AI's blind guess. Picks with fewer than 10 verifiable games are left alone
// (the card hides their chart anyway).
const REAL_GROUND_LEAGUES = ['MLB', 'WNBA']
async function groundPicks(picks) {
  await Promise.all(picks.map(async p => {
    const lg = (p.league || '').toUpperCase()
    if (!REAL_GROUND_LEAGUES.includes(lg)) return
    try {
      const L = parseFloat(p.val)
      if (isNaN(L)) return
      const gl = await getGamelog(p.name, lg)
      const games = (gl && (gl.gamesFull || gl.games)) || []
      const s = scoreProp(games, lg, p.stat, L)
      if (!s) return
      p.dir = s.dir
      p.conf = s.score
      p.realHit = s.hit
      p.realTotal = s.total
      p.trapRisk = s.trap || undefined
      p.proj = s.proj
      p.seasonAvg = s.seasonAvg
      p.record = `${s.hit} of last ${s.total} cleared · projects ${s.proj} vs line ${L}`
      if (s.trap) {
        p.bull = `The streak is real (${s.hit} of ${s.total}) but the line has been raised to the streak, not the player. His baseline before the hot stretch is ${s.baseline}.`
        p.bear = `TRAP RISK: this line sits well above his baseline of ${s.baseline}. The book has priced the hot stretch in, and regression usually follows.`
      } else {
        p.bull = `Model backs the ${s.dir === 'HIGHER' ? 'over' : 'under'}: projects ${s.proj} against ${L} (${s.edge > 0 ? '+' : ''}${s.edge} edge), with ${s.hit} of the last ${s.total} clearing it.`
        p.bear = `Season average is ${s.seasonAvg}. A tough matchup, lineup change, or rest day can move this. Confidence is already shrunk for the short sample.`
      }
    } catch (e) { /* leave the pick untouched on any error */ }
  }))
  return picks
}

// Run an async fn over items with bounded concurrency so a big slate doesn't
// fire 50 gamelog fetches at once.
async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

// Gold floor per league, applied to the COMPOSITE score (not raw hit rate).
// The composite is deliberately harder to max out: a genuinely strong pick
// lands ~80-90, a decent one ~70-75, a trap lands in the 30s-50s. WNBA keeps
// a slightly lower bar since its slates are smaller. This function is the
// ONLY source of truth, used by the scanner, the AI fallback, and the final
// gate, so the three can never disagree.
function goldFloorFor(lg) {
  if (lg === 'WNBA') return 70
  if (lg === 'MLB') return 75
  return 90
}

// Build a frontend-shaped pick straight from the scoring engine's output.
function buildRealPick(l, lg, s) {
  const name = l.name
  const initials = (name || 'XX').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  const ou = s.dir === 'HIGHER' ? 'over' : 'under'
  const trapBull = `The streak is real (${s.hit} of ${s.total}) but the line has been raised to the streak, not the player. His baseline before the hot stretch is ${s.baseline}.`
  const trapBear = `TRAP RISK: this line sits well above his baseline of ${s.baseline}. The book has priced the hot stretch in, and regression usually follows.`
  const normBull = `Model backs the ${ou}: projects ${s.proj} against ${l.line} (${s.edge > 0 ? '+' : ''}${s.edge} edge), with ${s.hit} of the last ${s.total} clearing it.`
  const normBear = `Season average is ${s.seasonAvg}. A tough matchup, lineup change, or rest day can move this. Confidence is already shrunk for the short sample.`
  return {
    id: `real-${lg}-${name}-${l.stat}-${l.line}`.replace(/\s+/g, '_'),
    name,
    meta: `${lg}${l.team ? ' · ' + l.team : ''}`,
    stat: l.stat,
    val: String(l.line),
    dir: s.dir,
    conf: s.score,
    sport: lg,
    league: lg,
    initials,
    image: l.image || null,
    bull: s.trap ? trapBull : normBull,
    bear: s.trap ? trapBear : normBear,
    record: `${s.hit} of last ${s.total} cleared · projects ${s.proj} vs line ${l.line}`,
    cats: [{ n: l.stat, p: s.score }],
    time: l.start_time || null,
    date: l.date || null,
    oddsType: l.oddsType || null,
    altLines: l.altLines || null,
    realHit: s.hit,
    realTotal: s.total,
    trapRisk: s.trap || undefined,
    proj: s.proj,
    seasonAvg: s.seasonAvg
  }
}

// The real engine for MLB/WNBA. Walk the actual slate, pull ONE gamelog per
// player, score every verifiable prop through the v2 engine, and return picks
// at or above floorPct, strongest first. When requireGoldEligible is true
// (the /gold route), traps, negative-edge picks, and availability question
// marks are excluded entirely — the Tonight board still shows them with their
// penalized score and TRAP language so users learn what a shaded line looks like.
async function realScan(lines, league, floorPct, maxPerPlayer = 2, maxTotal = 20, requireGoldEligible = false) {
  const lg = league.toUpperCase()
  const cands = (lines || []).filter(l =>
    (l.league || '').toUpperCase() === lg && l.name && l.stat && l.line != null &&
    (!l.oddsType || l.oddsType === 'standard') &&
    !l.name.includes('+'))  // combo props (two players) can't be verified from one game log
  if (!cands.length) return []

  const byPlayer = {}
  cands.forEach(l => { (byPlayer[l.name] = byPlayer[l.name] || []).push(l) })
  const names = Object.keys(byPlayer).slice(0, 50) // bound the fetch fan-out

  const collected = []
  await mapLimit(names, 8, async name => {
    try {
      const gl = await getGamelog(name, lg)
      const games = (gl && (gl.gamesFull || gl.games)) || []
      if (games.length < 10) return
      const picks = []
      const seenStat = new Set()
      for (const l of byPlayer[name]) {
        const statKey = String(l.stat).toLowerCase()
        if (seenStat.has(statKey)) continue
        const L = parseFloat(l.line)
        if (isNaN(L)) continue
        const s = scoreProp(games, lg, l.stat, L)
        if (!s) continue
        seenStat.add(statKey)
        if (s.score < floorPct) continue
        if (requireGoldEligible && !s.goldEligible) continue
        picks.push(buildRealPick(l, lg, s))
      }
      picks.sort((a, b) => b.conf - a.conf)
      collected.push(...picks.slice(0, maxPerPlayer))
    } catch (e) { /* skip this player on any error */ }
  })

  collected.sort((a, b) => b.conf - a.conf)
  return collected.slice(0, maxTotal)
}

// Log every gold pick to Supabase so the model's real record is tracked over
// time. Fire-and-forget: a missing table or a network blip never blocks the
// response. Duplicate calls on the same slate are absorbed by the unique
// constraint (player, stat, line, dir, game_date).
async function logGoldPicks(picks) {
  if (!picks || !picks.length) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const rows = picks.map(p => ({
      player: p.name,
      league: p.league,
      stat: p.stat,
      line: parseFloat(p.val) || null,
      dir: p.dir,
      score: p.conf,
      real_hit: p.realHit ?? null,
      real_total: p.realTotal ?? null,
      trap: !!p.trapRisk,
      analysis_status: p.analysisStatus || null,
      game_date: p.date || today
    }))
    await supabaseAdmin.from('gold_pick_log').upsert(rows, {
      onConflict: 'player,stat,line,dir,game_date',
      ignoreDuplicates: true
    })
  } catch (e) {
    console.error('Pick log skipped:', e.message)
  }
}

// ===== GOLD AUTO-ANALYSIS =====
// After the scoring engine selects gold candidates, a single web-search pass
// checks tonight's reality for each one: opponent, injury/lineup status,
// anything the game logs can't see. The model NEVER re-rates picks itself.
// It returns a status per player and the SERVER applies the adjustment:
//   CONFIRMED — found active/starting tonight, no red flags. Rating stands,
//               pick is pairing-eligible.
//   CAUTION   — questionable tag, bad matchup news, or no status found.
//               Rating -10, stays on the board, excluded from pairings.
//   OUT       — ruled out or team not playing. Pick removed entirely.
const ANALYZE_TOP_N = 12

async function analyzeGoldPicks(picks, currentTime) {
  const targets = picks.slice(0, ANALYZE_TOP_N)
  if (!targets.length) return picks
  const list = targets.map(p =>
    `- ${p.name} (${p.league}${p.team ? ' · ' + p.team : ''}): ${p.stat} ${p.dir === 'HIGHER' ? 'over' : 'under'} ${p.val}`
  ).join('\n')

  const userMsg = `Current time: ${currentTime || new Date().toISOString()} ET

These are tonight's model-selected picks. For EACH player, search for who they play today or tonight and their current injury or lineup status. Base status ONLY on what you actually find in search results, never on memory.

${list}

Status rules:
- "CONFIRMED": you found evidence they are active/starting tonight with no injury designation
- "CAUTION": questionable or day-to-day tag, unfavorable news (elite opposing pitcher, minutes concern, weather delay risk), OR you could not find current status
- "OUT": ruled out, not in the lineup, or their team does not play in the next 36 hours

Respond with ONLY this JSON array as your final message, nothing before or after it, no markdown fences:
[{"name":"exact player name from the list","status":"CONFIRMED","note":"1 sentence: opponent tonight and what you found"}]`

  let messages = [{ role: 'user', content: userMsg }]
  let finalText = ''
  try {
    for (let i = 0; i < 6; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 14 }],
          system: `You verify sports betting picks against tonight's reality. Use web search for every player on the list. Never state injury or lineup information you did not actually find via search. Output ONLY the requested JSON array as your final answer, nothing else.`,
          messages
        })
      })
      const data = await r.json()
      if (!data.content) throw new Error(data.error?.message || 'No content')
      finalText += data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (data.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: data.content }]
        continue
      }
      break
    }
  } catch (e) {
    console.error('Gold analysis skipped:', e.message)
    return picks // an analysis failure must never blank the gold board
  }

  const start = finalText.indexOf('[')
  const end = finalText.lastIndexOf(']')
  if (start === -1 || end === -1) return picks
  let results
  try { results = JSON.parse(finalText.slice(start, end + 1)) } catch (e) { return picks }
  const byName = {}
  results.forEach(r => { if (r && r.name) byName[r.name.toLowerCase()] = r })

  const out = []
  for (const p of picks) {
    const r = byName[(p.name || '').toLowerCase()]
    if (!r) { p.analysisStatus = 'UNANALYZED'; out.push(p); continue }
    const status = String(r.status || '').toUpperCase()
    const note = r.note || ''
    if (status === 'OUT') { console.log('Dropped (OUT):', p.name, '-', note); continue }
    p.baseScore = p.conf
    p.analysisNote = note || null
    if (status === 'CONFIRMED') {
      p.analysisStatus = 'CONFIRMED'
      if (note) p.bull = `${p.bull} Verified tonight: ${note}`
    } else {
      p.analysisStatus = 'CAUTION'
      p.conf = Math.max(1, p.conf - 10)
      p.cats = [{ n: p.stat, p: p.conf }]
      if (note) p.bear = `CAUTION: ${note} ${p.bear}`
    }
    out.push(p)
  }
  return out
}

// ===== PAIRING ENGINE =====
// The strongest 2-man combos, built ONLY from analysis-CONFIRMED picks.
// Rules: never two legs from the same team (one bad team night kills both),
// prefer legs from different leagues/games for independence, rank by the
// combined rate treating legs as independent. A 2-leg Power Play pays 3x,
// so the breakeven is ~33% combined. Anything shown well above that is a
// genuine edge IF the ratings are honest, which is the whole point of v2.
function teamOf(p) {
  if (p.team) return String(p.team).toUpperCase()
  const parts = String(p.meta || '').split('·')
  return parts.length > 1 ? parts[1].trim().toUpperCase() : null
}

function buildPairs(picks, maxPairs = 3) {
  const elig = picks.filter(p => p.analysisStatus === 'CONFIRMED')
  const pairs = []
  for (let i = 0; i < elig.length; i++) {
    for (let j = i + 1; j < elig.length; j++) {
      const a = elig[i], b = elig[j]
      const ta = teamOf(a), tb = teamOf(b)
      if (ta && tb && ta === tb) continue // same team = correlated failure
      const combined = Math.round((a.conf / 100) * (b.conf / 100) * 100)
      const sameSlot = a.league === b.league && a.time && a.time === b.time
      const rank = combined + (a.league !== b.league ? 2 : 0) - (sameSlot ? 3 : 0)
      pairs.push({
        rank,
        combined,
        legs: [a, b].map(p => ({
          id: p.id, name: p.name, league: p.league, team: teamOf(p),
          stat: p.stat, val: p.val, dir: p.dir, conf: p.conf
        })),
        why: `${a.name} (${a.conf}) + ${b.name} (${b.conf})` +
          (a.league !== b.league ? ' · independent leagues' : '') +
          (sameSlot ? ' · may share a game window' : '')
      })
    }
  }
  pairs.sort((x, y) => y.rank - x.rank)
  return pairs.slice(0, maxPairs).map(({ rank, ...p }) => p)
}

// Gold responses are cached per league so the tab opens instantly after the
// first build. The full pipeline (scan -> analyze -> pair) runs at most once
// per 30 minutes per league.
let goldCache = {}
const GOLD_CACHE_TTL = 30 * 60 * 1000

// AI pick generation for sports WITHOUT real data. MLB/WNBA are handled by the
// scanner and excluded here.
async function aiPicks(currentTime, lines, league, rawLines, mode, pickCount) {
  if (!lines.length) return []
  const linesText = lines.map(l =>
    `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`
  ).join('\n')

  const gold = mode === 'gold'
  const spreadRule = league
    ? (gold ? `All picks must be from ${league}.` : `All picks must be from ${league}. Select the best ${pickCount} picks from the lines above.`)
    : (gold
      ? `Prioritize NBA, NHL, NFL, esports. Spread across AT LEAST 2 different leagues. Max 2 picks per league.`
      : `Select the best ${pickCount} picks. Spread across AT LEAST 3 different sports or leagues. Max 2 picks from the same league. Prioritize NBA, NHL, NFL, esports.`)

  const goldBody = `Current time: ${currentTime} ET

These are REAL live PrizePicks lines. Find the highest confidence picks at 90%+ confidence only. Copy line numbers exactly — never change them:

${spreadRule}

${linesText}

Find your top picks where you are genuinely 90%+ confident based on recent player performance and matchup. Only assign 90%+ confidence when genuinely warranted.

Output ONLY this JSON array:
[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":92,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason why this hits","bear":"real risk factor","record":"Hit this line in 12 of his last 15 games","cats":[{"n":"stat name","p":92}]}]

Rules:
- Copy line numbers EXACTLY — never change them
- conf must be 90 or above — never assign below 90 on this endpoint
- dir is HIGHER or LOWER based on real statistical evidence — never guess
- Vary stat categories. Mix in 3-pointers made, shot attempts, steals, blocks, turnovers and other categories
- NEVER pick the same player twice
- Return only picks you genuinely believe, even if that is a short list`

  const tonightBody = `Current time: ${currentTime} ET

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
- Vary stat categories. Mix in 3-pointers made, shot attempts, steals, blocks, turnovers and others
- NEVER pick the same player more than once
- Give exactly ${pickCount} picks`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
      messages: [{ role: 'user', content: gold ? goldBody : tonightBody }]
    })
  })

  const data = await response.json()
  if (!data.content) return []
  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock) return []
  const start = textBlock.text.indexOf('[')
  const end = textBlock.text.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  let parsed
  try { parsed = JSON.parse(textBlock.text.slice(start, end + 1)) } catch (e) { return [] }
  const grounded = await groundPicks(validateLines(dedupe(normalizePicks(parsed)), rawLines))
  return grounded
}

app.post('/picks', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league, count = 6 } = req.body
    const lines = sortLines(rawLines, league)
    const pickCount = Math.min(count, 10, lines.length)
    console.log('Analyzing', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const reqLeague = league ? league.toUpperCase() : null
    const REAL = ['MLB', 'WNBA']
    let picks = []

    // Real-data scanner for MLB/WNBA (lower floor than gold so the board has
    // range — traps show up here with their penalized score and TRAP language).
    const scanLgs = reqLeague ? (REAL.includes(reqLeague) ? [reqLeague] : []) : REAL
    for (const lg of scanLgs) {
      const scanned = await realScan(rawLines, lg, 60, 2, 15, false)
      picks = picks.concat(scanned)
      // If WNBA real scanner is empty (e.g. all combo props), fall through to AI
      // so the board still has WNBA cards.
      if (lg === 'WNBA' && scanned.length === 0) {
        const wnbaLines = rawLines.filter(l => (l.league || '').toUpperCase() === 'WNBA')
        if (wnbaLines.length > 0) {
          const wnbaAI = await aiPicks(currentTime, wnbaLines, 'WNBA', rawLines, 'tonight', pickCount)
          picks = picks.concat(wnbaAI)
          console.log('WNBA real scanner empty — AI fallback, got', wnbaAI.length, 'picks')
        }
      }
    }

    // AI for everything else. Exclude MLB/WNBA so the AI never guesses them.
    const doAI = reqLeague ? !REAL.includes(reqLeague) : true
    if (doAI) {
      const aiLines = reqLeague ? lines : lines.filter(l => !REAL.includes((l.league || '').toUpperCase()))
      picks = picks.concat(await aiPicks(currentTime, aiLines, reqLeague, rawLines, 'tonight', pickCount))
    }

    picks.sort((a, b) => b.conf - a.conf)
    picks = picks.slice(0, 40)
    console.log('Got', picks.length, 'picks (', picks.filter(p => REAL.includes(p.league)).length, 'real,', picks.filter(p => p.trapRisk).length, 'flagged trap )')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/gold', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league } = req.body

    // Serve from cache when the full pipeline ran recently for this league.
    const goldKey = (league || 'ALL').toUpperCase()
    const gc = goldCache[goldKey]
    if (gc && Date.now() - gc.ts < GOLD_CACHE_TTL) {
      console.log('Serving gold from cache for', goldKey)
      return res.json(gc.data)
    }

    const lines = sortLines(rawLines, league)
    console.log('Finding gold from', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const reqLeague = league ? league.toUpperCase() : null
    const REAL = ['MLB', 'WNBA']
    let picks = []

    // Gold from real data: strongest verified plays, gold-eligible only. That
    // means no trap flags, projection must agree with the streak side, and the
    // player must have appeared recently. The board earns its gold now.
    const scanLgs = reqLeague ? (REAL.includes(reqLeague) ? [reqLeague] : []) : REAL
    for (const lg of scanLgs) {
      const floor = goldFloorFor(lg)
      const scanned = await realScan(rawLines, lg, floor, 2, 20, true)
      picks = picks.concat(scanned)
      // If real scanner came back empty for WNBA (e.g. all combo props tonight),
      // fall back to AI so the board isn't blank. Grounding still rescores any
      // verifiable pick through the same engine, and traps are stripped below.
      if (lg === 'WNBA' && scanned.length === 0) {
        const wnbaLines = rawLines.filter(l => (l.league || '').toUpperCase() === 'WNBA')
        if (wnbaLines.length > 0) {
          const wnbaAI = await aiPicks(currentTime, wnbaLines, 'WNBA', rawLines, 'gold')
          picks = picks.concat(wnbaAI.filter(p => p.conf >= goldFloorFor('WNBA')))
          console.log('WNBA real scanner empty — used AI fallback, got', wnbaAI.length, 'picks')
        }
      }
    }

    // AI gold for sports without real data (MLB/WNBA excluded so no blind guesses).
    const doAI = reqLeague ? !REAL.includes(reqLeague) : true
    if (doAI) {
      const aiLines = reqLeague ? lines : lines.filter(l => !REAL.includes((l.league || '').toUpperCase()))
      const aiGold = await aiPicks(currentTime, aiLines, reqLeague, rawLines, 'gold')
      picks = picks.concat(aiGold.filter(p => p.conf >= 90)) // non-real sports keep the 90% bar
    }

    // Final gate: every pick must clear its floor AND carry no trap flag,
    // regardless of how it got here.
    picks = picks.filter(p => p.conf >= goldFloorFor((p.league || '').toUpperCase()) && !p.trapRisk)

    picks.sort((a, b) => b.conf - a.conf)
    picks = picks.slice(0, 30)
    console.log('Got', picks.length, 'gold picks (', picks.filter(p => REAL.includes(p.league)).length, 'real ) — analyzing tonight\'s status')

    // Stage 2: auto-verify tonight's reality (opponent, injuries, lineups) for
    // the top picks, then re-rate. OUT picks are removed, CAUTION picks are
    // docked 10 and blocked from pairing, CONFIRMED picks keep their rating
    // and earn a verified note on the card.
    picks = await analyzeGoldPicks(picks, currentTime)
    picks.sort((a, b) => b.conf - a.conf)

    // Stage 3: the strongest 2-man pairings from confirmed legs only.
    const pairs = buildPairs(picks)

    console.log('Final board:', picks.length, 'picks,',
      picks.filter(p => p.analysisStatus === 'CONFIRMED').length, 'confirmed,',
      picks.filter(p => p.analysisStatus === 'CAUTION').length, 'caution,',
      pairs.length, 'pairings')

    // Track the record: every gold pick that reaches the board gets logged
    // with its FINAL (post-analysis) rating.
    logGoldPicks(picks)

    const payload = { picks, pairs }
    goldCache[goldKey] = { data: payload, ts: Date.now() }
    res.json(payload)
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
          system: `You are the Trip Predicts AI analyst for PrizePicks. You have real live prop lines provided to you. Always use the exact line numbers from the data — never change them. Prioritize NBA, MLB, NHL, NFL, and esports. Only recommend WNBA or niche sports if explicitly asked. Look for clear statistical edges — recent form, matchup advantages, usage rates, pace of play. Be suspicious of hot streaks: a player who has cleared a line in 13 or 14 of his last 15 games usually has a line that was already raised to match the streak, which makes it a regression trap, not a lock. Only recommend picks from games in the next 36 hours. Never recommend the same player twice. Spread picks across multiple sports — never more than 2 from the same league. When recommending direction, commit to it based on data. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Never use em dashes. Bold key info with **text**.`,
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

// Analyze a multi-leg parlay. The combined hit rate is computed HERE from the
// real numbers already on each pick, never invented by the model. Claude's
// job is web search: today's matchup and current status for each player,
// stated only when it's actually found, never guessed from stale training
// knowledge. web_search_20250305 is a server-executed tool, Anthropic runs
// the search and hands back real results in the same response; it does not
// pause for the client to fulfill a tool call the way custom tools do.
app.post('/parlay-analysis', async (req, res) => {
  try {
    const { picks, currentTime } = req.body
    if (!picks || !picks.length) throw new Error('No picks provided')
    if (picks.length > 6) throw new Error('Max 6 legs per parlay')

    let combinedRate = 1
    let allRatesKnown = true
    const trapLegs = picks.filter(p => p.trapRisk).map(p => p.name)
    const legContext = picks.map(p => {
      let rate = null, rateLabel = 'unknown'
      if (p.realHit != null && p.realTotal) {
        rate = p.realHit / p.realTotal
        rateLabel = `${p.realHit} of last ${p.realTotal} games hit this line, verified real BALLDONTLIE data${p.trapRisk ? ' — FLAGGED AS TRAP RISK: line sits well above this player\'s season average, the book has priced the streak in' : ''}`
      } else if (p.conf != null) {
        rate = p.conf / 100
        rateLabel = `${p.conf}% per the AI model, NOT independently verified against game logs`
      } else {
        allRatesKnown = false
      }
      if (rate != null) combinedRate *= rate
      return `- ${p.name} (${p.league}${p.team ? ' · ' + p.team : ''}): ${p.stat} ${p.dir === 'HIGHER' ? 'over' : 'under'} ${p.val}. Historical rate: ${rateLabel}.`
    }).join('\n')

    const combinedPct = allRatesKnown ? Math.round(combinedRate * 100) : null

    const userMsg = `Current time: ${currentTime} ET

A user is building this ${picks.length}-leg parlay:

${legContext}

${combinedPct != null
  ? `The combined hit rate if every leg is independent is ${combinedPct}%, calculated directly from the historical rates above. Reference this exact number in your summary. Do not calculate or state a different one.`
  : `Not every leg has a verified historical rate, so no combined number was calculated. Do not invent one.`}
${trapLegs.length ? `\nThe following legs are flagged TRAP RISK and the verdict cannot be "Strong" while any of them remain: ${trapLegs.join(', ')}.` : ''}

For EACH player, search for who they are playing today or tonight and their current injury or lineup status. State status information only when you actually find it in a search result. If you cannot confirm current status, say so plainly, for example "no recent injury report found," instead of guessing from memory.

After researching all ${picks.length} legs, respond with ONLY this JSON object as your final message, nothing before or after it, no markdown fences:
{"verdict":"Strong or Moderate or Risky","summary":"2-3 sentences on the overall parlay, referencing the combined rate if one was given","legs":[{"name":"player name","note":"1-2 sentences: opponent tonight, current status if found, and any risk factor"}]}`

    let messages = [{ role: 'user', content: userMsg }]
    let finalText = ''
    for (let i = 0; i < 6; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
          system: `You are a sports betting parlay analyst. Use web search to check today's matchups and each player's current status before giving a verdict. Never state injury or lineup information you did not actually find via search. Output ONLY the requested JSON as your final answer, nothing else.`,
          messages
        })
      })
      const data = await r.json()
      if (!data.content) throw new Error(data.error?.message || 'No content from AI')
      finalText += data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (data.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: data.content }]
        continue
      }
      break
    }

    const start = finalText.indexOf('{')
    const end = finalText.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('Could not parse the analysis, try again')
    const parsed = JSON.parse(finalText.slice(start, end + 1))

    res.json({
      verdict: parsed.verdict || null,
      summary: parsed.summary || null,
      legs: Array.isArray(parsed.legs) ? parsed.legs : [],
      combinedRate: combinedPct
    })
  } catch (e) {
    console.error('Parlay analysis error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`Trip Predicts server running on port ${PORT}`))