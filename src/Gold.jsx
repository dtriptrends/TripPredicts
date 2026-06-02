import React, { useEffect, useState, useRef } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const LEAGUE_ORDER = ['ALL', 'NBA', 'MLB', 'NHL', 'NFL', 'WNBA', 'CS2', 'LOL', 'VALORANT', 'COD', 'SOCCER', 'TENNIS', 'GOLF', 'MMA']

const LEAGUE_COLORS = {
  'ALL':      '#f5c842',
  'NBA':      '#e17210',
  'MLB':      '#4a90d9',
  'NHL':      '#aab4cc',
  'NFL':      '#4a90d9',
  'WNBA':     '#ff6900',
  'CS2':      '#00b4d8',
  'LOL':      '#c89b3c',
  'VALORANT': '#ff4655',
  'COD':      '#00e676',
  'SOCCER':   '#10b981',
  'TENNIS':   '#f5c842',
  'GOLF':     '#4a9e5c',
  'MMA':      '#ef4444',
}

const CTA_LABELS = {
  'ALL':      { icon: '🔥', text: 'HUNT GOLD PICKS',  sub: 'Find 90%+ confidence plays across all sports' },
  'NBA':      { icon: '🏀', text: 'HUNT NBA GOLD',    sub: 'Find elite NBA props at 90%+ confidence' },
  'MLB':      { icon: '⚾', text: 'HUNT MLB GOLD',    sub: 'Find elite MLB props at 90%+ confidence' },
  'NHL':      { icon: '🏒', text: 'HUNT NHL GOLD',    sub: 'Find elite NHL props at 90%+ confidence' },
  'NFL':      { icon: '🏈', text: 'HUNT NFL GOLD',    sub: 'Find elite NFL props at 90%+ confidence' },
  'WNBA':     { icon: '🏀', text: 'HUNT WNBA GOLD',  sub: 'Find elite WNBA props at 90%+ confidence' },
  'CS2':      { icon: '🎮', text: 'HUNT CS2 GOLD',   sub: 'Find elite CS2 props at 90%+ confidence' },
  'LOL':      { icon: '🎮', text: 'HUNT LOL GOLD',   sub: 'Find elite LoL props at 90%+ confidence' },
  'VALORANT': { icon: '🎮', text: 'HUNT VAL GOLD',   sub: 'Find elite Valorant props at 90%+' },
  'COD':      { icon: '🎮', text: 'HUNT COD GOLD',   sub: 'Find elite COD props at 90%+ confidence' },
  'SOCCER':   { icon: '⚽', text: 'HUNT SOCCER GOLD', sub: 'Find elite soccer props at 90%+' },
  'TENNIS':   { icon: '🎾', text: 'HUNT TENNIS GOLD', sub: 'Find elite tennis props at 90%+' },
  'GOLF':     { icon: '⛳', text: 'HUNT GOLF GOLD',  sub: 'Find elite golf props at 90%+' },
  'MMA':      { icon: '🥊', text: 'HUNT MMA GOLD',   sub: 'Find elite MMA props at 90%+ confidence' },
}

const STEP_LABELS = [
  ['CONNECTING', 'SCANNING LINES', 'GOLD FILTER', 'VERIFYING EDGE'],
  ['STARTING SCAN', 'LIVE PROPS', 'CONFIDENCE CHECK', 'ELITE PLAYS'],
  ['GOING LIVE', 'FULL SCAN', 'HUNTING EDGES', 'FINAL CUT'],
  ['POWERING UP', 'REAL-TIME LINES', 'DEEP ANALYSIS', 'LOCKING GOLD'],
  ['BOOTING SCAN', 'LOADING DATA', 'WEIGHING FORM', 'GOLD BOARD'],
]

const LINES_MSGS = [
  'LOADING LIVE LINES',
  'CONNECTING TO PRIZEPICKS',
  'PULLING LIVE PROPS',
  'FETCHING THE BOARD',
  'SCANNING ALL SPORTS',
  'GETTING REAL DATA',
  'ALMOST READY',
]

const FACTS = [
  'Gold picks are the rarest plays on the board. Most sessions only have 1 or 2.',
  'The bar for gold is 90% confidence or higher. No exceptions, no rounding up.',
  'Over 250 live props are scanned every load to find the few that truly qualify.',
  'When gold picks hit they carry real conviction behind every number.',
  'Hot streak plus weak opponent plus high usage is the gold formula.',
  'Recent form matters more than season averages when it comes to prop bets.',
  'The AI scores every line from 50 to 95. Gold means 90 or above.',
  'If the confidence is not there, no pick is made. Quality always beats quantity.',
  'Trip Predicts covers NBA, MLB, NHL, NFL, CS2, LoL, Valorant and more.',
  'Lines are fetched fresh every time so you never see stale or outdated props.',
  'The AI never defaults to HIGHER. Direction is set by the data every time.',
  'Only pre-game props starting within the next 36 hours are ever shown.',
  'Trip Predicts is free to use. No account, no paywall, just open and get picks.',
  'Every gold pick includes a risk factor so you know what could go wrong.',
  'Rare but powerful. These are the plays worth sizing up when they appear.',
  'Trip Predicts is powered by Claude, one of the most capable AI models available.',
  'Gold picks are never forced. If none qualify today, the board stays empty.',
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function fetchAllLines(server) {
  try {
    const res = await fetch(`${server}/prizepicks/all`)
    const data = await res.json()
    if (!data.data || !data.included) return []
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
    const results = []
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
    return results
  } catch (e) {
    console.log('Fetch error:', e.message)
    return []
  }
}

export default function Gold() {
  const [availableLeagues, setAvailableLeagues] = useState([])
  const [selectedLeague, setSelectedLeague] = useState('ALL')
  const [picksCache, setPicksCache] = useState({})
  const [loadingLeague, setLoadingLeague] = useState(null)
  const [linesLoading, setLinesLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [stepLabels, setStepLabels] = useState(STEP_LABELS[0])
  const [facts, setFacts] = useState(FACTS)
  const [factIdx, setFactIdx] = useState(0)
  const [factVisible, setFactVisible] = useState(true)
  const [btnPulse, setBtnPulse] = useState(false)
  const [linesMsgIdx, setLinesMsgIdx] = useState(0)
  const [linesMsgVisible, setLinesMsgVisible] = useState(true)

  // Use ref to always have fresh lines in callbacks
  const linesRef = useRef([])

  const now = new Date()
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => {
    initLines()
  }, [])

  // Cycle loading messages during lines fetch
  useEffect(() => {
    if (!linesLoading) return
    const interval = setInterval(() => {
      setLinesMsgVisible(false)
      setTimeout(() => {
        setLinesMsgIdx(i => (i + 1) % LINES_MSGS.length)
        setLinesMsgVisible(true)
      }, 300)
    }, 2000)
    return () => clearInterval(interval)
  }, [linesLoading])

  // Cycle facts during AI analysis
  useEffect(() => {
    if (!loadingLeague) return
    const interval = setInterval(() => {
      setFactVisible(false)
      setTimeout(() => {
        setFactIdx(i => (i + 1) % facts.length)
        setFactVisible(true)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [loadingLeague, facts])

  async function initLines() {
    setLinesLoading(true)
    setPicksCache({})
    setFacts(shuffle(FACTS))
    setError(null)
    setSelectedLeague('ALL')
    setBtnPulse(false)
    setLinesMsgIdx(0)
    setLinesMsgVisible(true)
    linesRef.current = []

    const lines = await fetchAllLines(SERVER)
    linesRef.current = lines

    const leagueSet = new Set(lines.map(l => (l.league || '').toUpperCase()).filter(Boolean))
    const ordered = LEAGUE_ORDER.filter(l => l === 'ALL' || leagueSet.has(l))
    const others = [...leagueSet].filter(l => l && !LEAGUE_ORDER.includes(l))
    setAvailableLeagues([...ordered, ...others])
    setLinesLoading(false)

    if (lines.length === 0) {
      setError('No live props on PrizePicks right now. Check back soon.')
      return
    }

    setTimeout(() => setBtnPulse(true), 500)
  }

  async function loadGoldForLeague(league) {
    const lns = linesRef.current
    console.log('loadGoldForLeague called with', lns.length, 'lines for', league)
    if (!lns || lns.length === 0) {
      console.log('No lines available, reinitializing...')
      await initLines()
      return
    }

    const labels = STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)]
    setStepLabels(labels)
    setLoadingLeague(league)
    setProgress(40)
    setStepIdx(2)
    setError(null)
    setBtnPulse(false)

    try {
      const res = await fetch(`${SERVER}/gold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentTime,
          lines: lns,
          league: league === 'ALL' ? null : league
        })
      })

      setProgress(88)
      setStepIdx(3)

      const data = await res.json()

      if (!res.ok) {
        setPicksCache(prev => ({ ...prev, [league]: [] }))
        setLoadingLeague(null)
        return
      }

      if (!data.picks) {
        setPicksCache(prev => ({ ...prev, [league]: [] }))
        setLoadingLeague(null)
        return
      }

      const imageMap = {}
      lns.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setProgress(100)
      await new Promise(r => setTimeout(r, 300))
      setPicksCache(prev => ({ ...prev, [league]: data.picks }))
    } catch (e) {
      console.error('Gold fetch error:', e.message)
      setPicksCache(prev => ({ ...prev, [league]: [] }))
    }
    setLoadingLeague(null)
  }

  function handleTabSelect(league) {
    if (loadingLeague) return
    setSelectedLeague(league)
    if (picksCache[league] === undefined) {
      setBtnPulse(true)
    }
  }

  function handleRefresh() {
    setPicksCache({})
    setSelectedLeague('ALL')
    initLines()
  }

  const isAnalyzing = loadingLeague === selectedLeague
  const hasPicks = picksCache[selectedLeague] !== undefined
  const currentPicks = picksCache[selectedLeague] || []
  const cta = CTA_LABELS[selectedLeague] || CTA_LABELS['ALL']
  const leagueColor = LEAGUE_COLORS[selectedLeague] || '#f5c842'

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '28px', letterSpacing: '2px', lineHeight: 1, background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>★ GOLD PICKS</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '3px' }}>90%+ confidence · Strongest plays available right now</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isAnalyzing && !linesLoading && (
            <button onClick={handleRefresh} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px', WebkitTapHighlightColor: 'transparent' }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.25)', color: 'var(--gold)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold)', animation: 'livePulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {/* Lines loading with cycling words */}
      {linesLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `dotPulse 1.3s ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <div style={{
            fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '3px', color: 'var(--gold)',
            opacity: linesMsgVisible ? 1 : 0, transition: 'opacity 0.3s ease',
            minHeight: '28px', textAlign: 'center'
          }}>
            {LINES_MSGS[linesMsgIdx]}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', textAlign: 'center', maxWidth: '260px', lineHeight: 1.6 }}>
            Pulling live props from PrizePicks...
          </div>
        </div>
      )}

      {/* League tabs */}
      {!linesLoading && availableLeagues.length > 0 && (
        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <div style={{ overflowX: 'auto', paddingBottom: '6px' }}>
            <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
              {availableLeagues.map(league => {
                const isActive = selectedLeague === league
                const color = LEAGUE_COLORS[league] || '#7a8aaa'
                const cached = picksCache[league] || []
                const isDone = picksCache[league] !== undefined
                return (
                  <button
                    key={league}
                    onClick={() => handleTabSelect(league)}
                    disabled={!!loadingLeague}
                    style={{
                      background: isActive ? `${color}22` : 'var(--bg3)',
                      border: `1px solid ${isActive ? color : 'var(--border)'}`,
                      color: isActive ? color : 'var(--text2)',
                      fontFamily: 'var(--font-c)',
                      fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                      padding: '8px 14px', borderRadius: '20px',
                      cursor: loadingLeague ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', gap: '5px',
                      whiteSpace: 'nowrap',
                      opacity: loadingLeague && !isActive ? 0.5 : 1,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>
                    {league}
                    {isDone && cached.length > 0 && (
                      <span style={{ background: isActive ? color : 'var(--border2)', color: isActive ? '#000' : 'var(--text3)', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px' }}>{cached.length}</span>
                    )}
                    {isDone && cached.length === 0 && (
                      <span style={{ fontSize: '9px', color: 'var(--text3)' }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Analyzing */}
      {isAnalyzing && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '28px' }}>
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
                {i < 3 && <div style={{ width: '44px', height: '2px', background: stepIdx > i ? 'var(--gold)' : 'var(--border)', transition: 'background 0.6s ease' }} />}
              </React.Fragment>
            ))}
          </div>
          <div style={{ width: '100%', maxWidth: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '2px', color: 'var(--gold)' }}>{stepLabels[stepIdx] || stepLabels[0]}</div>
              <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 700, color: 'var(--text2)' }}>{progress}%</div>
            </div>
            <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ height: '100%', background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', borderRadius: '3px', width: `${progress}%`, transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '18px', lineHeight: 1.7, textAlign: 'center', minHeight: '44px', opacity: factVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
              {facts[factIdx]}
            </div>
          </div>
        </div>
      )}

      {/* CTA button */}
      {!linesLoading && !isAnalyzing && !hasPicks && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '10px' }}>{cta.icon}</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', letterSpacing: '1px', textTransform: 'uppercase' }}>{cta.sub}</div>
          </div>
          <button
            onClick={() => loadGoldForLeague(selectedLeague)}
            style={{
              background: 'linear-gradient(135deg,rgba(245,200,66,0.12),rgba(245,200,66,0.05))',
              border: '2px solid #f5c842',
              color: '#f5c842',
              fontFamily: 'var(--font-d)',
              fontSize: '20px',
              letterSpacing: '3px',
              padding: '18px 44px',
              borderRadius: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              animation: btnPulse ? 'goldCtaPulse 2s ease infinite' : 'none',
              boxShadow: '0 0 24px rgba(245,200,66,0.15)',
              WebkitTapHighlightColor: 'transparent',
              display: 'flex', alignItems: 'center', gap: '12px',
              touchAction: 'manipulation',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(245,200,66,0.2)'
              e.currentTarget.style.boxShadow = '0 0 44px rgba(245,200,66,0.35)'
              e.currentTarget.style.transform = 'scale(1.03)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg,rgba(245,200,66,0.12),rgba(245,200,66,0.05))'
              e.currentTarget.style.boxShadow = '0 0 24px rgba(245,200,66,0.15)'
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {cta.icon} {cta.text} →
          </button>
        </div>
      )}

      {/* Error */}
      {error && !isAnalyzing && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={handleRefresh} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* Gold picks */}
      {!isAnalyzing && !error && hasPicks && currentPicks.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: '#f5c842' }}>★ GOLD — {selectedLeague}</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(245,200,66,0.2)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{currentPicks.length} pick{currentPicks.length !== 1 ? 's' : ''} · 90%+</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
            {currentPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
          </div>
        </div>
      )}

      {/* No gold */}
      {!isAnalyzing && !error && hasPicks && currentPicks.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>★</div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD FOR {selectedLeague}</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '24px', lineHeight: 1.6, maxWidth: '280px' }}>
            No picks hit 90%+ confidence for {selectedLeague} right now.
          </div>
          {selectedLeague !== 'ALL' && (
            <button onClick={() => handleTabSelect('ALL')} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', marginBottom: '10px' }}>Check All Sports</button>
          )}
          <button
            onClick={() => {
              setPicksCache(prev => { const n = { ...prev }; delete n[selectedLeague]; return n })
              setTimeout(() => loadGoldForLeague(selectedLeague), 50)
            }}
            style={{ background: 'none', border: '1px solid rgba(245,200,66,0.3)', color: '#f5c842', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      )}

      <style>{`
        @keyframes livePulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes dotPulse{0%,80%,100%{opacity:0.2;transform:scale(1);}40%{opacity:1;transform:scale(1.2);}}
        @keyframes goldCtaPulse{
          0%,100%{box-shadow:0 0 24px rgba(245,200,66,0.15),0 0 0 0 transparent;}
          50%{box-shadow:0 0 44px rgba(245,200,66,0.4),0 0 0 8px transparent;}
        }
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>
    </div>
  )
}