console.log('SERVER STARTING - node is running')
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

let ppCache = { data: null, ts: 0 }
const CACHE_TTL = 5 * 60 * 1000

function sortLines(rawLines) {
  if (!rawLines) return []
  const PRIORITY = { 'NBA': 1, 'MLB': 2, 'NHL': 3, 'NFL': 4, 'CS2': 5, 'LOL': 5, 'VALORANT': 5, 'COD': 5 }
  const groups = {}
  rawLines.forEach(l => {
    const league = (l.league || 'OTHER').toUpperCase()
    if (!groups[league]) groups[league] = []
    groups[league].push(l)
  })
  const sorted = Object.entries(groups).sort(([a], [b]) => {
    const pa = PRIORITY[a] || 99
    const pb = PRIORITY[b] || 99
    return pa - pb
  })
  const result = []
  const perSport = Math.max(5, Math.floor(80 / sorted.length))
  sorted.forEach(([, lines]) => {
    result.push(...lines.slice(0, perSport))
  })
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
    initials: p.initials || (p.name || 'XX').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(),
    bull: p.bull || 'Strong pick based on current form.',
    bear: p.bear || 'Variance possible.',
    cats: p.cats || [{ n: p.stat || 'Points', p: Number(p.conf || 75) }],
    time: p.time || null,
    date: p.date || null
  }))
}

app.get('/prizepicks/all', async (req, res) => {
  try {
    const now = Date.now()
    if (ppCache.data && now - ppCache.ts < CACHE_TTL) {
      console.log('Serving PrizePicks from cache')
      return res.json(ppCache.data)
    }
    const target = encodeURIComponent(`https://api.prizepicks.com/projections?per_page=250&single_stat=true`)
    const response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}`)
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
    const response = await fetch(`https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${target}`)
    const data = await response.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/picks', async (req, res) => {
  try {
    const { currentTime, lines: rawLines } = req.body
    const lines = sortLines(rawLines)
    console.log('Analyzing', lines?.length, 'real PrizePicks lines')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const linesText = lines.map(l =>
      `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`
    ).join('\n')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{
          role: 'user',
          content: `Current time: ${currentTime} ET

These are REAL live PrizePicks lines pulled directly from their platform right now. Use ONLY these exact player names and exact line numbers — do not change any numbers:

${linesText}

Select the best 6 picks. Prioritize NBA, MLB, NHL, NFL, and esports over WNBA or niche sports. Look for lines where the player has a clear statistical edge — recent form, favorable matchup, pace of play, or usage rate. Give exactly 6 picks spread across AT LEAST 3 different sports or leagues. Do not give more than 2 picks from the same league.

Output ONLY this JSON array:
[{"id":1,"name":"exact player name from above","meta":"League · Team","stat":"exact stat from above","val":"exact line number from above","dir":"HIGHER","conf":88,"sport":"NBA","initials":"PN","time":"exact time from above","date":"exact date from above","bull":"specific reason based on matchup or form","bear":"real risk factor","cats":[{"n":"stat name","p":88},{"n":"other stat","p":75}]}]

Rules: Use exact names stats and line numbers from the data above. dir HIGHER or LOWER based on analysis. conf 50-95. Do not default to HIGHER. Give exactly 6 picks. Max 2 picks per league.`
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

    const picks = normalizePicks(JSON.parse(textBlock.text.slice(start, end + 1)))
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/gold', async (req, res) => {
  try {
    const { currentTime, lines: rawLines } = req.body
    const lines = sortLines(rawLines)
    console.log('Finding gold from', lines?.length, 'real lines')
    if (!lines || lines.length === 0) throw new Error('No lines provided')

    const linesText = lines.map(l =>
      `${l.name} (${l.league} · ${l.team}) | ${l.stat}: ${l.line} | ${l.date} ${l.start_time}`
    ).join('\n')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
        messages: [{
          role: 'user',
          content: `Current time: ${currentTime} ET

These are REAL live PrizePicks lines. Find only the highest confidence picks (90%+).

Prioritize NBA, MLB, NHL, NFL, and esports over WNBA or niche sports. Only include picks you are genuinely 90%+ confident in based on recent form, matchup, usage, or statistical edge. Spread across AT LEAST 2 different leagues. Do not give more than 2 picks from the same league.

${linesText}

Output ONLY this JSON array:
[{"id":1,"name":"exact player name","meta":"League · Team","stat":"exact stat","val":"exact line","dir":"HIGHER","conf":92,"sport":"NBA","initials":"PN","time":"exact time","date":"exact date","bull":"specific matchup or form reason","bear":"real risk","cats":[{"n":"stat","p":92},{"n":"other","p":80}]}]

Rules: Use exact names stats and lines from above. Only include picks you are 90%+ confident in. Do not default to HIGHER. Max 2 picks per league.`
        }]
      })
    })

    const data = await response.json()
    const textBlock = data.content?.find(b => b.type === 'text')
    if (!textBlock) throw new Error('No response')

    const start = textBlock.text.indexOf('[')
    const end = textBlock.text.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No gold picks right now.')

    const picks = normalizePicks(JSON.parse(textBlock.text.slice(start, end + 1))).filter(p => p.conf >= 90)
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
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are the Trip Predicts AI analyst for PrizePicks. You have real live prop lines provided to you. Use them. Prioritize NBA, MLB, NHL, NFL, and esports picks. Only recommend WNBA or niche sports if explicitly asked or nothing else is available. Look for clear statistical edges — recent form, matchup advantages, usage rates, pace of play. Only recommend picks from games in the next 36 hours. Spread picks across multiple sports when building lineups — never more than 2 from the same league. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Do not default to HIGHER. Keep responses sharp and direct. Never use em dashes. Bold key info with **text**.`,
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