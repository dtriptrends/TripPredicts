import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const STEP_LABELS = [
  ['CONNECTING', 'SCANNING LINES', 'GOLD FILTER', 'VERIFYING EDGE'],
  ['STARTING SCAN', 'LIVE PROPS', 'CONFIDENCE CHECK', 'ELITE PLAYS'],
  ['GOING LIVE', 'FULL SCAN', 'HUNTING EDGES', 'FINAL CUT'],
  ['POWERING UP', 'REAL-TIME LINES', 'DEEP ANALYSIS', 'LOCKING GOLD'],
  ['BOOTING SCAN', 'LOADING DATA', 'WEIGHING FORM', 'GOLD BOARD'],
]

const FACTS = [
  'Gold picks are the rarest plays on the board. Most sessions only have 1 or 2.',
  'The bar for gold is 90% confidence or higher. No exceptions, no rounding up.',
  'Over 250 live props are scanned every load to find the few that truly qualify.',
  'When gold picks hit they carry real conviction behind every number.',
  'Hot streak plus weak opponent plus high usage is the gold formula.',
  'Gold picks are shown separately because they deserve a different kind of attention.',
  'Recent form matters more than season averages when it comes to prop bets.',
  'The AI scores every line from 50 to 95. Gold means 90 or above.',
  'If the confidence is not there, no pick is made. Quality always beats quantity.',
  'Bull case and bear case are on every gold card so you know what you are getting into.',
  'Trip Predicts covers NBA, MLB, NHL, NFL, CS2, LoL, Valorant and more.',
  'Lines are fetched fresh every time so you never see stale or outdated props.',
  'No more than 2 picks from the same league. Balance beats concentration.',
  'The AI never defaults to HIGHER. Direction is set by the data every time.',
  'A player on a 5-game hot streak against a weak defense is a textbook gold setup.',
  'Stat category breakdown is on every card so you can verify the logic yourself.',
  'Only pre-game props starting within the next 36 hours are ever shown.',
  'Trip Predicts is free to use. No account, no paywall, just open and get picks.',
  'The backend caches data every 5 minutes to keep load times as fast as possible.',
  'Every gold pick includes a risk factor so you know what could go wrong.',
  'Trip Predicts was built to give everyday bettors access to real analytical tools.',
  'High usage players hit volume-based lines more consistently over a full season.',
  'Pace of play is one of the most underrated factors in NBA and esports props.',
  'The confidence bar on every card animates live when it loads. Watch it climb.',
  'Rare but powerful. These are the plays worth sizing up when they appear.',
  'Trip Predicts is powered by Claude, one of the most capable AI models available.',
  'Picks are spread across different leagues to maximize your slate diversity.',
  'The AI weighs matchup strength, usage rate, recent form and pace all at once.',
  'Gold picks are never forced. If none qualify today, the board stays empty.',
  'Every fact you are reading right now was written to help you bet smarter.',
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

export default function Gold() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [stepLabels, setStepLabels] = useState(STEP_LABELS[0])
  const [facts, setFacts] = useState(FACTS)
  const [factIdx, setFactIdx] = useState(0)
  const [factVisible, setFactVisible] = useState(true)

  const now = new Date()
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