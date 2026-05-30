import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const SERP_KEY = process.env.VITE_SERPAPI_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function searchWeb(query) {
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_KEY}&num=5`
    const res = await fetch(url)
    const data = await res.json()
    const results = data.organic_results || []
    return results.map(r => `${r.title}: ${r.snippet}`).join('\n')
  } catch (e) {
    return ''
  }
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

async function analyzeWithClaude(searchData, mode, currentTime) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are a PrizePicks prop analyst. Output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
      messages: [{
        role: 'user',
        content: `Current time: ${currentTime} ET

Here is sports data about games happening in the next 36 hours. ${mode === 'gold' ? 'Find the 3-4 highest confidence picks (90%+) only.' : 'Select the best 6 picks across all sports.'}

${searchData}

Output ONLY this JSON array with nothing else:
[{"id":1,"name":"Player Name","meta":"League · Team","stat":"Points","val":"24.5","dir":"LOWER","conf":88,"sport":"NBA","initials":"PN","time":"8:00 PM ET","date":"Sat May 30","bull":"specific reason","bear":"real risk","cats":[{"n":"Points","p":88},{"n":"Assists","p":72}]}]

Rules:
- Only use players from games in the next 36 hours from ${currentTime} ET
- dir must be HIGHER or LOWER based on what is stronger
- conf 50-95
- initials 2 capital letters
- time and date of the actual game
- Do NOT default to HIGHER — analyze carefully
- ${mode === 'gold' ? 'Only include 90%+ confidence picks' : 'Give exactly 6 picks'}`
      }]
    })
  })

  const data = await res.json()
  if (!data.content) throw new Error(data.error?.message || 'No content')
  const textBlock = data.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No text response')
  return textBlock.text
}

async function callClaude(messages, system) {
  let current = [...messages]
  for (let i = 0; i < 10; i++) {
    if (i > 0) await sleep(3000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], system, messages: current })
    })
    const data = await res.json()
    if (!data.content) throw new Error(data.error?.message || 'No content')
    if (data.stop_reason === 'tool_use') {
      current = [...current, { role: 'assistant', content: data.content }]
      const toolResults = data.content.filter(b => b.type === 'tool_use').map(t => ({ type: 'tool_result', tool_use_id: t.id, content: `Search done for: ${t.input?.query}` }))
      current = [...current, { role: 'user', content: toolResults }]
      continue
    }
    if (data.stop_reason === 'end_turn') {
      const textBlock = data.content.find(b => b.type === 'text')
      if (textBlock) return textBlock.text
    }
    throw new Error('Unexpected stop')
  }
  throw new Error('Too many turns')
}

async function getLiveData(date) {
  console.log('Searching for live sports data...')
  const [nba, mlb, wnba, esports, prizepicks] = await Promise.all([
    searchWeb(`NBA Spurs Thunder Game 7 tonight May 30 2026 PrizePicks props player props`),
    searchWeb(`MLB games tonight May 30 2026 PrizePicks player props picks`),
    searchWeb(`WNBA games tonight May 30 2026 PrizePicks player props`),
    searchWeb(`esports CS2 League of Legends PrizePicks props tonight May 30 2026`),
    searchWeb(`PrizePicks best picks today May 30 2026 NBA MLB WNBA`)
  ])
  return `NBA GAME 7 SPURS VS THUNDER TONIGHT 8PM ET:\n${nba}\n\nMLB TONIGHT:\n${mlb}\n\nWNBA TONIGHT:\n${wnba}\n\nESOPRTS TONIGHT:\n${esports}\n\nPRIZEPICKS TODAY:\n${prizepicks}`
}

app.post('/picks', async (req, res) => {
  try {
    const { currentTime } = req.body
    console.log('Loading picks, current time:', currentTime)
    const searchData = await getLiveData()
    const reply = await analyzeWithClaude(searchData, 'all', currentTime)
    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('Please retry in a moment.')
    const picks = normalizePicks(JSON.parse(reply.slice(start, end + 1)))
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/gold', async (req, res) => {
  try {
    const { currentTime } = req.body
    console.log('Loading gold picks')
    const searchData = await getLiveData()
    const reply = await analyzeWithClaude(searchData, 'gold', currentTime)
    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No gold picks found right now.')
    const picks = normalizePicks(JSON.parse(reply.slice(start, end + 1))).filter(p => p.conf >= 90)
    console.log('Got', picks.length, 'gold picks')
    res.json({ picks })
  } catch (e) {
    console.error('Gold error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/chat', async (req, res) => {
  try {
    const { messages, currentTime } = req.body
    const lastMsg = messages[messages.length - 1]?.content || ''
    const searchData = await getLiveData()
    const messagesWithContext = [...messages]
    messagesWithContext[messagesWithContext.length - 1] = {
      role: 'user',
      content: `Current time: ${currentTime} ET\n\n${lastMsg}\n\nLive sports data:\n${searchData}`
    }
    const reply = await callClaude(
      messagesWithContext,
      `You are the Trip Predicts AI analyst for PrizePicks. You have live sports data. Only recommend picks from games in the next 36 hours. Cover NBA, WNBA, MLB, NHL, esports. Tiers: Regular below 75%, High 75-89%, GOLD 90%+. Do not default to HIGHER. Keep it sharp and direct. Never use em dashes. Bold key info with **text**.`
    )
    res.json({ reply })
  } catch (e) {
    console.error('Chat error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.listen(3001, () => console.log('Trip Predicts server running on port 3001'))