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
// Model for the per-league AI pick generation only. The analysts stay on
// Sonnet (their web-search judgment is the product), but pick generation for
// leagues with no real data is a candidate for Haiku at roughly a third of
// the token price. Switchable from Railway's Variables tab with no code
// push: set AI_PICKS_MODEL to claude-haiku-4-5 to try it, delete the
// variable to go back.
const AI_PICKS_MODEL = process.env.AI_PICKS_MODEL || 'claude-sonnet-4-6'
let ppCache = { data: null, ts: 0 }
const CACHE_TTL = 5 * 60 * 1000
// ===== REQUEST COALESCING =====
// The anti-stampede layer. When a cache expires and many users refresh at
// once, the first request runs the expensive build and every request that
// arrives while it is in flight AWAITS THE SAME PROMISE instead of paying
// for its own duplicate pipeline. Cost stops scaling with user count and
// becomes a pure function of the cache schedule: one build per board per
// TTL window, whether five people are refreshing or five thousand.
const inflight = {}
function coalesce(key, fn) {
  if (inflight[key]) {
    console.log('Coalescing into in-flight build:', key)
    return inflight[key]
  }
  inflight[key] = (async () => {
    try { return await fn() } finally { delete inflight[key] }
  })()
  return inflight[key]
}
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
// PrizePicks projections responses always carry a top-level data array (plus
// an included array of players). Anything else that happens to parse, a
// challenge page's JSON blob, an error object, an empty shell, must never be
// cached or served as if it were the board.
function validProjections(d) {
  return !!(d && Array.isArray(d.data))
}
// Collapse an HTML/text body into one short log line. Raw slices of a bot
// challenge page were dumping dozens of lines of markup into the Railway
// logs; the page title says everything worth knowing in one line.
function pageSnippet(raw) {
  const t = String(raw).match(/<title[^>]*>([^<]*)<\/title>/i)
  if (t && t[1].trim()) return `HTML page titled "${t[1].trim()}"`
  return String(raw).slice(0, 160).replace(/\s+/g, ' ')
}
// A plain server-side fetch with no headers looks nothing like a browser,
// which is often enough by itself to get flagged. These headers mimic a real
// browser hitting PrizePicks' own app, no proxy needed if this works.
async function tryDirectFetch(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://app.prizepicks.com/',
        'Origin': 'https://app.prizepicks.com'
      }
    })
    if (!response.ok) { console.log('Direct fetch got status', response.status); return null }
    const raw = await response.text()
    try {
      return JSON.parse(raw)
    } catch (e) {
      console.log('Direct fetch returned non-JSON:', pageSnippet(raw))
      return null
    }
  } catch (e) {
    console.log('Direct fetch error:', e.message)
    return null
  } finally {
    clearTimeout(timeout)
  }
}
// Plain request, no premium/ultra_premium/render, exactly the URL shape
// ScraperAPI support confirmed working in their own test (trailing slash
// included). Costs 1 credit instead of the 75 that ultra_premium+render
// burns per attempt, so this goes first. 60s timeout: ScraperAPI's own
// guidance is to allow at least 60s before giving up on a request, their
// side keeps retrying IPs internally for most of that window.
async function tryScraperApiPlain(directUrl) {
  const target = encodeURIComponent(directUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  let response
  try {
    response = await fetch(`https://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${target}`, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`ScraperAPI (plain) returned ${response.status}`)
  const raw = await response.text()
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`ScraperAPI (plain) did not return JSON: ${pageSnippet(raw)}`)
  }
}
// Kept as a fallback in case the plain request stops working again, this is
// the expensive ultra_premium version that was the only option before. 75s
// timeout: ScraperAPI recommends allowing up to 70s for ultra_premium
// requests. The old 45s abort was killing requests mid-flight, which is
// exactly the "This operation was aborted" line the Railway logs showed.
async function tryScraperApiUltraPremium(directUrl) {
  const target = encodeURIComponent(directUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 75000)
  let response
  try {
    response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}&ultra_premium=true`, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`ScraperAPI (ultra_premium) returned ${response.status}`)
  const raw = await response.text()
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`ScraperAPI (ultra_premium) did not return JSON: ${pageSnippet(raw)}`)
  }
}
// A submitted async job that hasn't resolved yet. ScraperAPI's async jobs
// keep retrying in the background for up to 24 hours, they are not meant to
// finish inside a short polling window. So the server submits a job AT MOST
// once, then checks on it (a single, instant status check, never a blocking
// poll loop) on whatever request happens to come in next, for as long as it
// takes. This survives across requests since it's just a module-level var.
let pendingAsyncJob = null // { statusUrl, submittedAt }
async function submitScraperApiAsyncJob(directUrl) {
  const submitRes = await fetch('https://async.scraperapi.com/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.SCRAPER_API_KEY,
      url: directUrl,
      premium: true,
      ultra_premium: true,
      render: true
    })
  })
  if (!submitRes.ok) throw new Error(`ScraperAPI async job submission failed: ${submitRes.status}`)
  const job = await submitRes.json()
  if (!job.statusUrl) throw new Error('ScraperAPI async job did not return a statusUrl')
  return job
}
// One instant check, not a loop. Returns real data if the job finished
// successfully, otherwise null, whether it's still running, failed, or
// nothing was ever submitted. A "still running" result is not an error, it
// just means check again on a future request.
async function checkScraperApiAsyncJob() {
  if (!pendingAsyncJob) return null
  try {
    const res = await fetch(pendingAsyncJob.statusUrl)
    if (!res.ok) { pendingAsyncJob = null; return null }
    const job = await res.json()
    if (job.status === 'finished') {
      pendingAsyncJob = null
      const body = job.response && job.response.body
      const statusCode = job.response && job.response.statusCode
      if (!body || (statusCode && statusCode >= 400)) {
        console.log('ScraperAPI async job finished but with a bad result, status', statusCode)
        return null
      }
      try { return JSON.parse(body) } catch (e) { console.log('ScraperAPI async result was not JSON'); return null }
    }
    if (job.status === 'failed') {
      console.log('ScraperAPI async job failed')
      pendingAsyncJob = null
      return null
    }
    // Still running. This is expected and not an error, these jobs keep
    // retrying in the background for up to 24h against a well-defended
    // target. Leave it in place for a future request to check again.
    const ageSec = Math.round((Date.now() - pendingAsyncJob.submittedAt) / 1000)
    console.log(`ScraperAPI async job still running (submitted ${ageSec}s ago)`)
    return null
  } catch (e) {
    console.log('ScraperAPI async status check errored:', e.message)
    return null
  }
}
// The full fetch pipeline, extracted so the route can coalesce concurrent
// callers into one run. Returns { code, body } for the route to send.
async function buildPrizePicksBoard() {
    const now = Date.now()
    // Check on a background job before trying anything else, no reason to
    // start over if one's already in flight.
    const asyncResult = await checkScraperApiAsyncJob()
    if (validProjections(asyncResult)) {
      ppCache = { data: asyncResult, ts: now }
      return { code: 200, body: asyncResult }
    }
    const directUrl = `https://api.prizepicks.com/projections?per_page=250&single_stat=true`
    // Same projections feed on PrizePicks' partner host. Community scrapers
    // use it because it has historically carried lighter bot protection than
    // api.prizepicks.com. Free to try before paying ScraperAPI anything.
    const partnerUrl = `https://partner-api.prizepicks.com/projections?per_page=250&single_stat=true`
    // Cheapest and fastest first: free direct fetch against both hosts, then
    // plain ScraperAPI (1 credit) against both hosts, then ultra_premium as
    // the expensive last sync resort. Every result is shape-checked so a
    // challenge page or error blob can never be cached as the board.
    let data = await tryDirectFetch(directUrl)
    if (!validProjections(data)) {
      console.log('Direct fetch failed, trying partner-api host')
      data = await tryDirectFetch(partnerUrl)
    }
    if (!validProjections(data)) {
      console.log('Both direct hosts failed, trying ScraperAPI plain (main host)')
      try {
        data = await tryScraperApiPlain(directUrl)
      } catch (e) {
        console.log('ScraperAPI plain (main) failed:', e.message)
        try {
          console.log('Trying ScraperAPI plain (partner host)')
          data = await tryScraperApiPlain(partnerUrl)
        } catch (e2) {
          console.log('ScraperAPI plain (partner) failed:', e2.message, 'trying ultra_premium')
          try {
            data = await tryScraperApiUltraPremium(directUrl)
          } catch (e3) {
            console.log('ScraperAPI ultra_premium also failed:', e3.message)
          }
        }
      }
    }
    if (!validProjections(data)) data = null
    if (data) {
      ppCache = { data, ts: now }
      return { code: 200, body: data }
    }
    // Both quick attempts failed. Submit a background async job if one isn't
    // already running, don't wait for it, just let it work.
    if (!pendingAsyncJob) {
      try {
        const job = await submitScraperApiAsyncJob(directUrl)
        pendingAsyncJob = { statusUrl: job.statusUrl, submittedAt: Date.now() }
        console.log('Submitted ScraperAPI async job, will check again on future requests')
      } catch (e) {
        console.error('Could not submit ScraperAPI async job:', e.message)
      }
    }
    // Nothing available right now. Serve stale cache if there is any, real
    // data from a while ago beats none. Otherwise say plainly that a
    // background attempt is in progress rather than a hard, confusing error.
    if (ppCache.data) return { code: 200, body: ppCache.data }
    return { code: 202, body: { error: 'Still trying to fetch live lines in the background. Try again in a minute.', pending: true } }
}
app.get('/prizepicks/all', async (req, res) => {
  try {
    if (ppCache.data && Date.now() - ppCache.ts < CACHE_TTL) {
      console.log('Serving PrizePicks from cache')
      return res.json(ppCache.data)
    }
    const out = await coalesce('prizepicks', buildPrizePicksBoard)
    res.status(out.code).json(out.body)
  } catch (e) {
    console.error('PrizePicks fetch error:', e.message)
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
  // Esports lines are usually "MAPS 1-2 Kills" style: a total across the
  // first N maps. LoL rows are per-map and CS2 rows are match totals, so both
  // are normalized to a per-map rate and multiplied by the maps window. This
  // is approximate by design and labeled as such on the card.
  if (league === 'LOL') {
    const f = ppMapsFactor(p)
    if (p.includes('kill') && !p.includes('participation')) return (+g.kills || 0) * f
    if (p.includes('assist')) return (+g.assists || 0) * f
    if (p.includes('death')) return (+g.deaths || 0) * f
    if (p.includes('creep') || /\bcs\b/.test(p)) return (+g.creep_score || 0) * f
    return null
  }
  if (league === 'CS2') {
    const maps = Math.max(1, +g.maps_played || 1)
    const f = ppMapsFactor(p)
    if (p.includes('headshot')) return null // data has a percentage, not a count; skip, don't fake
    if (p.includes('kill') && !p.includes('first')) return ((+g.kills || 0) / maps) * f
    if (p.includes('death')) return ((+g.deaths || 0) / maps) * f
    if (p.includes('assist')) return ((+g.assists || 0) / maps) * f
    return null
  }
  return null
}
// Parse the maps window off a PrizePicks esports label: "MAPS 1-2 Kills" -> 2.
function ppMapsFactor(p) {
  const m = p.match(/maps?\s*1\s*[-\u2013\u2014]\s*(\d)/)
  return m ? Math.max(1, Number(m[1])) : 1
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
// PrizePicks builds standard lines to sit near coin flips. A recent hit rate
// this one-sided on a standard line is the eye candy the book prices in, so
// the streak ALONE is a trap. A line also shaded past the player's pre-streak
// baseline is an aggravator that earns a bigger penalty.
const TRAP_STREAK = 0.80          // recent-15 hit rate that counts as eye candy on its own
const TRAP_LINE_INFLATION = 1.12  // line 12%+ past the baseline = book adjusted
const W_HITRATE = 0.45
const W_EDGE = 0.35
const W_AVAIL = 0.20
// Minimum verifiable games before a prop can be scored. Esports gets a
// slightly lower bar because series come less frequently than ball games.
const MIN_GAMES = { MLB: 10, WNBA: 10, LOL: 8, CS2: 8 }
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
  if (rows.length < (MIN_GAMES[league] || 10)) return null
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
  const staleDays = league === 'MLB' ? 4 : (league === 'WNBA' ? 7 : 14)
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
    const inflated = dir === 'HIGHER'
      ? L >= baseline * TRAP_LINE_INFLATION
      : L <= baseline * (2 - TRAP_LINE_INFLATION)
    // The streak alone traps. A moderately hot run on a shaded line traps too.
    const streaky = rawRecent >= TRAP_STREAK
    const trap = streaky || (rawRecent >= 0.7 && inflated)
    let score = 100 * (W_HITRATE * shrunk + W_EDGE * (0.5 + edgeScore / 2) + W_AVAIL * avail)
    if (trap) score -= (streaky && inflated) ? 30 : 20
    if (edgeRaw <= 0) score -= 8 // hit-rate side contradicts the projection
    return { dir, score, rawRecent, hits15, n15: recent15.length, trap, edgeRaw }
  })
  sides.sort((a, b) => b.score - a.score)
  const best = sides[0]
  // The raw composite tops out in the high 70s/80s by construction. The card
  // and all product copy speak an "80+ = gold" scale, so the score is mapped
  // onto that axis. Monotonic: ordering, gates, and trap flags are decided on
  // the raw value, only the displayed number changes scale.
  const scaled = Math.round(best.score * 1.2)
  return {
    dir: best.dir,
    score: Math.max(1, Math.min(97, scaled)),
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
    // avail 0.7 = rows carry no dates (LoL), which is a data limitation,
    // not an injury signal, so it does not block gold.
    goldEligible: !best.trap && best.edgeRaw > 0 && avail >= 0.7
  }
}
// The fix for AI direction contradicting the data. For MLB/WNBA picks with a
// real sample, direction and confidence come from the scoring engine, not the
// AI's blind guess. Picks with fewer than 10 verifiable games are left alone
// (the card hides their chart anyway).
const REAL_GROUND_LEAGUES = ['MLB', 'WNBA', 'LOL', 'CS2']
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
        p.bull = `The streak is real (${s.hit} of ${s.total}) but constant greens are exactly what the book wants chased. Baseline before the hot stretch: ${s.baseline}.`
        p.bear = `TRAP RISK: ${s.hit} of ${s.total} on a standard line is eye candy. Standard lines are built near coin flips, so a run this clean means regression risk, not value.`
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
// Gold floor per league on the scaled 80+ axis. Raw-score equivalents are
// unchanged (WNBA 68, MLB/esports 72), so selection is identical to before
// the rescale — every pick clearing its floor now also reads as GOLD on the
// card. AI-league picks are model-claimed confidence. This function is the
// ONLY source of truth, used by the scanner, the AI fallback, and both gates.
function goldFloorFor(lg) {
  if (lg === 'WNBA') return 82
  if (lg === 'MLB') return 86
  if (lg === 'LOL' || lg === 'CS2') return 86
  return 82
}
// Build a frontend-shaped pick straight from the scoring engine's output.
function buildRealPick(l, lg, s) {
  const name = l.name
  const initials = (name || 'XX').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  const ou = s.dir === 'HIGHER' ? 'over' : 'under'
  const trapBull = `The streak is real (${s.hit} of ${s.total}) but constant greens are exactly what the book wants chased. Baseline before the hot stretch: ${s.baseline}.`
  const trapBear = `TRAP RISK: ${s.hit} of ${s.total} on a standard line is eye candy. Standard lines are built near coin flips, so a run this clean means regression risk, not value.`
  const normBull = `Model backs the ${ou}: projects ${s.proj} against ${l.line} (${s.edge > 0 ? '+' : ''}${s.edge} edge), with ${s.hit} of the last ${s.total} clearing it.`
  const esports = lg === 'LOL' || lg === 'CS2'
  const normBear = `Season average is ${s.seasonAvg}. A tough matchup, lineup change, or rest day can move this. Confidence is already shrunk for the short sample.` + (esports ? ' Esports values are normalized per map from recent series.' : '')
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
      if (games.length < (MIN_GAMES[lg] || 10)) return
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
// ===== FREE ANALYST CONTEXT (BDL) =====
// The analyst used to burn its whole search budget rediscovering things the
// BALLDONTLIE subscription already knows: who plays tonight, who is home,
// who is on the injury report. This pack pulls all of that from BDL for
// free and hands it to the analyst as verified ground truth, so its limited
// searches go toward the only things search can answer: posted lineups,
// starting pitchers, and late-breaking news.
let analystCtxCache = { ts: 0, text: '' }
const ANALYST_CTX_TTL = 30 * 60 * 1000
async function buildAnalystContext() {
  if (Date.now() - analystCtxCache.ts < ANALYST_CTX_TTL) return analystCtxCache.text
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const sections = []
  for (const lg of ['MLB', 'WNBA']) {
    const sport = BDL_SPORTS[lg]
    const awayField = AWAY_FIELD[lg] || 'away_team'
    try {
      const [g1, g2] = await Promise.all([
        bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/games?dates[]=${today}`),
        bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/games?dates[]=${tomorrow}`)
      ])
      const games = [...(g1.data || []), ...(g2.data || [])]
        .filter(g => g.date && new Date(g.date).getTime() > Date.now() - 6 * 3600000)
      if (games.length) {
        sections.push(`${lg} SCHEDULE (verified):\n` + games.map(g => {
          const away = g[awayField] || {}
          const home = g.home_team || {}
          return `- ${away.abbreviation || away.name || 'Away'} @ ${home.abbreviation || home.name || 'Home'} (${home.abbreviation || home.name} is HOME), ${g.date}`
        }).join('\n'))
      }
    } catch (e) { console.log(`${lg} schedule context skipped:`, e.message) }
    try {
      const inj = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/player_injuries?per_page=100`)
      const rows = (inj.data || []).slice(0, 80)
      if (rows.length) {
        sections.push(`${lg} INJURY REPORT (verified):\n` + rows.map(r => {
          const pl = r.player || {}
          const team = (pl.team && (pl.team.abbreviation || pl.team.name)) || ''
          const name = pl.first_name ? `${pl.first_name} ${pl.last_name}` : (pl.nickname || 'Unknown')
          return `- ${name}${team ? ' (' + team + ')' : ''}: ${r.status || 'listed'}${r.description ? ', ' + r.description : ''}`
        }).join('\n'))
      }
    } catch (e) { console.log(`${lg} injury context skipped:`, e.message) }
  }
  const text = sections.join('\n\n')
  analystCtxCache = { ts: Date.now(), text }
  return text
}
// ===== GOLD AUTO-ANALYSIS =====
// After the scoring engine selects gold candidates, a web-search pass checks
// tonight's reality for EVERY pick on the board, all leagues — MLB, WNBA,
// NBA, NHL, esports, all of it: opponent, injury/lineup status, anything the
// game logs can't see. The board is split into chunks of 10 that run in
// parallel so full coverage doesn't slow the load down. The model NEVER
// re-rates picks itself. It returns a status per player and the SERVER
// applies the adjustment:
//   CONFIRMED — positively found active/starting tonight. Rating stands,
//               ✓ VERIFIED on the card, pairing-eligible.
//   NO_NEWS   — nothing negative found (lineup may not be posted yet).
//               Rating stands, pairing-eligible.
//   CAUTION   — an actual negative finding. Rating -10, ⚠ CAUTION on the
//               card, never pairs, and drops off gold if it falls under floor.
//   OUT       — ruled out or team not playing. Pick removed entirely.
const ANALYZE_CHUNK = 12
async function analyzeChunk(chunk, currentTime, contextText) {
  const list = chunk.map(p =>
    `- ${p.name} (${p.league}${p.team ? ' · ' + p.team : ''}): ${p.stat} ${p.dir === 'HIGHER' ? 'over' : 'under'} ${p.val}`
  ).join('\n')
  const userMsg = `Current time: ${currentTime || new Date().toISOString()} ET
These are tonight's model-selected picks. Your job is a REAL scouting report on each one, not a rubber stamp.
${contextText ? `VERIFIED DATA already pulled from the live sports data feed. Treat this as ground truth and do NOT waste searches rediscovering it:
${contextText}
` : ''}PICKS TO ANALYZE:
${list}
Work GAME BY GAME, not player by player: group the picks by the game they belong to (use the verified schedule to find each pick's opponent and who is home), then search ONCE per game for what only search can tell you: today's posted lineup or confirmed starters, starting pitchers for MLB, and news from the last 24 hours. Prefer sources like ESPN, Rotowire, and team beat reporters. Base every claim on the verified data above or on something you actually found in a search result, never on memory.
For EACH pick, cover in your note:
- teammates OUT or questionable and what that does to this player's role (an absent star usually means more usage, shots, or at-bats for teammates)
- opposing players OUT and whether the matchup this player faces got easier or harder because of it
- matchup factors that matter: opposing starting pitcher and handedness for MLB, pace and rest for WNBA, home or away
- your read on whether the evidence supports the listed over/under side or challenges it
Status rules, based only on what the verified data and your searches show:
- "CONFIRMED": found evidence they are active, starting, or in tonight's lineup with no injury designation
- "NO_NEWS": found nothing negative, but could not positively confirm the lineup either. This is NORMAL for games whose lineups are not posted yet. No designation found = NO_NEWS, not CAUTION.
- "CAUTION": an ACTUAL negative finding: questionable or day-to-day tag, benched, minutes concern, elite opposing pitcher, weather delay risk
- "OUT": ruled out, not in the lineup, or their team does not play in the next 36 hours
Respond with ONLY this JSON array as your final message, nothing before or after it, no markdown fences:
[{"name":"exact player name from the list","status":"CONFIRMED","opponent":"opposing team name","venue":"home","note":"2-3 sentences: the full matchup read, absences on both sides and their effect, and why the evidence supports or challenges the listed side","related":"OPTIONAL 1 sentence: a real ripple effect worth knowing, like an absence boosting this player's role. Omit this field if you found nothing real."}]`
  let messages = [{ role: 'user', content: userMsg }]
  let finalText = ''
  for (let i = 0; i < 4; i++) {
    const data = await anthropicCall({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      system: `You are a sports betting scout producing real matchup intelligence. Search game by game, not player by player, and lean on the verified schedule and injury data provided instead of re-searching it. Never state injury or lineup information you did not find in the provided data or an actual search result. Output ONLY the requested JSON array as your final answer, nothing else.`,
      messages
    }, 3, true)
    if (!data || !data.content) throw new Error((data && data.error && data.error.message) || 'No content')
    finalText += data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (data.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: data.content }]
      continue
    }
    break
  }
  const start = finalText.indexOf('[')
  const end = finalText.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try { return JSON.parse(finalText.slice(start, end + 1)) } catch (e) { return [] }
}
async function analyzeGoldPicks(picks, currentTime) {
  if (!picks.length) return picks
  // Free verified context (schedule, home teams, injury report) built once
  // per half hour from BDL and shared by every chunk.
  const contextText = await buildAnalystContext().catch(() => '')
  // A failed chunk leaves its picks UNANALYZED instead of blanking the board.
  const chunks = []
  for (let i = 0; i < picks.length; i += ANALYZE_CHUNK) chunks.push(picks.slice(i, i + ANALYZE_CHUNK))
  const byName = {}
  await mapLimit(chunks, 2, async chunk => {
    try {
      const results = await analyzeChunk(chunk, currentTime, contextText)
      results.forEach(r => { if (r && r.name) byName[r.name.toLowerCase()] = r })
    } catch (e) {
      console.error('Analysis chunk skipped:', e.message)
    }
  })
  const out = []
  for (const p of picks) {
    const r = byName[(p.name || '').toLowerCase()]
    if (!r) { p.analysisStatus = 'UNANALYZED'; out.push(p); continue }
    const status = String(r.status || '').toUpperCase()
    const note = r.note || ''
    if (status === 'OUT') { console.log('Dropped (OUT):', p.name, '-', note); continue }
    p.baseScore = p.conf
    p.analysisNote = note || null
    // Opponent and venue from the scout, shown right on the card's meta line.
    if (r.opponent) {
      p.analysisOpponent = r.opponent
      p.analysisVenue = r.venue || null
      p.meta = `${p.meta} · ${r.venue === 'home' ? 'vs' : '@'} ${r.opponent}`
    }
    if (status === 'CONFIRMED') {
      p.analysisStatus = 'CONFIRMED'
      p.meta = `${p.meta} · ✓ VERIFIED`
      if (note) p.bull = `Analyst: ${note} ${p.bull}`
    } else if (status === 'CAUTION') {
      p.analysisStatus = 'CAUTION'
      p.conf = Math.max(1, p.conf - 10)
      p.cats = [{ n: p.stat, p: p.conf }]
      p.meta = `${p.meta} · ⚠ CAUTION`
      if (note) p.bear = `Analyst CAUTION: ${note} ${p.bear}`
    } else {
      // NO_NEWS (or anything unrecognized): nothing negative found. A lineup
      // not being posted yet is not bad news, so the rating stands untouched.
      p.analysisStatus = 'NO_NEWS'
      if (note) p.bull = `Analyst: ${note} ${p.bull}`
    }
    // Ripple effects (an absence boosting this player's role) lead the bull
    // case; they are usually the single most actionable line on the card.
    if (r.related && p.analysisStatus !== 'CAUTION') p.bull = `${r.related} ${p.bull}`
    out.push(p)
  }
  return out
}
// ===== PAIRING ENGINE =====
// The strongest 2-man combos, built from legs with a clean status check:
// CONFIRMED (positively verified in tonight's lineup) or NO_NEWS (nothing
// negative found — normal for games whose lineups aren't posted yet).
// CAUTION legs never pair. Rules: never two legs from the same team (one bad
// team night kills both), prefer CONFIRMED legs and cross-league independence,
// rank by the combined rate treating legs as independent. A 2-leg Power Play
// pays 3x, so the breakeven is ~33% combined.
function teamOf(p) {
  if (p.team) return String(p.team).toUpperCase()
  const parts = String(p.meta || '').split('·')
  return parts.length > 1 ? parts[1].trim().toUpperCase() : null
}
function buildPairs(elig, maxPairs = 5) {
  const pairs = []
  for (let i = 0; i < elig.length; i++) {
    for (let j = i + 1; j < elig.length; j++) {
      const a = elig[i], b = elig[j]
      const ta = teamOf(a), tb = teamOf(b)
      if (ta && tb && ta === tb) continue // same team = correlated failure
      const combined = Math.round((a.conf / 100) * (b.conf / 100) * 100)
      const sameSlot = a.league === b.league && a.time && a.time === b.time
      const confirmedCount = [a, b].filter(p => p.analysisStatus === 'CONFIRMED').length
      const rank = combined
        + confirmedCount * 3                      // verified legs beat unposted lineups
        + (a.league !== b.league ? 2 : 0)          // cross-league independence
        - (sameSlot ? 3 : 0)                       // may share a game window
      pairs.push({
        rank,
        combined,
        verified: confirmedCount === 2,
        legs: [a, b].map(p => ({
          id: p.id, name: p.name, league: p.league, team: teamOf(p),
          stat: p.stat, val: p.val, dir: p.dir, conf: p.conf,
          status: p.analysisStatus
        })),
        why: `${a.name} (${a.conf}) + ${b.name} (${b.conf})` +
          (confirmedCount === 2 ? ' · both verified in lineups' : confirmedCount === 1 ? ' · one leg verified' : ' · no red flags found') +
          (a.league !== b.league ? ' · independent leagues' : '') +
          (sameSlot ? ' · may share a game window' : '')
      })
    }
  }
  pairs.sort((x, y) => y.rank - x.rank)
  return pairs.slice(0, maxPairs).map(({ rank, ...p }) => p)
}
// Which non-real leagues get AI coverage: every league on the live slate
// with at least 5 lines, deepest slates first, capped at 8 so a busy day
// can't fan out forever. A requested league always gets covered on its tab.
function pickAiLeagues(rawLines, reqLeague, REAL) {
  if (reqLeague) return REAL.includes(reqLeague) ? [] : [reqLeague]
  const counts = {}
  ;(rawLines || []).forEach(l => {
    const lg = (l.league || '').toUpperCase()
    if (!lg || REAL.includes(lg)) return
    counts[lg] = (counts[lg] || 0) + 1
  })
  return Object.entries(counts)
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lg]) => lg)
}
// ===== SLIPS ENGINE =====
// Best 2- through 6-man power play combos. Legs come from analysis-clean
// picks (CONFIRMED / NO_NEWS); if the analyst couldn't run at all, slips
// still build from non-trap picks and are labeled unverified rather than
// vanishing. Never two legs from the same team. Combined rates treat legs
// as independent, shown against the power play breakeven for that size.
const POWER_MULT = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 }
function slipPool(picks) {
  const OK = ['CONFIRMED', 'NO_NEWS']
  const verified = picks.filter(p => OK.includes(p.analysisStatus))
  if (verified.length >= 2) return { pool: verified, analystDown: false }
  return { pool: picks.filter(p => !p.trapRisk && p.analysisStatus !== 'CAUTION'), analystDown: true }
}
function buildSlips(picks) {
  const { pool, analystDown } = slipPool(picks)
  const slips = buildPairs(pool, 3).map(p => ({
    size: 2, payout: POWER_MULT[2], breakeven: +(100 / POWER_MULT[2]).toFixed(1),
    analystDown, ...p
  }))
  // 3- through 6-man: greedy from the strongest legs, one per team max.
  const sorted = [...pool].sort((a, b) => b.conf - a.conf)
  for (let k = 3; k <= 6; k++) {
    if (sorted.length < k) break
    const legs = []
    const teams = new Set()
    for (const p of sorted) {
      const t = teamOf(p)
      if (t && teams.has(t)) continue
      legs.push(p)
      if (t) teams.add(t)
      if (legs.length === k) break
    }
    if (legs.length < k) break
    const combined = Math.round(legs.reduce((acc, p) => acc * (p.conf / 100), 1) * 100)
    slips.push({
      size: k,
      combined,
      payout: POWER_MULT[k],
      breakeven: +(100 / POWER_MULT[k]).toFixed(1),
      verified: !analystDown && legs.every(p => p.analysisStatus === 'CONFIRMED'),
      analystDown,
      legs: legs.map(p => ({
        id: p.id, name: p.name, league: p.league, team: teamOf(p),
        stat: p.stat, val: p.val, dir: p.dir, conf: p.conf, status: p.analysisStatus
      })),
      why: `${k}-man power pays ${POWER_MULT[k]}x, breakeven ${(100 / POWER_MULT[k]).toFixed(1)}%` +
        (analystDown ? ' · analyst unavailable, statuses unverified' : '')
    })
  }
  return slips
}
// Gold responses are cached per league so the tab opens instantly after the
// first build. The full pipeline (scan -> analyze -> pair) runs at most once
// per 30 minutes per league.
let goldCache = {}
const GOLD_CACHE_TTL = 2 * 60 * 60 * 1000
// ===== DAILY API BUDGET =====
// A hard ceiling on Anthropic spend, enforced in code, per UTC day. Every
// response's real usage numbers (input, cache writes at 1.25x, cache reads
// at 0.1x, output, web searches) are converted to dollars and accumulated;
// once the day's budget is spent, anthropicCall refuses to fire until
// midnight UTC. The app degrades instead of dying: engine-scored MLB/WNBA
// picks keep flowing (BALLDONTLIE costs nothing per call), boards serve
// stale caches, and only the AI extras pause. This caps the worst case at
// DAILY_API_BUDGET x 30 per month NO MATTER WHAT is hitting the server, a
// scheduler, public traffic, a bug, or a retry loop. Raise it from Railway's
// Variables tab (DAILY_API_BUDGET, in dollars) when revenue justifies it.
const DAILY_API_BUDGET = Number(process.env.DAILY_API_BUDGET || 5)
let apiSpend = { day: '', dollars: 0, calls: 0 }
function budgetDay() { return new Date().toISOString().slice(0, 10) }
function overBudget() {
  if (apiSpend.day !== budgetDay()) apiSpend = { day: budgetDay(), dollars: 0, calls: 0 }
  return apiSpend.dollars >= DAILY_API_BUDGET
}
// Sonnet-rate approximation ($3/M in, $15/M out, 1c per search). If the
// aiPicks model is switched to Haiku this overestimates, which only makes
// the ceiling more conservative, never less.
function recordUsage(data) {
  if (!data || !data.usage) return
  const u = data.usage
  const inTokens = (u.input_tokens || 0)
    + (u.cache_creation_input_tokens || 0) * 1.25
    + (u.cache_read_input_tokens || 0) * 0.1
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0
  const dollars = inTokens * 3 / 1e6 + (u.output_tokens || 0) * 15 / 1e6 + searches * 0.01
  if (apiSpend.day !== budgetDay()) apiSpend = { day: budgetDay(), dollars: 0, calls: 0 }
  apiSpend.dollars += dollars
  apiSpend.calls += 1
  console.log(`API spend today: $${apiSpend.dollars.toFixed(2)} of $${DAILY_API_BUDGET} (${apiSpend.calls} calls)`)
}
// Marks cache breakpoints for prompt caching. Only used on multi-round
// pause_turn loops (the analysts, parlay, chat), where the same prefix gets
// resent every round: with breakpoints, rounds 2+ re-read the cached prefix
// at a tenth of the input price instead of re-buying it in full. The console
// showed 10M input tokens in 3 days and most of them were these exact
// resends. NOT applied to single-shot calls (aiPicks): cache writes cost
// 1.25x, so caching content that is never re-read raises cost for nothing.
function markCacheBreakpoints(body) {
  const req = { ...body }
  if (!Array.isArray(req.messages) || !req.messages.length) return req
  const msgs = req.messages.map(m => ({ ...m }))
  // Breakpoint 1: end of the first user message. System, tools, and the task
  // prompt are identical across rounds, so every later round reads them cheap.
  const first = { ...msgs[0] }
  if (typeof first.content === 'string') {
    first.content = [{ type: 'text', text: first.content, cache_control: { type: 'ephemeral' } }]
  } else if (Array.isArray(first.content) && first.content.length) {
    first.content = first.content.map((b, i) =>
      i === first.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b)
  }
  msgs[0] = first
  // Breakpoint 2: end of the latest message, so the NEXT round re-reads this
  // round's search results from cache. Only text and tool_result blocks take
  // the marker safely; anything else just skips it and keeps breakpoint 1.
  if (msgs.length > 1) {
    const last = { ...msgs[msgs.length - 1] }
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }]
    } else if (Array.isArray(last.content) && last.content.length) {
      const blocks = last.content.map(b => ({ ...b }))
      const lb = blocks[blocks.length - 1]
      if (lb.type === 'text' || lb.type === 'tool_result') lb.cache_control = { type: 'ephemeral' }
      last.content = blocks
    }
    msgs[msgs.length - 1] = last
  }
  req.messages = msgs
  return req
}
// Shared Anthropic call with retry. The parallel per-league fan-out can trip
// rate limits (429) or transient overloads; silent empty returns made those
// invisible and blanked boards. Errors are logged and retried with backoff.
async function anthropicCall(body, tries = 3, cache = false) {
  if (overBudget()) {
    console.error(`Daily API budget of $${DAILY_API_BUDGET} spent, skipping Anthropic call until midnight UTC`)
    return null
  }
  const payload = cache ? markCacheBreakpoints(body) : body
  let data = null
  for (let i = 0; i < tries; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    })
    data = await r.json()
    recordUsage(data)
    if (data && data.content) return data
    const type = (data && data.error && data.error.type) || `http_${r.status}`
    console.error('Anthropic error:', type, (data && data.error && data.error.message) || '')
    const retryable = r.status === 429 || r.status >= 500 || String(type).includes('overloaded') || String(type).includes('rate')
    if (i < tries - 1 && retryable) { await sleep(2500 * (i + 1)); continue }
    break
  }
  return data
}
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
These are REAL live PrizePicks lines. Find the highest confidence picks at 82%+ confidence only. Copy line numbers exactly — never change them:
${spreadRule}
${linesText}
Find your top picks where you are genuinely 82%+ confident based on recent player performance and matchup. Only assign 82%+ confidence when genuinely warranted. Be suspicious of hot streaks: a line cleared in nearly every recent game is usually already priced in.
Output ONLY this JSON array:
[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":92,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason why this hits","bear":"real risk factor","record":"Hit this line in 12 of his last 15 games","cats":[{"n":"stat name","p":92}]}]
Rules:
- Copy line numbers EXACTLY — never change them
- conf must be 82 or above — never assign below 82 on this endpoint
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
  const data = await anthropicCall({
    model: AI_PICKS_MODEL,
    max_tokens: 4000,
    system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
    messages: [{ role: 'user', content: gold ? goldBody : tonightBody }]
  })
  if (!data || !data.content) { console.error('aiPicks got no content for', league || 'ALL'); return [] }
  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock) return []
  const start = textBlock.text.indexOf('[')
  const end = textBlock.text.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  let parsed
  try { parsed = JSON.parse(textBlock.text.slice(start, end + 1)) } catch (e) { return [] }
  const grounded = await groundPicks(validateLines(dedupe(normalizePicks(parsed)), rawLines))
  // The model emits ids 1..N per call, which collides across the parallel
  // per-league calls and breaks parlay toggling and React keys. Rebuild every
  // id from content so picks are globally unique across the whole board.
  grounded.forEach(p => {
    p.id = `ai-${p.league}-${p.name}-${p.stat}-${p.val}`.replace(/\s+/g, '_')
  })
  return grounded
}
// Tonight picks are cached per league server-side. With the board now public,
// every anonymous visitor would otherwise fire the full per-league AI fan-out
// on a cold load, burning Anthropic credits with zero accounts created. A 15
// minute cache means a wave of visitors costs one generation, same pattern as
// the gold cache. Empty boards are never cached so transient failures retry.
let picksCache = {}
const PICKS_CACHE_TTL = 45 * 60 * 1000
async function buildPicksBoard({ currentTime, rawLines, league, count, picksKey }) {
    const lines = sortLines(rawLines, league)
    const pickCount = Math.min(count || 6, 10, lines.length)
    console.log('Analyzing', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')
    const reqLeague = league ? league.toUpperCase() : null
    const REAL = ['MLB', 'WNBA', 'LOL', 'CS2']
    let picks = []
    // Real-data scanner for every BDL-backed league, run in parallel (lower
    // floor than gold so the board has range — traps show up here with their
    // penalized score and TRAP language). Any league whose real scan comes
    // back empty (sparse slate, or stat logs not on the current BDL tier)
    // falls through to AI so its board is never blank.
    const scanLgs = reqLeague ? (REAL.includes(reqLeague) ? [reqLeague] : []) : REAL
    const scanResults = await Promise.all(scanLgs.map(async lg => {
      const scanned = await realScan(rawLines, lg, 72, 2, 15, false)
      if (scanned.length > 0) return scanned
      const lgLines = rawLines.filter(l => (l.league || '').toUpperCase() === lg)
      if (!lgLines.length) return []
      const lgAI = await aiPicks(currentTime, lgLines, lg, rawLines, 'tonight', pickCount)
      console.log(lg, 'real scanner empty — AI fallback, got', lgAI.length, 'picks')
      return lgAI
    }))
    scanResults.forEach(arr => { picks = picks.concat(arr) })
    // AI per league for EVERY other sport with live lines (soccer, tennis,
    // golf, MMA, whatever the slate has), run in parallel. Leagues need at
    // least 5 lines to qualify, capped at the 8 deepest slates.
    const aiLeagues = pickAiLeagues(rawLines, reqLeague, REAL)
    const aiResults = []
    await mapLimit(aiLeagues, 3, async lg => {
      const lgLines = rawLines.filter(l => (l.league || '').toUpperCase() === lg).slice(0, 60)
      const arr = await aiPicks(currentTime, lgLines, lg, rawLines, 'tonight', Math.min(pickCount, 4))
      aiResults.push(...arr)
    })
    picks = picks.concat(aiResults)
    picks.sort((a, b) => b.conf - a.conf)
    picks = picks.slice(0, 40)
    console.log('Got', picks.length, 'picks (', picks.filter(p => REAL.includes(p.league)).length, 'real,', picks.filter(p => p.trapRisk).length, 'flagged trap )')
    if (picks.length > 0) picksCache[picksKey] = { data: { picks }, ts: Date.now() }
    return { picks }
}
app.post('/picks', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league, count = 6 } = req.body
    const picksKey = (league || 'ALL').toUpperCase()
    const pc = picksCache[picksKey]
    if (pc && Date.now() - pc.ts < PICKS_CACHE_TTL) {
      console.log('Serving picks from cache for', picksKey)
      return res.json(pc.data)
    }
    // Over budget: stale picks beat spending money we've capped. The real
    // scanner is free, so only boards that would need AI generation stop
    // refreshing until midnight UTC.
    if (overBudget() && pc) {
      console.log('Over daily budget, serving stale picks cache for', picksKey)
      return res.json(pc.data)
    }
    const payload = await coalesce(`picks:${picksKey}`, () =>
      buildPicksBoard({ currentTime, rawLines, league, count, picksKey }))
    res.json(payload)
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})
async function buildGoldBoard({ currentTime, rawLines, league, goldKey }) {
    const lines = sortLines(rawLines, league)
    console.log('Finding gold from', lines?.length, 'lines for league:', league || 'ALL')
    if (!lines || lines.length === 0) throw new Error('No lines provided')
    const reqLeague = league ? league.toUpperCase() : null
    const REAL = ['MLB', 'WNBA', 'LOL', 'CS2']
    let picks = []
    // Gold from real data: strongest verified plays, gold-eligible only. That
    // means no trap flags, projection must agree with the streak side, and the
    // player must have appeared recently. All real leagues scan in parallel.
    // Any league whose real scan is empty (sparse slate, or stat logs not on
    // the current BDL tier) falls back to AI, still gated by its gold floor.
    // Grounding rescores any verifiable AI pick through the same engine.
    const scanLgs = reqLeague ? (REAL.includes(reqLeague) ? [reqLeague] : []) : REAL
    const scanResults = await Promise.all(scanLgs.map(async lg => {
      const floor = goldFloorFor(lg)
      const scanned = await realScan(rawLines, lg, floor, 2, 20, true)
      if (scanned.length > 0) return scanned
      const lgLines = rawLines.filter(l => (l.league || '').toUpperCase() === lg)
      if (!lgLines.length) return []
      const lgAI = await aiPicks(currentTime, lgLines, lg, rawLines, 'gold')
      console.log(lg, 'real scanner empty — AI gold fallback, got', lgAI.length, 'picks')
      return lgAI.filter(p => p.conf >= floor)
    }))
    scanResults.forEach(arr => { picks = picks.concat(arr) })
    // AI gold per league for EVERY other sport with live lines, in parallel,
    // each gated by its gold floor. Every sport on the slate gets scanned.
    const aiLeagues = pickAiLeagues(rawLines, reqLeague, REAL)
    const aiResults = []
    await mapLimit(aiLeagues, 3, async lg => {
      const lgLines = rawLines.filter(l => (l.league || '').toUpperCase() === lg).slice(0, 60)
      const aiGold = await aiPicks(currentTime, lgLines, lg, rawLines, 'gold')
      aiResults.push(...aiGold.filter(p => p.conf >= goldFloorFor(lg)))
    })
    picks = picks.concat(aiResults)
    // Snapshot before the gates so a thin slate can still show its best
    // candidates instead of a blank board.
    const candidates = [...picks]
    // Final gate: every pick must clear its floor AND carry no trap flag,
    // regardless of how it got here.
    picks = picks.filter(p => p.conf >= goldFloorFor((p.league || '').toUpperCase()) && !p.trapRisk)
    picks.sort((a, b) => b.conf - a.conf)
    picks = picks.slice(0, 30)
    console.log('Got', picks.length, 'gold picks (', picks.filter(p => REAL.includes(p.league)).length, 'real ) — analyzing tonight\'s status')
    // Stage 2: auto-verify tonight's reality (opponent, injuries, lineups),
    // then re-rate. OUT picks are removed, real negative findings dock 10,
    // clean checks (CONFIRMED / NO_NEWS) keep their rating. The analyst is a
    // web-search pipeline and is the single most expensive thing this server
    // does, so it only runs on the TOP picks; a pick ranked 25th on the board
    // does not justify a paid verification pass. The rest ship UNANALYZED,
    // which the card already renders honestly.
    const ANALYZE_MAX = 12
    const analyzed = await analyzeGoldPicks(picks.slice(0, ANALYZE_MAX), currentTime)
    const rest = picks.slice(ANALYZE_MAX).map(p => ({ ...p, analysisStatus: 'UNANALYZED' }))
    picks = analyzed.concat(rest)
    // The floor is re-enforced AFTER re-rating: a pick docked for bad news
    // that falls under its league floor does not belong on the gold board.
    picks = picks.filter(p => p.conf >= goldFloorFor((p.league || '').toUpperCase()))
    picks.sort((a, b) => b.conf - a.conf)
    // Never-empty valve: if nothing cleared every gate but real candidates
    // exist (All-Star breaks and thin slates happen), surface the best
    // non-trap ones honestly labeled NEAR GOLD instead of a blank board.
    if (picks.length === 0 && candidates.length > 0) {
      picks = candidates
        .filter(p => !p.trapRisk)
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 5)
        .map(p => ({ ...p, nearGold: true, meta: `${p.meta} · NEAR GOLD`, analysisStatus: p.analysisStatus || 'UNANALYZED' }))
      console.log('Never-empty valve engaged:', picks.length, 'NEAR GOLD picks from', candidates.length, 'candidates')
    }
    // Every pick that reaches this board IS gold by definition (it cleared
    // its league floor, the trap filter, and the status check). Ship the
    // tier explicitly so the card labels it GOLD instead of inferring a
    // tier from conf thresholds built for the old 0-95 AI scale.
    picks.forEach(p => { p.tier = p.nearGold ? 'NEAR GOLD' : 'GOLD' })
    // Stage 3: strongest slips, 2-man through 6-man.
    const slips = buildSlips(picks)
    const pairs = slips.filter(s => s.size === 2)
    // Make analyst failures visible instead of silent.
    const warnings = []
    const analyzedAny = picks.some(p => ['CONFIRMED', 'NO_NEWS', 'CAUTION'].includes(p.analysisStatus))
    if (picks.length > 0 && !analyzedAny) {
      warnings.push('The analyst could not run on this load (AI service unavailable). Statuses and slips are unverified. Check Railway logs for the Anthropic error.')
    }
    console.log('Gold stages — candidates:', candidates.length,
      '| final:', picks.length,
      '| confirmed:', picks.filter(p => p.analysisStatus === 'CONFIRMED').length,
      '| no-news:', picks.filter(p => p.analysisStatus === 'NO_NEWS').length,
      '| caution:', picks.filter(p => p.analysisStatus === 'CAUTION').length,
      '| near-gold:', picks.filter(p => p.nearGold).length,
      '| slips:', slips.length, analyzedAny ? '' : '| ANALYST DID NOT RUN')
    // Track the record: every gold pick that reaches the board gets logged
    // with its FINAL (post-analysis) rating.
    logGoldPicks(picks)
    const payload = { picks, pairs, slips, warnings }
    // Healthy boards cache for the full TTL. Analyst-down or empty boards
    // cache for 5 minutes as a circuit breaker: long enough that an Anthropic
    // outage costs one pipeline run per 5 minutes instead of one per page
    // load (that pattern is exactly how a day of retries drains a credit
    // balance), short enough that recovery is picked up quickly.
    if (picks.length > 0 && analyzedAny) {
      goldCache[goldKey] = { data: payload, ts: Date.now() }
    } else {
      goldCache[goldKey] = { data: payload, ts: Date.now(), ttl: 5 * 60 * 1000 }
    }
    return payload
}
app.post('/gold', async (req, res) => {
  try {
    const { currentTime, lines: rawLines, league } = req.body
    // Serve from cache when the full pipeline ran recently for this league.
    const goldKey = (league || 'ALL').toUpperCase()
    const gc = goldCache[goldKey]
    if (gc && Date.now() - gc.ts < (gc.ttl || GOLD_CACHE_TTL)) {
      console.log('Serving gold from cache for', goldKey)
      return res.json(gc.data)
    }
    // Over budget: yesterday's verified gold board beats an unanalyzed fresh
    // one that costs money we've capped.
    if (overBudget() && gc) {
      console.log('Over daily budget, serving stale gold cache for', goldKey)
      return res.json(gc.data)
    }
    const payload = await coalesce(`gold:${goldKey}`, () =>
      buildGoldBoard({ currentTime, rawLines, league, goldKey }))
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
      const res2ok = await anthropicCall({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          system: `You are the Trip Predicts AI analyst for PrizePicks. You have real live prop lines provided to you. Always use the exact line numbers from the data — never change them. Prioritize NBA, MLB, NHL, NFL, and esports. Only recommend WNBA or niche sports if explicitly asked. Look for clear statistical edges — recent form, matchup advantages, usage rates, pace of play. Be suspicious of hot streaks: a player who has cleared a line in 13 or 14 of his last 15 games usually has a line that was already raised to match the streak, which makes it a regression trap, not a lock. Only recommend picks from games in the next 36 hours. Never recommend the same player twice. Spread picks across multiple sports — never more than 2 from the same league. When recommending direction, commit to it based on data. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Never use em dashes. Bold key info with **text**.`,
          messages: current
      }, 3, true)
      const data = res2ok
      if (!data || !data.content) throw new Error('No content')
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
// job is a real scouting report: for MLB hitters that means the opposing
// starting pitcher (name, handedness, quality), platoon splits, lineup spot,
// park; for WNBA the defensive matchup, pace, rest, and absences on both
// sides. Every claim must come from the verified BDL context or an actual
// search result, never from stale training knowledge. web_search_20250305 is
// a server-executed tool, Anthropic runs the search and hands back real
// results in the same response.
let parlayCache = {}
const PARLAY_CACHE_TTL = 20 * 60 * 1000
app.post('/parlay-analysis', async (req, res) => {
  try {
    const { picks, currentTime } = req.body
    if (!picks || !picks.length) throw new Error('No picks provided')
    if (picks.length > 6) throw new Error('Max 6 legs per parlay')
    // Same slip analyzed twice in 20 minutes costs nothing the second time.
    const slipKey = picks.map(p => `${p.name}|${p.stat}|${p.val}|${p.dir}`).sort().join('~')
    const pcached = parlayCache[slipKey]
    if (pcached && Date.now() - pcached.ts < PARLAY_CACHE_TTL) {
      console.log('Serving parlay analysis from cache')
      return res.json(pcached.data)
    }
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
    // The combined rate is server-side arithmetic on real numbers and never
    // needs the API, so it must survive budget exhaustion, credit outages,
    // and API downtime. Only the search-grounded verdict and per-leg notes
    // need Anthropic. If the analyst cannot run, return the real math with a
    // plain notice instead of a hard error.
    const mathOnly = reason => ({
      verdict: null,
      summary: (combinedPct != null
        ? `Combined hit rate from real historical numbers: ${combinedPct}% if every leg is independent. `
        : '') + `Live analyst is unavailable right now (${reason}), so matchups and lineups are unverified for this slip.` +
        (trapLegs.length ? ` Flagged TRAP RISK legs: ${trapLegs.join(', ')}.` : ''),
      legs: [],
      combinedRate: combinedPct,
      analystDown: true
    })
    if (overBudget()) {
      return res.json(mathOnly('daily analysis budget reached, resets at midnight UTC'))
    }
    // Free verified schedule, home teams, and injury report from BDL, same
    // pack the gold analyst uses, so searches go toward pitcher matchups and
    // splits instead of rediscovering who plays tonight.
    const contextText = await buildAnalystContext().catch(() => '')
    const userMsg = `Current time: ${currentTime} ET
A user is building this ${picks.length}-leg parlay:
${legContext}
${combinedPct != null
  ? `The combined hit rate if every leg is independent is ${combinedPct}%, calculated directly from the historical rates above. Reference this exact number in your summary. Do not calculate or state a different one.`
  : `Not every leg has a verified historical rate, so no combined number was calculated. Do not invent one.`}
${trapLegs.length ? `\nThe following legs are flagged TRAP RISK and the verdict cannot be "Strong" while any of them remain: ${trapLegs.join(', ')}.` : ''}
${contextText ? `VERIFIED DATA already pulled from the live sports data feed (schedule, home teams, injury report). Treat it as ground truth and do not waste searches rediscovering it:
${contextText}
` : ''}Your job is a REAL scouting report on each leg, the kind a sharp bettor wants before locking a slip, not a status check. Research each leg's GAME, then answer the specific questions that decide whether THIS prop hits. Prefer ESPN, Rotowire, Baseball Savant, FanGraphs, Baseball Reference, and team beat reporters. Every claim must come from the verified data above or an actual search result, never from memory. If something cannot be found, say so plainly.
MLB HITTER legs, always cover:
- the opposing STARTING PITCHER by name, handedness, and quality: ERA, WHIP, strikeout rate, and how his last few starts went. A high-WHIP soft tosser and an elite strikeout arm are opposite worlds for a hits or total bases prop, so this is the single most important fact on the card
- the hitter's platoon split against that pitcher's handedness, and batter-vs-pitcher history if any exists (note when the sample is tiny)
- lineup spot (top of the order means more plate appearances), recent form, home or away, and park or weather factors when they matter (wind, Coors, a pitcher's park)
- the bullpen only if it materially changes the outlook (a bullpen game, or a lockdown closer against a late-inning prop)
MLB PITCHER legs, cover: the opposing lineup's strength and strikeout tendency against his handedness, his recent pitch counts and how deep he has been going, and his recent results.
WNBA legs, cover: the opponent and how they defend this player's position, pace, rest (back-to-back or not), teammates OUT and what that does to this player's usage and minutes, the recent minutes trend, home or away.
ESPORTS legs, cover: opponent strength, recent series form, roster changes, and the map count of the series.
For EACH leg, end with a plain read: does the evidence SUPPORT the listed over/under side, is it NEUTRAL, or does it CHALLENGE it, and the single biggest reason why. The verdict cannot be "Strong" if any leg is CHALLENGED or flagged TRAP RISK.
Current status matters too: state injury or lineup information only when the verified data or a search result shows it. If you cannot confirm, say "no current lineup confirmation found" instead of guessing.
After researching all ${picks.length} legs, respond with ONLY this JSON object as your final message, nothing before or after it, no markdown fences:
{"verdict":"Strong or Moderate or Risky","summary":"2-3 sentences on the overall parlay, referencing the combined rate if one was given and naming the weakest leg","legs":[{"name":"player name","edge":"SUPPORTS or NEUTRAL or CHALLENGES","note":"3-4 sentences: the matchup specifics above (for MLB hitters always name the starting pitcher with his handedness and quality), current status, and the biggest reason for your read"}]}`
    let parsed = null
    try {
      let messages = [{ role: 'user', content: userMsg }]
      let finalText = ''
      for (let i = 0; i < 4; i++) {
        const data = await anthropicCall({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
          system: `You are a sharp sports betting scout producing matchup intelligence for a parlay. For every MLB hitter leg the opposing starting pitcher, his handedness, and his quality are mandatory. Lean on the verified schedule and injury data provided instead of re-searching it. Never state injury, lineup, or pitcher information you did not find in the provided data or an actual search result. Output ONLY the requested JSON as your final answer, nothing else.`,
          messages
        }, 3, true)
        if (!data || !data.content) throw new Error((data && data.error && data.error.message) || 'No content from AI')
        finalText += data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        if (data.stop_reason === 'pause_turn') {
          messages = [...messages, { role: 'assistant', content: data.content }]
          continue
        }
        break
      }
      const start = finalText.indexOf('{')
      const end = finalText.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('could not parse the analysis')
      parsed = JSON.parse(finalText.slice(start, end + 1))
    } catch (aiErr) {
      console.error('Parlay analyst failed, serving math-only:', aiErr.message)
      return res.json(mathOnly('analyst error: ' + aiErr.message))
    }
    const payload = {
      verdict: parsed.verdict || null,
      summary: parsed.summary || null,
      legs: Array.isArray(parsed.legs)
        ? parsed.legs.map(l => ({ name: l.name, note: l.note, edge: l.edge ? String(l.edge).toUpperCase() : null }))
        : [],
      combinedRate: combinedPct
    }
    parlayCache[slipKey] = { data: payload, ts: Date.now() }
    res.json(payload)
  } catch (e) {
    console.error('Parlay analysis error:', e.message)
    res.status(500).json({ error: e.message })
  }
})
const PORT = process.env.PORT || 8080
// ===== MONEYLINES =====
// Real moneyline odds from multiple real sportsbooks (DraftKings, FanDuel,
// Caesars, BetMGM, and more) via BALLDONTLIE's odds API. Not scraped, not
// estimated, this is a live authorized feed the same subscription already
// covers. For each game, the BEST available price on each side across every
// book is used, and implied win probability is computed directly from that
// real number, never a model guess standing in for what the market already
// prices. MLB games key the opponent under away_team, WNBA under
// visitor_team, confirmed against BALLDONTLIE's schema earlier in this build,
// same trap as the matchup work before this.
const MONEYLINE_SPORTS = ['MLB', 'WNBA']
const AWAY_FIELD = { MLB: 'away_team', WNBA: 'visitor_team' }
// A side is flagged VALUE when its best available price pays at least this
// much more than the no-vig market consensus says it should. 1.5 percentage
// points is a meaningful, findable edge; anything smaller is noise inside
// normal book-to-book variation.
const VALUE_EDGE_MIN = 0.015
function americanToImpliedProb(odds) {
  if (odds == null) return null
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100)
}
// Best price for the bettor is the highest number regardless of sign:
// +650 beats +600, and -105 beats -110.
function bestOdds(oddsList, key) {
  const valid = oddsList.filter(o => o[key] != null)
  if (!valid.length) return null
  const best = valid.reduce((a, b) => (a[key] > b[key] ? a : b))
  return { odds: best[key], vendor: best.vendor }
}
async function fetchMoneylines(lg) {
  const sport = BDL_SPORTS[lg]
  if (!sport) return []
  const awayField = AWAY_FIELD[lg] || 'away_team'
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [gamesToday, gamesTomorrow, oddsToday, oddsTomorrow] = await Promise.all([
    bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/games?dates[]=${today}`),
    bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/games?dates[]=${tomorrow}`),
    // v1, NOT v2. Verified against BDL's own OpenAPI spec and docs for both
    // MLB and WNBA. The v2 path came from an NBA-specific example (NBA really
    // is v2) and was wrongly generalized; the dead-subscription 401 masked
    // the wrong path for weeks because auth failed before path resolution.
    bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/odds?dates[]=${today}`),
    bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/odds?dates[]=${tomorrow}`)
  ])
  const games = {}
  ;[...(gamesToday.data || []), ...(gamesTomorrow.data || [])].forEach(g => { games[g.id] = g })
  const byGame = {}
  ;[...(oddsToday.data || []), ...(oddsTomorrow.data || [])].forEach(o => {
    (byGame[o.game_id] = byGame[o.game_id] || []).push(o)
  })
  const results = []
  for (const [gameId, oddsList] of Object.entries(byGame)) {
    const game = games[gameId]
    if (!game) continue
    // Pregame only. A game that already started carries live or closing odds
    // (-6000, -10000 style numbers on a decided game), which look like data
    // but mean nothing for picking. This is why finished games from the
    // UTC-today window were littering the board with absurd lines.
    if (!game.date || new Date(game.date).getTime() <= Date.now()) continue
    const home = bestOdds(oddsList, 'moneyline_home_odds')
    const away = bestOdds(oddsList, 'moneyline_away_odds')
    if (!home || !away) continue
    const homeProb = americanToImpliedProb(home.odds)
    const awayProb = americanToImpliedProb(away.odds)
    // No-vig market consensus. Each book's two-sided prices imply a true
    // probability once the vig is stripped (home / (home + away)); averaging
    // that across every book is the market's collective opinion. The VALUE
    // edge is then simply how much better the best available price pays than
    // that consensus says it should. All real numbers, no model, no guessing.
    const twoSided = oddsList.filter(o => o.moneyline_home_odds != null && o.moneyline_away_odds != null)
    let consensusHome = null
    if (twoSided.length >= 2) {
      const novig = twoSided.map(o => {
        const ph = americanToImpliedProb(o.moneyline_home_odds)
        const pa = americanToImpliedProb(o.moneyline_away_odds)
        return ph / (ph + pa)
      })
      consensusHome = novig.reduce((s, v) => s + v, 0) / novig.length
    }
    let valueSide = null
    let valueEdgePct = null
    let homeEdgePct = null
    let awayEdgePct = null
    let consensusHomePct = null
    let consensusAwayPct = null
    if (consensusHome != null && homeProb != null && awayProb != null) {
      const homeEdge = consensusHome - homeProb
      const awayEdge = (1 - consensusHome) - awayProb
      homeEdgePct = Math.round(homeEdge * 1000) / 10
      awayEdgePct = Math.round(awayEdge * 1000) / 10
      consensusHomePct = Math.round(consensusHome * 1000) / 10
      consensusAwayPct = Math.round((1 - consensusHome) * 1000) / 10
      const bestSide = homeEdge >= awayEdge ? 'home' : 'away'
      const bestEdge = Math.max(homeEdge, awayEdge)
      if (bestEdge >= VALUE_EDGE_MIN) {
        valueSide = bestSide
        valueEdgePct = Math.round(bestEdge * 1000) / 10
      }
    }
    const awayTeam = game[awayField] || {}
    const homeTeam = game.home_team || {}
    results.push({
      id: `ml-${lg}-${gameId}`,
      league: lg,
      gameId,
      date: game.date || null,
      homeTeam: homeTeam.full_name || homeTeam.name || 'Home',
      homeAbbr: homeTeam.abbreviation || null,
      awayTeam: awayTeam.full_name || awayTeam.name || 'Away',
      awayAbbr: awayTeam.abbreviation || null,
      homeOdds: home.odds,
      homeVendor: home.vendor,
      homeImpliedPct: homeProb != null ? Math.round(homeProb * 1000) / 10 : null,
      awayOdds: away.odds,
      awayVendor: away.vendor,
      awayImpliedPct: awayProb != null ? Math.round(awayProb * 1000) / 10 : null,
      favorite: home.odds < away.odds ? 'home' : 'away',
      booksTracked: twoSided.length,
      consensusHomePct,
      consensusAwayPct,
      homeEdgePct,
      awayEdgePct,
      valueSide,
      valueEdgePct
    })
  }
  return results
}
// The real odds above are never touched again past this point. This step
// only adds search-grounded CONTEXT on top: starting pitchers, injuries,
// recent form, anything that explains or challenges why the market favors
// the side it does. Same rule as the rest of this app: the model never
// re-rates or restates a number that real data already provides.
const ML_ANALYZE_CHUNK = 8
async function analyzeMoneylineChunk(chunk, currentTime) {
  const list = chunk.map(g => {
    const favTeam = g.favorite === 'home' ? g.homeTeam : g.awayTeam
    const favOdds = g.favorite === 'home' ? g.homeOdds : g.awayOdds
    const favPct = g.favorite === 'home' ? g.homeImpliedPct : g.awayImpliedPct
    const valueLine = g.valueSide
      ? ` | VALUE flag (already computed from real prices, do not re-derive): best price on ${g.valueSide === 'home' ? g.homeTeam : g.awayTeam} pays ${g.valueEdgePct} points above the ${g.booksTracked}-book no-vig consensus`
      : ''
    return `- id: "${g.id}" | ${g.awayTeam} @ ${g.homeTeam} (${g.league}) | Market favors ${favTeam} at ${favOdds > 0 ? '+' : ''}${favOdds} (${favPct}% implied)${valueLine}`
  }).join('\n')
  const userMsg = `Current time: ${currentTime || new Date().toISOString()} ET
These are upcoming games with REAL live moneyline odds already pulled from the market. The odds and implied probabilities listed are already correct, real numbers, not your job to guess, restate, or re-price them.
${list}
For EACH game, search for what actually matters to the outcome: starting pitchers (for MLB), key injuries or absences, and recent team form (last 5-10 games). Write 1-2 sentences of real reasoning grounded in what you actually find. If you can't confirm something (like today's starting pitcher), say so plainly rather than guessing. Do not state your own "pick" or a different probability, your job is to explain the real matchup, not re-price it. If you find something that genuinely challenges the favorite (an injury to a key player, a bullpen game instead of the usual starter), flag it plainly in riskFlag.
Respond with ONLY this JSON array as your final message, nothing before or after it, no markdown fences:
[{"id":"exact id from the list above","note":"1-2 sentences of real reasoning grounded in search","riskFlag":"short phrase only if something material challenges the favorite, otherwise omit this field"}]`
  let messages = [{ role: 'user', content: userMsg }]
  let finalText = ''
  for (let i = 0; i < 4; i++) {
    const data = await anthropicCall({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      system: `You analyze real sports betting moneylines. Use web search for every game on the list. Never state odds or probabilities yourself, those are already provided and correct. Never state injury or lineup information you did not actually find via search. Output ONLY the requested JSON array as your final answer, nothing else.`,
      messages
    }, 3, true)
    if (!data || !data.content) throw new Error((data && data.error && data.error.message) || 'No content')
    finalText += data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (data.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: data.content }]
      continue
    }
    break
  }
  const start = finalText.indexOf('[')
  const end = finalText.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try { return JSON.parse(finalText.slice(start, end + 1)) } catch (e) { return [] }
}
async function analyzeMoneylines(games, currentTime) {
  if (!games.length) return games
  const chunks = []
  for (let i = 0; i < games.length; i += ML_ANALYZE_CHUNK) chunks.push(games.slice(i, i + ML_ANALYZE_CHUNK))
  const byId = {}
  await mapLimit(chunks, 2, async chunk => {
    try {
      const results = await analyzeMoneylineChunk(chunk, currentTime)
      results.forEach(r => { if (r && r.id) byId[r.id] = r })
    } catch (e) {
      console.error('Moneyline analysis chunk skipped:', e.message)
    }
  })
  return games.map(g => {
    const r = byId[g.id]
    if (!r) return { ...g, analysisNote: null, riskFlag: null, analyzed: false }
    return { ...g, analysisNote: r.note || null, riskFlag: r.riskFlag || null, analyzed: true }
  })
}
// Analysis is real web search across every game on the board, expensive and
// slow to redo on every page load, so it's cached same as gold picks are.
let moneylinesCache = {}
const MONEYLINES_CACHE_TTL = 60 * 60 * 1000
async function buildMoneylinesBoard({ reqLeague, cacheKey, currentTime }) {
    const sports = reqLeague ? (MONEYLINE_SPORTS.includes(reqLeague) ? [reqLeague] : []) : MONEYLINE_SPORTS
    const fetchErrors = []
    const results = await Promise.all(sports.map(lg =>
      fetchMoneylines(lg).catch(e => {
        console.error(`Moneylines fetch failed for ${lg}:`, e.message)
        fetchErrors.push(`${lg}: ${e.message}`)
        return []
      })
    ))
    // Value picks lead the board, strongest edge first, then everything else
    // in chronological order. The tab's job is now "here is what is actually
    // worth a look", not "here is every game".
    let games = results.flat().sort((a, b) => {
      const aHasValue = a.valueSide != null
      const bHasValue = b.valueSide != null
      if (aHasValue !== bHasValue) return aHasValue ? -1 : 1
      if (aHasValue && bHasValue && b.valueEdgePct !== a.valueEdgePct) return b.valueEdgePct - a.valueEdgePct
      return new Date(a.date || 0) - new Date(b.date || 0)
    })
    console.log('Moneylines:', games.length, 'real games across', sports.join(', '))
    // Every league failed and nothing came back. Say so plainly instead of a
    // quiet empty list, an auth error on BALLDONTLIE looks identical to "no
    // games today" otherwise, and those need very different next steps.
    if (games.length === 0 && fetchErrors.length > 0 && fetchErrors.length === sports.length) {
      console.error('Moneylines: all leagues failed —', fetchErrors.join(' | '))
      return { code: 502, body: {
        error: `Could not fetch odds from BALLDONTLIE: ${fetchErrors.join(' | ')}`,
        games: []
      } }
    }
    // The analyst layer (web-search notes per game) is the ONLY part of this
    // tab that costs API money; the odds and value edges are covered by the
    // BDL subscription and plain arithmetic. Kill switch, default OFF: the
    // tab keeps real odds, best prices, and VALUE flags at zero API cost.
    // Re-enable by setting MONEYLINES_ANALYST=on in Railway's Variables tab.
    const analystOn = String(process.env.MONEYLINES_ANALYST || 'off').toLowerCase() === 'on'
    if (analystOn) {
      games = await analyzeMoneylines(games, currentTime || new Date().toISOString())
    } else {
      games = games.map(g => ({ ...g, analysisNote: null, riskFlag: null, analyzed: false }))
      console.log('Moneylines analyst disabled, serving odds and value edges only')
    }
    const payload = { games }
    if (games.length > 0) moneylinesCache[cacheKey] = { data: payload, ts: Date.now() }
    return { code: 200, body: payload }
}
app.post('/moneylines', async (req, res) => {
  try {
    const { league, currentTime } = req.body || {}
    const reqLeague = league ? league.toUpperCase() : null
    const cacheKey = reqLeague || 'ALL'
    const mc = moneylinesCache[cacheKey]
    if (mc && Date.now() - mc.ts < MONEYLINES_CACHE_TTL) {
      console.log('Serving moneylines from cache for', cacheKey)
      return res.json(mc.data)
    }
    const out = await coalesce(`ml:${cacheKey}`, () =>
      buildMoneylinesBoard({ reqLeague, cacheKey, currentTime }))
    res.status(out.code).json(out.body)
  } catch (e) {
    console.error('Moneylines error:', e.message)
    res.status(500).json({ error: e.message })
  }
})
app.listen(PORT, () => console.log(`Trip Predicts server running on port ${PORT}`))