import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const SERP_KEY = process.env.VITE_SERPAPI_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function searchWeb(query) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_KEY}&num=5`
  const res = await fetch(url)
  const data = await res.json()
  const results = data.organic_results || []
  return results.map(r => `${r.title}: ${r.snippet}`).join('\n')
}

function normalizePicks(raw) {
  return raw.map((p, i) => ({
    id: p.id || i + 1,
    name: p.name || p.player || p.player_name || 'Unknown Player',
    meta: p.meta || `${p.sport || p.league || ''} · ${p.team || ''}`,
    stat: p.stat || p.prop_type || p.prop || p.category || 'Points',
    val: String(p.val || p.line || p.value || '0'),
    dir: (() => {
      const d = (p.dir || p.pick || p.over_under || p.direction || 'HIGHER').toUpperCase()
      if (d.includes('MORE') || d.includes('OVER') || d.includes('HIGHER')) return 'HIGHER'
      if (d.includes('LESS') || d.includes('UNDER') || d.includes('LOWER')) return 'LOWER'
      return 'HIGHER'
    })(),
    conf: Number(p.conf || p.confidence || 75),
    sport: p.sport || p.league || 'Sport',
    initials: p.initials || (p.name || p.player || 'XX').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(),
    bull: p.bull || p.reason || p.analysis || p.why || 'Strong pick based on current form.',
    bear: p.bear || p.risk || p.downside || p.concern || 'Variance possible.',
    cats: p.cats || [{ n: p.stat || p.prop_type || 'Points', p: Number(p.conf || p.confidence || 75) }],
    time: p.time || p.game_time || p.start_time || null,
    date: p.date || p.game_date || null
  }))
}

async function getPicksFromClaude(searchData, currentTime) {
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
        content: `CURRENT TIME: ${currentTime} ET

Here is current sports data. Create 6 prop picks using ONLY players from games that start AFTER the current time shown above. Any game that starts before or at ${currentTime} ET must be excluded — those games have already started or finished.

${searchData}

Output ONLY the JSON array starting with [ ending with ] nothing else:
[{"id":1,"name":"Player Name","meta":"League · Team","stat":"Hits","val":"1.5","dir":"HIGHER","conf":78,"sport":"MLB","initials":"PN","time":"7:05 PM ET","date":"Sat May 30","bull":"reason this pick hits","bear":"reason it could miss","cats":[{"n":"Hits","p":78},{"n":"Total Bases","p":71},{"n":"RBI","p":65}]}]

Rules:
- ONLY include games starting AFTER ${currentTime} ET
- dir must be HIGHER or LOWER
- conf is 50-95
- initials is 2 capital letters
- time is the game start time in ET
- date is the day of the game like "Sat May 30"
- Give exactly 6 picks
- Do not default to HIGHER — use LOWER when line is too high
- Mark any 90%+ confidence pick accordingly for GOLD status`
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system,
        messages: current
      })
    })

    const data = await res.json()
    if (!data.content) throw new Error(data.error?.message || 'No content')
    console.log('Chat turn', i, 'stop_reason:', data.stop_reason)

    if (data.stop_reason === 'tool_use') {
      current = [...current, { role: 'assistant', content: data.content }]
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(t => ({
          type: 'tool_result',
          tool_use_id: t.id,
          content: `Search done for: ${t.input?.query}`
        }))
      current = [...current, { role: 'user', content: toolResults }]
      continue
    }

    if (data.stop_reason === 'end_turn') {
      const textBlock = data.content.find(b => b.type === 'text')
      if (textBlock) return textBlock.text
    }

    throw new Error('Unexpected stop: ' + data.stop_reason)
  }
  throw new Error('Too many turns')
}

app.post('/picks', async (req, res) => {
  try {
    const { date, currentTime } = req.body
    console.log('Loading picks. Current time:', currentTime)

    const [s1, s2, s3, s4, s5] = await Promise.all([
      searchWeb(`PrizePicks best picks available upcoming games not started`),
      searchWeb(`MLB best prop picks upcoming games tomorrow ${date}`),
      searchWeb(`WNBA best prop picks upcoming games ${date}`),
      searchWeb(`esports CS2 League of Legends best picks upcoming matches ${date}`),
      searchWeb(`PrizePicks top picks best slate available now upcoming only`)
    ])

    const searchData = `PRIZEPICKS BEST PICKS:\n${s1}\n\nMLB UPCOMING:\n${s2}\n\nWNBA UPCOMING:\n${s3}\n\nESPORTS UPCOMING:\n${s4}\n\nTOP SLATE:\n${s5}`

    console.log('Search done, sending to Claude with current time filter...')
    const reply = await getPicksFromClaude(searchData, currentTime)
    console.log('Claude reply:', reply.substring(0, 300))

    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON array found. Please retry.')
    const raw = JSON.parse(reply.slice(start, end + 1))
    const picks = normalizePicks(raw)
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    if (e.message.includes('rate_limit') || e.message.includes('rate limit') || e.message.includes('Too Many') || e.message.includes('credit')) {
      res.status(500).json({ error: 'Rate limit reached. Please wait 3-5 minutes and tap retry.' })
    } else {
      res.status(500).json({ error: e.message })
    }
  }
})

app.post('/chat', async (req, res) => {
  try {
    const { messages, currentTime } = req.body
    console.log('Chat request received, current time:', currentTime)

    const lastMsg = messages[messages.length - 1]?.content || ''
    const [search1, search2] = await Promise.all([
      searchWeb(`PrizePicks best picks available now upcoming games not started`),
      searchWeb(`sports picks best slate MLB WNBA esports upcoming games not started`)
    ])

    const messagesWithContext = [...messages]
    messagesWithContext[messagesWithContext.length - 1] = {
      role: 'user',
      content: `CURRENT TIME: ${currentTime} ET. Only recommend picks from games starting after this time.\n\n${lastMsg}\n\nCurrent sports data:\n${search1}\n\n${search2}`
    }

    const reply = await callClaude(
      messagesWithContext,
      `You are the Trip Predicts AI analyst — a sharp confident prop pick advisor for PrizePicks. Only recommend picks from games that have NOT started yet — always check the current time provided and exclude any games before it. You cover NBA, WNBA, NFL, MLB, NHL, CS2, League of Legends, Valorant, and other esports. Confidence tiers: Regular below 75%, High 75-89%, GOLD 90%+ rare and elite. Mix sports and esports for strongest slate. Do not default to HIGHER — use LOWER when line is too high. Keep responses sharp direct and conversational. Never use em dashes. Bold key info with **text**.`
    )
    res.json({ reply })
  } catch (e) {
    console.error('Chat error:', e.message)
    if (e.message.includes('rate_limit') || e.message.includes('rate limit') || e.message.includes('Too Many') || e.message.includes('credit')) {
      res.status(500).json({ error: 'Rate limit reached. Please wait 3-5 minutes and try again.' })
    } else {
      res.status(500).json({ error: e.message })
    }
  }
})

app.listen(3001, () => console.log('Trip Predicts server running on port 3001'))