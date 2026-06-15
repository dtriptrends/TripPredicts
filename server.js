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

// path     = BDL league slug (note: Counter-Strike is "cs", not "cs2")
// statsPath = per-game stats endpoint. This differs per sport and was the WNBA 404:
//             MLB is /stats, WNBA is /player_stats.
// supported = false for LoL and CS2 because their game logs sit behind BDL's GOAT
//             tier. The plan is ALL-STAR, so those calls 401. We fall back cleanly.
const BDL_SPORTS = {
  MLB:  { path: 'mlb',  statsPath: 'stats',        season: 2026, supported: true },
  WNBA: { path: 'wnba', statsPath: 'player_stats', season: 2026, supported: true },
  LOL:  { supported: false, reason: 'LoL game logs require the BALLDONTLIE GOAT tier. Your plan is ALL-STAR.' },
  CS2:  { supported: false, reason: 'CS2 game logs require the BALLDONTLIE GOAT tier. Your plan is ALL-STAR.' },
}

const gamelogCache = {}
const GAMELOG_TTL = 60 * 60 * 1000 // 1 hour

async function bdlFetch(url) {
  const r = await fetch(url, { headers: { Authorization: BDL_KEY } })
  if (!r.ok) throw new Error(`BDL ${r.status}`)
  return r.json()
}

// Recency key that works across both stat shapes:
// WNBA rows have a nested game object with a real date; MLB rows have a flat
// numeric game_id that climbs over the season (oldest games = lowest id).
// Higher key = more recent, so sorting desc gives recent form for both.
function gameSortKey(row) {
  if (row.game && row.game.date) return new Date(row.game.date).getTime()
  if (row.game_id) return Number(row.game_id) || 0
  if (row.game && row.game.id) return Number(row.game.id) || 0
  return 0
}

// Drop did-not-play rows so a DNP never counts as a miss in a hit-rate.
function bdlPlayed(row, lg) {
  if (lg === 'WNBA') return (Number(row.min) || 0) > 0
  if (lg === 'MLB') {
    const pa = Number(row.plate_appearances) || 0
    const ab = Number(row.at_bats) || 0
    const ip = Number(row.ip) || 0
    return pa > 0 || ab > 0 || ip > 0
  }
  return true
}

app.post('/player-gamelog', async (req, res) => {
  try {
    const { player, league } = req.body
    if (!player) throw new Error('No player provided')
    const lg = (league || '').toUpperCase()
    const sport = BDL_SPORTS[lg]
    if (!sport) return res.json({ player, league: lg, games: [], note: `${lg} stats not available yet.` })

    // LoL / CS2: game logs need the GOAT tier, plan is ALL-STAR. Fall back, do not error.
    if (!sport.supported) {
      return res.json({ player, league: lg, games: [], supported: false, note: sport.reason })
    }

    const cacheKey = `${lg}|${player.trim().toLowerCase()}`
    const cached = gamelogCache[cacheKey]
    if (cached && Date.now() - cached.ts < GAMELOG_TTL) {
      return res.json(cached.data)
    }

    // 1) find the player's ID by last name
    const searchTerm = player.trim().split(' ').slice(-1)[0]
    const pData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/players?search=${encodeURIComponent(searchTerm)}`)
    const players = pData.data || []
    if (players.length === 0) {
      const payload = { player, league: lg, games: [], note: 'Player not found in stats database.' }
      gamelogCache[cacheKey] = { data: payload, ts: Date.now() }
      return res.json(payload)
    }

    const lowerFull = player.trim().toLowerCase()
    let match = players.find(p => `${p.first_name} ${p.last_name}`.toLowerCase() === lowerFull)
    if (!match) match = players.find(p => (p.full_name || '').toLowerCase() === lowerFull)
    if (!match) match = players[0]

    // 2) pull this season's stats from the correct per-sport endpoint, drop
    //    did-not-play rows, then sort most-recent-first and keep 15. We sort by
    //    real date when the API gives one (WNBA) and by game_id when it does not
    //    (MLB returns oldest-first with a flat game_id, so without this you'd get
    //    the earliest games of the season instead of recent form).
    const sData = await bdlFetch(`https://api.balldontlie.io/${sport.path}/v1/${sport.statsPath}?player_ids[]=${match.id}&seasons[]=${sport.season}&per_page=100`)
    const rawGames = sData.data || []
    const games = rawGames
      .filter(g => bdlPlayed(g, lg))
      .sort((a, b) => gameSortKey(b) - gameSortKey(a))
      .slice(0, 15)

    const payload = {
      player: `${match.first_name} ${match.last_name}`,
      player_id: match.id,
      league: lg,
      games,
      note: games.length ? `${games.length} recent games from BALLDONTLIE.` : 'No recent games found for this season.'
    }
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
    let match = rawLines.find(l =>
      l.name.toLowerCase() === p.name.toLowerCase() &&
      l.stat.toLowerCase() === p.stat.toLowerCase()
    )
    if (!match) {
      match = rawLines.find(l => l.name.toLowerCase() === p.name.toLowerCase())
    }
    if (match) {
      p.val = String(match.line)
      p.stat = match.stat
      p.league = match.league || p.league
      p.team = match.team || p.team
      if (match.start_time) p.time = match.start_time
      if (match.date) p.date = match.date
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

    const picks = validateLines(dedupe(normalizePicks(JSON.parse(textBlock.text.slice(start, end + 1)))), rawLines)
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
    const picks = validateLines(dedupe(normalizePicks(parsed)), rawLines).filter(p => p.conf >= 90)
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