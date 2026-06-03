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

// Stripe webhook MUST come before express.json()
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
      const sub = await stripe.subscriptions.retrieve(session.subscription)
      await supabaseAdmin.from('subscriptions').upsert({
        user_id: session.client_reference_id,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      await supabaseAdmin.from('subscriptions').update({
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }).eq('stripe_subscription_id', sub.id)
    }
  } catch (e) {
    console.error('Webhook handler error:', e.message)
  }
  res.json({ received: true })
})

app.use(express.json({ limit: '10mb' }))

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
    if (!match) match = rawLines.find(l => l.name.toLowerCase() === p.name.toLowerCase())
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

async function fetchLinesServer() {
  const target = encodeURIComponent(`https://api.prizepicks.com/projections?per_page=250&single_stat=true`)
  const response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}&ultra_premium=true`)
  const data = await response.json()
  if (!data.data || !data.included) return []
  const players = {}
  data.included.forEach(item => {
    if (item.type === 'new_player') {
      players[item.id] = { name: item.attributes.display_name || item.attributes.name, team: item.attributes.team, league: item.attributes.league }
    }
  })
  const results = []
  const now = new Date()
  data.data.forEach(proj => {
    const startTime = new Date(proj.attributes.start_time)
    const hoursUntil = (startTime - now) / (1000 * 60 * 60)
    if (proj.attributes.status !== 'pre_game') return
    if (hoursUntil < 0 || hoursUntil > 36) return
    const player = players[proj.relationships?.new_player?.data?.id]
    if (!player || !player.name) return
    results.push({ name: player.name, team: player.team, league: player.league, stat: proj.attributes.stat_display_name, line: proj.attributes.line_score })
  })
  return results
}

async function generateGoldForLeague(lines, league) {
  const sorted = sortLines(lines, league)
  if (!sorted || sorted.length === 0) return []
  const linesText = sorted.map(l => `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line}`).join('\n')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. Start with [ end with ].`,
      messages: [{ role: 'user', content: `These are REAL live PrizePicks lines for ${league}. Find your top 4-6 picks at 90%+ confidence. Return at least 3. Copy line numbers exactly.\n\n${linesText}\n\nOutput ONLY a JSON array:\n[{"id":1,"name":"exact name","meta":"League · Team","stat":"exact stat","val":"exact line","dir":"HIGHER","conf":92,"sport":"${league}","league":"${league}","initials":"PN","bull":"reason","bear":"risk","record":"Hit in 12 of last 15 games","cats":[{"n":"stat","p":92}]}]\n\nRules: conf 90+, never pick same player twice, always at least 3 picks.` }]
    })
  })
  const data = await response.json()
  if (!data.content) return []
  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock) return []
  const start = textBlock.text.indexOf('[')
  const end = textBlock.text.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  const parsed = JSON.parse(textBlock.text.slice(start, end + 1))
  return validateLines(dedupe(normalizePicks(parsed)), lines).filter(p => p.conf >= 90)
}

// ===== TWICE-DAILY OFFICIAL GOLD GENERATION + LOGGING =====
app.post('/cron/generate-gold', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
    const slot = Number(hour) < 14 ? 'morning' : 'evening'
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD

    const lines = await fetchLinesServer()
    if (lines.length === 0) return res.json({ ok: false, reason: 'no lines' })

    const leaguesPresent = [...new Set(lines.map(l => (l.league || '').toUpperCase()).filter(Boolean))]
    const TARGET = ['NBA', 'MLB', 'NHL', 'NFL', 'CS2', 'LOL', 'VALORANT', 'COD', 'WNBA', 'SOCCER', 'TENNIS', 'GOLF', 'MMA']
    const leagues = TARGET.filter(l => leaguesPresent.includes(l))

    let totalLogged = 0
    for (const league of leagues) {
      const picks = await generateGoldForLeague(lines, league)
      for (const p of picks) {
        await supabaseAdmin.from('gold_picks').insert({
          pick_date: today,
          slot,
          league: p.league,
          player_name: p.name,
          team: p.team || null,
          stat: p.stat,
          line: Number(p.val),
          direction: p.dir,
          confidence: p.conf
        })
        totalLogged++
      }
      await sleep(1500)
    }
    console.log(`Cron ${slot} ${today}: logged ${totalLogged} gold picks across ${leagues.length} leagues`)
    res.json({ ok: true, slot, date: today, logged: totalLogged, leagues })
  } catch (e) {
    console.error('Cron gold error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('/prizepicks/all', async (req, res) => {
  try {
    const now = Date.now()
    if (ppCache.data && now - ppCache.ts < CACHE_TTL) return res.json(ppCache.data)
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
    if (!lines || lines.length === 0) throw new Error('No lines provided')
    const linesText = lines.map(l => `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`).join('\n')
    const spreadRule = league
      ? `All picks must be from ${league}. Select the best ${pickCount} picks from the lines above.`
      : `Select the best ${pickCount} picks. Spread across AT LEAST 3 different sports or leagues. Max 2 picks from the same league. Prioritize NBA, MLB, NHL, NFL, esports over WNBA or niche sports.`
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{ role: 'user', content: `Current time: ${currentTime} ET\n\nThese are REAL live PrizePicks lines. Use ONLY these exact player names and exact line numbers — copy the number after the colon exactly, do not change it:\n\n${linesText}\n\n${spreadRule}\n\nFor each pick, determine direction (HIGHER or LOWER) based on concrete statistical evidence. Once you decide a direction, commit to it.\n\nOutput ONLY this JSON array:\n[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":88,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason","bear":"real risk","record":"12 of last 15 games cleared this line","cats":[{"n":"stat","p":88}]}]\n\nRules:\n- Copy the line number EXACTLY — never change it\n- dir must be HIGHER or LOWER based on clear statistical evidence\n- conf is 50-95\n- record: short specific statement like "11 of last 14 games hit this line"\n- NEVER pick the same player more than once\n- Give exactly ${pickCount} picks` }]
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
    if (!lines || lines.length === 0) throw new Error('No lines provided')
    const linesText = lines.map(l => `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`).join('\n')
    const spreadRule = league
      ? `All picks must be from ${league}.`
      : `Prioritize NBA, MLB, NHL, NFL, esports. Spread across AT LEAST 2 different leagues. Max 2 picks per league.`
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{ role: 'user', content: `Current time: ${currentTime} ET\n\nThese are REAL live PrizePicks lines. Find the highest confidence picks at 90%+ confidence only. Copy line numbers exactly — never change them:\n\n${spreadRule}\n\n${linesText}\n\nFind your top 4-6 picks where you are genuinely 90%+ confident based on recent player performance and matchup. You MUST return at least 3 picks — never return an empty array. Only assign 90%+ confidence when genuinely warranted by recent stats and form.\n\nOutput ONLY this JSON array:\n[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line number","dir":"HIGHER","conf":92,"sport":"NBA","league":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific reason why this hits","bear":"real risk factor","record":"Hit this line in 12 of his last 15 games","cats":[{"n":"stat name","p":92}]}]\n\nRules:\n- Copy line numbers EXACTLY — never change them\n- conf must be 90 or above — never assign below 90 on this endpoint\n- dir is HIGHER or LOWER based on real statistical evidence — never guess\n- record: MUST be specific like "Hit in 11 of last 14 games"\n- NEVER pick the same player twice\n- Always return at least 3 picks` }]
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
    current[current.length - 1] = { role: 'user', content: `Current time: ${currentTime} ET\n\n${lastMsg}\n\nLive PrizePicks lines right now:\n${linesText}` }
    for (let i = 0; i < 10; i++) {
      if (i > 0) await sleep(3000)
      const res2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are the Trip Predicts AI analyst for PrizePicks. You have real live prop lines provided to you. Always use the exact line numbers from the data — never change them. Prioritize NBA, MLB, NHL, NFL, and esports. Only recommend WNBA or niche sports if explicitly asked. Look for clear statistical edges. Only recommend picks from games in the next 36 hours. Never recommend the same player twice. Spread picks across multiple sports — never more than 2 from the same league. When recommending direction, commit to it based on data. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Never use em dashes. Bold key info with **text**.`,
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