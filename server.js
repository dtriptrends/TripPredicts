import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getPrizePicksLines() {
  try {
    const res = await fetch('https://api.prizepicks.com/projections?league_id=2&per_page=50&single_stat=true', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    })
    const data = await res.json()
    return data
  } catch (e) {
    console.log('PrizePicks fetch error:', e.message)
    return null
  }
}

function normalizePicks(raw) {
  return raw.map((p, i) => ({
    id: p.id || i + 1,
    name: p.name || p.player || 'Unknown Player',
    meta: p.meta || `${p.sport || ''} · ${p.team || ''}`,
    stat: p.stat || p.prop_type || 'Points',
    val: String(p.val || p.line || '0'),
    dir: (() => {
      const d = (p.dir || p.pick || 'HIGHER').toUpperCase()
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

async function analyzeWithClaude(prizePicksData, currentTime, allOrGold) {
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

Here are the ACTUAL live PrizePicks prop lines available right now. These are real lines directly from PrizePicks API:

${JSON.stringify(prizePicksData, null, 2)}

${allOrGold === 'gold'
  ? `From these real lines, find ONLY the 3-4 strongest picks with 90%+ confidence. These are GOLD tier picks only.`
  : `From these real lines, select the 6 best picks. Include a mix of sports.`
}

Output ONLY a JSON array with nothing else:
[{"id":1,"name":"Player Name","meta":"League · Team","stat":"Hits","val":"1.5","dir":"HIGHER","conf":78,"sport":"MLB","initials":"PN","time":"7:05 PM ET","date":"Sat May 30","bull":"reason","bear":"risk","cats":[{"n":"Hits","p":78},{"n":"Total Bases","p":71}]}]

Rules: dir must be HIGHER or LOWER. conf 50-95. initials 2 capital letters. Only use players and lines from the data above. Do not make up lines.`
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
    const { currentTime } = req.body
    console.log('Loading picks. Current time:', currentTime)

    const ppData = await getPrizePicksLines()
    if (!ppData) throw new Error('Could not fetch PrizePicks data. Please retry.')

    console.log('Got PrizePicks data, analyzing...')
    const reply = await analyzeWithClaude(ppData, currentTime, 'all')

    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON found. Please retry.')
    const raw = JSON.parse(reply.slice(start, end + 1))
    const picks = normalizePicks(raw)
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    if (e.message.includes('rate_limit') || e.message.includes('Too Many') || e.message.includes('credit')) {
      res.status(500).json({ error: 'Rate limit reached. Please wait 3-5 minutes and tap retry.' })
    } else {
      res.status(500).json({ error: e.message })
    }
  }
})

app.post('/gold', async (req, res) => {
  try {
    const { currentTime } = req.body
    console.log('Loading gold picks. Current time:', currentTime)

    const ppData = await getPrizePicksLines()
    if (!ppData) throw new Error('Could not fetch PrizePicks data. Please retry.')

    console.log('Got PrizePicks data, finding gold picks...')
    const reply = await analyzeWithClaude(ppData, currentTime, 'gold')

    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No gold picks found right now. Try again later.')
    const raw = JSON.parse(reply.slice(start, end + 1))
    const picks = normalizePicks(raw).filter(p => p.conf >= 90)
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
    console.log('Chat request received')

    const lastMsg = messages[messages.length - 1]?.content || ''
    const messagesWithContext = [...messages]
    messagesWithContext[messagesWithContext.length - 1] = {
      role: 'user',
      content: `CURRENT TIME: ${currentTime} ET. Only recommend picks from games starting after this time.\n\n${lastMsg}`
    }

    const reply = await callClaude(
      messagesWithContext,
      `You are the Trip Predicts AI analyst — a sharp confident prop pick advisor for PrizePicks. Only recommend picks from games that have NOT started yet. You cover NBA, WNBA, NFL, MLB, NHL, CS2, League of Legends, Valorant, and other esports. Confidence tiers: Regular below 75%, High 75-89%, GOLD 90%+ rare and elite. Mix sports and esports. Do not default to HIGHER — use LOWER when line is too high. Keep responses sharp direct and conversational. Never use em dashes. Bold key info with **text**.`
    )
    res.json({ reply })
  } catch (e) {
    console.error('Chat error:', e.message)
    if (e.message.includes('rate_limit') || e.message.includes('Too Many') || e.message.includes('credit')) {
      res.status(500).json({ error: 'Rate limit reached. Please wait 3-5 minutes and try again.' })
    } else {
      res.status(500).json({ error: e.message })
    }
  }
})

app.listen(3001, () => console.log('Trip Predicts server running on port 3001'))