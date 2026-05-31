import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const GOLD_SESSION_SETS = [
  {
    steps: [
      { label: 'CONNECTING', sub: 'Gold picks are the rarest plays on the board — 90%+ confidence only' },
      { label: 'SCANNING LINES', sub: 'Checking every live prop across all sports for elite setups' },
      { label: 'GOLD FILTER', sub: 'Most props get cut here. The bar is high for a reason.' },
      { label: 'VERIFYING EDGE', sub: 'Every gold pick needs a clear statistical reason to hit' },
    ]
  },
  {
    steps: [
      { label: 'STARTING SCAN', sub: 'Not every session has gold picks. Quality over quantity.' },
      { label: 'LIVE PROPS', sub: 'Pulling 250+ lines to find the few that truly stand out' },
      { label: 'CONFIDENCE CHECK', sub: 'AI scores every line 50 to 95. Gold means 90 or higher.' },
      { label: 'ELITE PLAYS', sub: 'When gold picks hit they hit with high conviction' },
    ]
  },
  {
    steps: [
      { label: 'GOING LIVE', sub: 'Gold picks refresh with real data every time you load' },
      { label: 'FULL SCAN', sub: 'NBA, MLB, NHL, NFL, esports — no league gets skipped' },
      { label: 'HUNTING EDGES', sub: 'Hot streaks plus weak opponents plus high usage equals gold' },
      { label: 'FINAL CUT', sub: 'Only picks that survive all criteria make the gold board' },
    ]
  },
  {
    steps: [
      { label: 'POWERING UP', sub: 'Gold picks are shown separately because they deserve attention' },
      { label: 'REAL-TIME LINES', sub: 'Stale data misses line moves. We always fetch fresh.' },
      { label: 'DEEP ANALYSIS', sub: 'Bull case, bear case and stat breakdown on every card' },
      { label: 'LOCKING GOLD', sub: 'If the confidence is not there, no pick is made. Period.' },
    ]
  },
  {
    steps: [
      { label: 'BOOTING SCAN', sub: 'Over 250 props evaluated to find the top 90%+ plays' },
      { label: 'LOADING DATA', sub: 'PrizePicks lines pulled directly — nothing fabricated' },
      { label: 'WEIGHING FORM', sub: 'Recent form matters more than season averages for props' },
      { label: 'GOLD BOARD', sub: 'Rare but powerful. These are the plays worth sizing up.' },
    ]
  },
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

export default function Gold() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [sessionSet, setSessionSet] = useState(GOLD_SESSION_SETS[0])

  const now = new Date()
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => {
    const t = setTimeout(() => loadPicks(), 500)
    return () => clearTimeout(t)
  }, [])

  async function loadPicks() {
    const newSet = GOLD_SESSION_SETS[Math.floor(Math.random() * GOLD_SESSION_SETS.length)]
    setSessionSet(newSet)
    setLoading(true)
    setError(null)
    setPicks([])
    setProgress(0)
    setStepIdx(0)

    await new Promise(r => setTimeout(r, 300))
    setProgress(15)

    try {
      setStepIdx(1)
      setProgress(25)

      const lines = await fetchPrizePicksLines()
      setProgress(55)

      if (lines.length === 0) throw new Error('No live props on PrizePicks right now. Check back soon.')

      setStepIdx(2)
      setProgress(65)

      const res = await fetch(`${SERVER}/gold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, lines })
      })

      setStepIdx(3)
      setProgress(88)

      const data = await res.json()
      if (!data.picks) throw new Error(data.error || 'No gold picks found')

      const imageMap = {}
      lines.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setProgress(100)
      await new Promise(r => setTimeout(r, 400))
      setPicks(data.picks)
    } catch (e) {
      setError(e.message || 'No gold picks available right now. Check back later.')
    }
    setLoading(false)
  }

  const currentStep = sessionSet.steps[stepIdx] || sessionSet.steps[0]

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '32px', letterSpacing: '2px', lineHeight: 1, background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>★ GOLD PICKS</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>90%+ confidence · Strongest plays available right now</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!loading && (
            <button onClick={loadPicks} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.25)', color: 'var(--gold)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 12px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold)', animation: 'pulse 1.5s infinite' }} />LIVE
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
              <div style={{ fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '2px', color: 'var(--gold)' }}>{currentStep.label}</div>
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
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '14px', lineHeight: 1.65, textAlign: 'center' }}>
              {currentStep.sub}
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

      {!loading && !error && picks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '16px' }}>
          {picks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 100} />)}
        </div>
      )}

      {!loading && !error && picks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD PICKS RIGHT NOW</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>Gold picks are rare — 90%+ confidence only. Check back later.</div>
          <button onClick={loadPicks} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Check Again</button>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
      `}</style>
    </div>
  )
}