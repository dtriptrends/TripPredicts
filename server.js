import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const API_KEY = process.env.VITE_ANTHROPIC_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

// PrizePicks league IDs
const LEAGUES = {
  MLB: 2,
  NBA: 7,
  WNBA: 3,
  NHL: 4,
  NFL: 9,
  ESPORTS: 14
}

async function fetchLeague(leagueId) {
  try {
    const res = await fetch(`https://api.prizepicks.com/projections?league_id=${leagueId}&per_page=25&single_stat=true`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    })
    const data = await res.json()
    if (!data.data || data.data.length === 0) return []

    const players = {}
    if (data.included) {
      data.included.forEach(item => {
        if (item.type === 'new_player') {
          players[item.id] = {
            name: item.attributes.display_name || item.attributes.name,
            team: item.attributes.team,
            position: item.attributes.position,
            image: item.attributes.image_url,
            league: item.attributes.league
          }
        }
      })
    }

    return data.data.map(proj => {
      const playerId = proj.relationships?.new_player?.data?.id
      const player = players[playerId] || {}
      return {
        player_id: playerId,
        name: player.name || 'Unknown',
        team: player.team || proj.attributes.description || '',
        position: player.position || '',
        image: player.image || null,
        league: player.league || '',
        stat: proj.attributes.stat_display_name,
        line: proj.attributes.line_score,
        start_time: proj.attributes.start_time,
        status: proj.attributes.status,
        game_id: proj.attributes.game_id
      }
    }).filter(p => {
  if (p.status !== 'pre_game' || p.name === 'Unknown') return false
  if (!p.start_time) return false
  const gameTime = new Date(p.start_time)
  const now = new Date()
  const hoursUntilGame = (gameTime - now) / (1000 * 60 * 60)
  return hoursUntilGame >= -1 && hoursUntilGame <= 36
})
  } catch (e) {
    console.log(`League ${leagueId} fetch error:`, e.message)
    return []
  }
}

function formatTime(isoTime) {
  if (!isoTime) return null
  const d = new Date(isoTime)
  return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET'
}

function formatDate(isoTime) {
  if (!isoTime) return null
  const d = new Date(isoTime)
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
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
    date: p.date || null,
    image: p.image || null
  }))
}

async function analyzeWithClaude(projections, mode) {
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
      system: `You are a PrizePicks prop analyst. You receive real live prop lines and output ONLY a valid JSON array. No text before or after. Start with [ end with ].`,
      messages: [{
        role: 'user',
        content: `These are REAL live PrizePicks prop lines available right now. Analyze them and ${mode === 'gold' ? 'find the 3-4 highest confidence picks (90%+)' : 'select the best 6 picks'}.

${JSON.stringify(projections.slice(0, 80), null, 2)}

Output ONLY this JSON array with nothing else:
[{"id":1,"name":"Player Name","meta":"League · Team","stat":"Hits","val":"1.5","dir":"LOWER","conf":88,"sport":"MLB","initials":"PN","time":"7:05 PM ET","date":"Sat May 30","bull":"specific reason based on real stats","bear":"real risk factor","cats":[{"n":"Hits","p":88},{"n":"Total Bases","p":75}]}]

Rules:
- Use ONLY players from the data above with their exact names teams and lines
- dir must be HIGHER or LOWER — analyze which direction is stronger
- conf 50-95 based on how strong the pick is
- initials 2 capital letters
- time and date from the start_time in the data
- Do NOT default to HIGHER — use LOWER when the line is set too high
- ${mode === 'gold' ? 'Only include picks with 90%+ confidence' : 'Give exactly 6 picks'}`
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

async function getLiveProjections() {
  console.log('Fetching live PrizePicks data...')
  const [mlb, wnba, nba, nhl, esports] = await Promise.all([
    fetchLeague(LEAGUES.MLB),
    fetchLeague(LEAGUES.WNBA),
    fetchLeague(LEAGUES.NBA),
    fetchLeague(LEAGUES.NHL),
    fetchLeague(LEAGUES.ESPORTS)
  ])

  const all = [
    ...mlb.map(p => ({ ...p, sportLabel: 'MLB' })),
    ...wnba.map(p => ({ ...p, sportLabel: 'WNBA' })),
    ...nba.map(p => ({ ...p, sportLabel: 'NBA' })),
    ...nhl.map(p => ({ ...p, sportLabel: 'NHL' })),
    ...esports.map(p => ({ ...p, sportLabel: 'Esports' }))
  ]

  console.log(`Found ${mlb.length} MLB, ${wnba.length} WNBA, ${nba.length} NBA, ${nhl.length} NHL, ${esports.length} Esports projections`)
  return all
}

app.post('/picks', async (req, res) => {
  try {
    const projections = await getLiveProjections()
    if (projections.length === 0) throw new Error('No live props found right now. Check back soon.')

    const formatted = projections.map(p => ({
      name: p.name,
      team: p.team,
      sport: p.sportLabel,
      stat: p.stat,
      line: p.line,
      start_time: formatTime(p.start_time),
      date: formatDate(p.start_time),
      image: p.image
    }))

    const reply = await analyzeWithClaude(formatted, 'all')
    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON found. Please retry.')

    const raw = JSON.parse(reply.slice(start, end + 1))
    const imageMap = {}
    projections.forEach(p => { imageMap[p.name] = p.image })
    raw.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

    const picks = normalizePicks(raw)
    console.log('Got', picks.length, 'picks')
    res.json({ picks })
  } catch (e) {
    console.error('Picks error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/gold', async (req, res) => {
  try {
    const projections = await getLiveProjections()
    if (projections.length === 0) throw new Error('No live props found right now.')

    const formatted = projections.map(p => ({
      name: p.name, team: p.team, sport: p.sportLabel, stat: p.stat, line: p.line,
      start_time: formatTime(p.start_time), date: formatDate(p.start_time)
    }))

    const reply = await analyzeWithClaude(formatted, 'gold')
    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No gold picks found right now.')

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
    const projections = await getLiveProjections()
    const liveData = projections.slice(0, 30).map(p => `${p.name} (${p.sportLabel} · ${p.team}) ${p.stat} ${p.line} - ${formatTime(p.start_time)}`).join('\n')

    const lastMsg = messages[messages.length - 1]?.content || ''
    const messagesWithContext = [...messages]
    messagesWithContext[messagesWithContext.length - 1] = {
      role: 'user',
      content: `${lastMsg}\n\nCurrent time: ${currentTime} ET\n\nLive PrizePicks props available right now:\n${liveData}`
    }

    const reply = await callClaude(
      messagesWithContext,
      `You are the Trip Predicts AI analyst — sharp and confident. You have been given real live PrizePicks prop lines. Use them to make picks. Never say you lack data. You cover MLB, WNBA, NBA, NHL, and esports. Confidence tiers: Regular below 75%, High 75-89%, GOLD 90%+ rare. Mix sports for best slate. Do not default to HIGHER — use LOWER when line is too high. Keep responses sharp and direct. Never use em dashes. Bold key info with **text**.`
    )
    res.json({ reply })
  } catch (e) {
    console.error('Chat error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.listen(3001, () => console.log('Trip Predicts server running on port 3001'))