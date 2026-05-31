import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const STEP_LABELS = [
  ['CONNECTING', 'LIVE LINES', 'AI ANALYSIS', 'YOUR SLATE'],
  ['STARTING UP', 'FETCHING PROPS', 'RUNNING MODELS', 'LOCKING PLAYS'],
  ['GOING LIVE', 'LOADING BOARD', 'FINDING EDGES', 'BUILDING SLATE'],
  ['FIRING UP', 'REAL-TIME DATA', 'MATCHUP CHECK', 'DROPPING PICKS'],
  ['BOOTING', 'SCANNING LINES', 'WEIGHING FORM', 'FINALIZING'],
]

const FACTS = [
  'Trip Predicts pulls live lines directly from PrizePicks every time you load.',
  'Gold picks require 90% confidence or higher. Most sessions only have 1 or 2.',
  'Every pick shows a bull case and a bear case so you know the risk upfront.',
  'The AI never defaults to HIGHER. Direction is set by the data.',
  'Picks are spread across at least 3 different leagues every slate.',
  'No more than 2 picks from the same league in a single set.',
  'Trip Predicts covers NBA, MLB, NHL, NFL, CS2, LoL, Valorant and more.',
  'Over 250 live props are scanned every single time you hit load.',
  'Recent form is weighted more heavily than season averages for prop bets.',
  'High usage players hit volume-based lines more consistently over time.',
  'A weak opponent matchup is one of the strongest signals for a prop to hit.',
  'The confidence score runs from 50 to 95. Gold means 90 or above.',
  'Stat category breakdown is shown on every card so you can make your own call.',
  'Lines are filtered to only show pre-game props starting within 36 hours.',
  'The AI weighs pace of play, usage rate, recent form and matchup strength.',
  'Trip Predicts was built to give everyday bettors a real analytical edge.',
  'You can hit Refresh at any time to pull a fresh set of AI-selected plays.',
  'The backend caches PrizePicks data every 5 minutes for faster load times.',
  'Esports props are included — CS2, LoL and Valorant all have strong lines.',
  'HIGHER or LOWER is never a guess. The model picks a direction based on stats.',
  'Gold picks are rare. When they show up, they carry real conviction behind them.',
  'Each card has a TRIP PREDICTS watermark so your screenshots carry the brand.',
  'The AI looks for hot streaks first. A player in form is the best edge available.',
  'Props are only shown if they are pre-game. No in-play or already started lines.',
  'Trip Predicts is free to use. No account needed. Just open and get your picks.',
  'The confidence bar fills up live when each card loads. Watch it climb.',
  'Bull case tells you why the pick hits. Bear case tells you why it might not.',
  'A balanced slate beats a single-sport parlay almost every time.',
  'The AI scans all available leagues simultaneously to find the best plays.',
]

async function fetchPrizePicksLines() {
  const results = []
  try {
    const res = await fetch(`${SERVER}/prizepicks/all`)
    const data = await res.json()
    if (!data.data || !data.included) return results
    const players = {}
    data.included.forEach(item => {
      if (item.type === 'new_player') {
        players[item.id] = {
          name: item.attributes.display_name || item.attributes.name,
          team: item.attributes.team,
          league: item.attributes.league,
          image: item.attributes.image_url
        }
      }
    })
    const now = new Date()
    data.data.forEach(proj => {
      const startTime = new Date(proj.attributes.start_time)
      const hoursUntil = (startTime - now) / (1000 * 60 * 60)
      if (proj.attributes.status !== 'pre_game') return
      if (hoursUntil < 0 || hoursUntil > 36) return
      const playerId = proj.relationships?.new_player?.data?.id
      const player = players[playerId]
      if (!player || !player.name) return
      results.push({
        name: player.name,
        team: player.team,
        league: player.league,
        image: player.image,
        stat: proj.attributes.stat_display_name,
        line: proj.attributes.line_score,
        start_time: startTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET',
        date: startTime.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
      })
    })
  } catch (e) {
    console.log('Fetch error:', e.message)
  }
  return results
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Tonight() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [liveCount, setLiveCount] = useState(0)
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [stepLabels, setStepLabels] = useState(STEP_LABELS[0])
  const [facts, setFacts] = useState(FACTS)
  const [factIdx, setFactIdx] = useState(0)
  const [factVisible, setFactVisible] = useState(true)

  const now = new Date()
  const hour = now.getHours()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const isLate = hour >= 22
  const displayDate = isLate
    ? tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const pageTitle = isLate ? "TOMORROW'S PICKS" : "TONIGHT'S PICKS"
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => {
    const t = setTimeout(() => loadPicks(), 500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setFactVisible(false)
      setTimeout(() => {
        setFactIdx(i => (i + 1) % facts.length)
        setFactVisible(true)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [loading, facts])

  async function loadPicks() {
    const labels = STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)]
    const shuffledFacts = shuffle(FACTS)
    setStepLabels(labels)
    setFacts(shuffledFacts)
    setLoading(true)
    setError(null)
    setPicks([])
    setProgress(0)
    setStepIdx(0)
    setFactIdx(0)
    setFactVisible(true)

    await new Promise(r => setTimeout(r, 300))
    setProgress(15)

    try {
      setStepIdx(1)
      setProgress(25)

      const lines = await fetchPrizePicksLines()
      setProgress(55)
      setLiveCount(lines.length)

      if (lines.length === 0) throw new Error('No live props on PrizePicks right now. Check back soon.')

      setStepIdx(2)
      setProgress(65)

      const res = await fetch(`${SERVER}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, lines })
      })

      setStepIdx(3)
      setProgress(88)

      const data = await res.json()
      if (!data.picks) throw new Error(data.error || 'No picks returned')

      const imageMap = {}
      lines.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setProgress(100)
      await new Promise(r => setTimeout(r, 400))
      setPicks(data.picks)
    } catch (e) {
      setError(e.message || 'Could not load picks. Tap retry.')
    }
    setLoading(false)
  }

  const gold = picks.filter(p => p.conf >= 90)

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '32px', letterSpacing: '2px', color: 'var(--text)', lineHeight: 1 }}>{pageTitle}</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>
            {displayDate} · {liveCount > 0 ? `${liveCount} live props from PrizePicks` : 'Best available across all sports and esports'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!loading && (
            <button onClick={loadPicks} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--high)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 12px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--high)', animation: 'pulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 0', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: stepIdx > i ? 'var(--gold)' : stepIdx === i ? 'rgba(245,200,66,0.15)' : 'var(--bg3)',
                  border: stepIdx === i ? '2px solid var(--gold)' : stepIdx > i ? 'none' : '1px solid var(--border2)',
                  transition: 'all 0.4s ease',
                  fontSize: '12px', fontWeight: 700,
                  color: stepIdx > i ? '#1a0f00' : stepIdx === i ? 'var(--gold)' : 'var(--text3)',
                  fontFamily: 'var(--font-c)'
                }}>
                  {stepIdx > i ? '✓' : i + 1}
                </div>
                {i < 3 && (
                  <div style={{
                    width: '44px', height: '2px',
                    background: stepIdx > i ? 'var(--gold)' : 'var(--border)',
                    transition: 'background 0.6s ease'
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>

          <div style={{ width: '100%', maxWidth: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '2px', color: 'var(--gold)' }}>{stepLabels[stepIdx] || stepLabels[0]}</div>
              <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 700, color: 'var(--text2)' }}>{progress}%</div>
            </div>
            <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)',
                borderRadius: '3px',
                width: `${progress}%`,
                transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)'
              }} />
            </div>
            <div style={{
              fontSize: '13px', color: 'var(--text2)', marginTop: '18px',
              lineHeight: 1.7, textAlign: 'center', minHeight: '44px',
              opacity: factVisible ? 1 : 0,
              transition: 'opacity 0.3s ease'
            }}>
              {facts[factIdx]}
            </div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={loadPicks} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && gold.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg,rgba(245,200,66,0.04),rgba(245,200,66,0.01))', border: '1px solid rgba(245,200,66,0.18)', borderRadius: '18px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <span style={{ fontSize: '20px' }}>★</span>
            <span style={{ fontFamily: 'var(--font-d)', fontSize: '26px', letterSpacing: '2px', color: 'var(--gold)' }}>GOLD PICKS</span>
            <span style={{ fontSize: '12px', color: 'var(--text2)', marginLeft: 'auto' }}>90%+ Confidence · Strongest plays available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(195px,1fr))', gap: '14px' }}>
            {gold.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 70} />)}
          </div>
        </div>
      )}

      {!loading && !error && picks.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text2)' }}>All Picks</div>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(195px,1fr))', gap: '14px' }}>
            {picks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 70} />)}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
      `}</style>
    </div>
  )
}