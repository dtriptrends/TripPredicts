import React, { useEffect, useState } from 'react'
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
  'ALL':      { icon: '⚡', text: 'RUN AI PICKS',    sub: 'Analyze best plays across all sports' },
  'NBA':      { icon: '🏀', text: 'ANALYZE NBA',     sub: 'Find the sharpest NBA props tonight' },
  'MLB':      { icon: '⚾', text: 'ANALYZE MLB',     sub: 'Scan tonight\'s MLB lines for edges' },
  'NHL':      { icon: '🏒', text: 'ANALYZE NHL',     sub: 'Find the best NHL prop plays' },
  'NFL':      { icon: '🏈', text: 'ANALYZE NFL',     sub: 'Break down NFL lines with AI' },
  'WNBA':     { icon: '🏀', text: 'ANALYZE WNBA',   sub: 'Scan WNBA props for tonight' },
  'CS2':      { icon: '🎮', text: 'ANALYZE CS2',     sub: 'Find edges in CS2 match props' },
  'LOL':      { icon: '🎮', text: 'ANALYZE LOL',     sub: 'Break down LoL player props' },
  'VALORANT': { icon: '🎮', text: 'ANALYZE VAL',     sub: 'Scan Valorant props for value' },
  'COD':      { icon: '🎮', text: 'ANALYZE COD',     sub: 'Find edges in COD match props' },
  'SOCCER':   { icon: '⚽', text: 'ANALYZE SOCCER',  sub: 'Scan soccer player props' },
  'TENNIS':   { icon: '🎾', text: 'ANALYZE TENNIS',  sub: 'Break down tennis match props' },
  'GOLF':     { icon: '⛳', text: 'ANALYZE GOLF',    sub: 'Find value in golf props' },
  'MMA':      { icon: '🥊', text: 'ANALYZE MMA',     sub: 'Scan MMA fight props for edges' },
}

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
  'Trip Predicts covers NBA, MLB, NHL, NFL, CS2, LoL, Valorant and more.',
  'Over 250 live props are scanned every single time you hit load.',
  'Recent form is weighted more heavily than season averages for prop bets.',
  'High usage players hit volume-based lines more consistently over time.',
  'The confidence score runs from 50 to 95. Gold means 90 or above.',
  'Lines are filtered to only show pre-game props starting within 36 hours.',
  'Trip Predicts was built to give everyday bettors a real analytical edge.',
  'Esports props are included — CS2, LoL and Valorant all have strong lines.',
  'HIGHER or LOWER is never a guess. The model picks a direction based on stats.',
  'Gold picks are rare. When they show up, they carry real conviction behind them.',
  'Trip Predicts is free to use. No account needed. Just open and get your picks.',
  'Bull case tells you why the pick hits. Bear case tells you why it might not.',
  'A balanced slate beats a single-sport parlay almost every time.',
  'The AI scans all available leagues simultaneously to find the best plays.',
  'Each card has a TRIP PREDICTS watermark so your screenshots carry the brand.',
  'The backend caches PrizePicks data every 5 minutes for faster load times.',
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

export default function Tonight() {
  const [allLines, setAllLines] = useState([])
  const [availableLeagues, setAvailableLeagues] = useState([])
  const [selectedLeague, setSelectedLeague] = useState('ALL')
  const [picksCache, setPicksCache] = useState({})
  const [loadingLeague, setLoadingLeague] = useState(null)
  const [linesLoading, setLinesLoading] = useState(true)
  const [goldFilter, setGoldFilter] = useState('all')
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [stepLabels, setStepLabels] = useState(STEP_LABELS[0])
  const [facts, setFacts] = useState(FACTS)
  const [factIdx, setFactIdx] = useState(0)
  const [factVisible, setFactVisible] = useState(true)
  const [liveCount, setLiveCount] = useState(0)
  const [btnPulse, setBtnPulse] = useState(false)

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
    initLines()
  }, [])

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

    const lines = await fetchAllLines(SERVER)
    setAllLines(lines)
    setLiveCount(lines.length)

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

  async function loadPicksForLeague(league) {
    if (!allLines || allLines.length === 0) return
    const labels = STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)]
    setStepLabels(labels)
    setLoadingLeague(league)
    setProgress(40)
    setStepIdx(2)
    setGoldFilter('all')
    setError(null)
    setBtnPulse(false)

    try {
      const res = await fetch(`${SERVER}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentTime,
          lines: allLines,
          league: league === 'ALL' ? null : league,
          count: 10
        })
      })

      setProgress(88)
      setStepIdx(3)

      const data = await res.json()
      if (!data.picks) throw new Error(data.error || 'No picks returned')

      const imageMap = {}
      allLines.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setProgress(100)
      await new Promise(r => setTimeout(r, 300))
      setPicksCache(prev => ({ ...prev, [league]: data.picks }))
    } catch (e) {
      setError(e.message || 'Could not load picks.')
      setPicksCache(prev => ({ ...prev, [league]: [] }))
    }
    setLoadingLeague(null)
  }

  function handleTabSelect(league) {
    if (loadingLeague) return
    setSelectedLeague(league)
    setGoldFilter('all')
    if (picksCache[league] === undefined) {
      setBtnPulse(true)
    }
  }

  function handleRefresh() {
    setPicksCache({})
    setGoldFilter('all')
    initLines()
  }

  const isAnalyzing = loadingLeague === selectedLeague
  const hasPicks = picksCache[selectedLeague] !== undefined
  const currentPicks = picksCache[selectedLeague] || []
  const goldPicks = currentPicks.filter(p => p.conf >= 90)
  const highPicks = currentPicks.filter(p => p.conf >= 75 && p.conf < 90)
  const regularPicks = currentPicks.filter(p => p.conf < 75)
  const cta = CTA_LABELS[selectedLeague] || CTA_LABELS['ALL']
  const leagueColor = LEAGUE_COLORS[selectedLeague] || '#f5c842'
  const leagueLineCount = selectedLeague === 'ALL'
    ? allLines.length
    : allLines.filter(l => (l.league || '').toUpperCase() === selectedLeague).length

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '28px', letterSpacing: '2px', color: 'var(--text)', lineHeight: 1 }}>{pageTitle}</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '3px' }}>
            {displayDate}{liveCount > 0 ? ` · ${liveCount} live props` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isAnalyzing && !linesLoading && (
            <button onClick={handleRefresh} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px', WebkitTapHighlightColor: 'transparent' }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--high)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--high)', animation: 'livePulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {/* Lines loading */}
      {linesLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `dotPulse 1.3s ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: 'var(--gold)' }}>LOADING LIVE LINES</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)' }}>Fetching props from PrizePicks...</div>
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
                const hasGold = cached.some(p => p.conf >= 90)
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
                    {hasGold && <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>}
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

      {/* Gold / All toggle */}
      {!linesLoading && !isAnalyzing && hasPicks && currentPicks.length > 0 && (
        <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setGoldFilter('all')} style={{
            background: goldFilter === 'all' ? 'rgba(255,255,255,0.08)' : 'none',
            border: `1px solid ${goldFilter === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
            color: goldFilter === 'all' ? 'var(--text)' : 'var(--text3)',
            fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700,
            letterSpacing: '1px', padding: '6px 14px', borderRadius: '20px',
            cursor: 'pointer', transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '6px',
            WebkitTapHighlightColor: 'transparent',
          }}>
            ALL PICKS
            <span style={{ background: 'var(--border2)', color: 'var(--text3)', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{currentPicks.length}</span>
          </button>
          {goldPicks.length > 0 && (
            <button onClick={() => setGoldFilter('gold')} style={{
              background: goldFilter === 'gold' ? 'rgba(245,200,66,0.12)' : 'none',
              border: `1px solid ${goldFilter === 'gold' ? '#f5c842' : 'var(--border)'}`,
              color: goldFilter === 'gold' ? '#f5c842' : 'var(--text3)',
              fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700,
              letterSpacing: '1px', padding: '6px 14px', borderRadius: '20px',
              cursor: 'pointer', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: '6px',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{ fontSize: '10px' }}>★</span> GOLD
              <span style={{ background: goldFilter === 'gold' ? 'rgba(245,200,66,0.25)' : 'var(--border2)', color: goldFilter === 'gold' ? '#f5c842' : 'var(--text3)', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{goldPicks.length}</span>
            </button>
          )}
          {highPicks.length > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginLeft: 'auto' }}>
              {highPicks.length} high · {regularPicks.length} regular
            </div>
          )}
        </div>
      )}

      {/* Analyzing loading screen */}
      {isAnalyzing && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: stepIdx > i ? leagueColor : stepIdx === i ? `${leagueColor}25` : 'var(--bg3)',
                  border: stepIdx === i ? `2px solid ${leagueColor}` : stepIdx > i ? 'none' : '1px solid var(--border2)',
                  transition: 'all 0.4s ease',
                  fontSize: '12px', fontWeight: 700,
                  color: stepIdx > i ? '#000' : stepIdx === i ? leagueColor : 'var(--text3)',
                  fontFamily: 'var(--font-c)'
                }}>
                  {stepIdx > i ? '✓' : i + 1}
                </div>
                {i < 3 && <div style={{ width: '44px', height: '2px', background: stepIdx > i ? leagueColor : 'var(--border)', transition: 'background 0.6s ease' }} />}
              </React.Fragment>
            ))}
          </div>
          <div style={{ width: '100%', maxWidth: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '2px', color: leagueColor }}>{stepLabels[stepIdx] || stepLabels[0]}</div>
              <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 700, color: 'var(--text2)' }}>{progress}%</div>
            </div>
            <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ height: '100%', background: `linear-gradient(90deg,${leagueColor}88,${leagueColor})`, borderRadius: '3px', width: `${progress}%`, transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '18px', lineHeight: 1.7, textAlign: 'center', minHeight: '44px', opacity: factVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
              {facts[factIdx]}
            </div>
          </div>
        </div>
      )}

      {/* CTA button — lines loaded, no picks yet for this league */}
      {!linesLoading && !isAnalyzing && !hasPicks && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '10px' }}>{cta.icon}</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', letterSpacing: '1px', textTransform: 'uppercase' }}>{cta.sub}</div>
          </div>

          <button
            onClick={() => loadPicksForLeague(selectedLeague)}
            style={{
              background: `linear-gradient(135deg,${leagueColor}18,${leagueColor}08)`,
              border: `2px solid ${leagueColor}`,
              color: leagueColor,
              fontFamily: 'var(--font-d)',
              fontSize: '20px',
              letterSpacing: '3px',
              padding: '18px 44px',
              borderRadius: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              animation: btnPulse ? 'ctaPulse 2s ease infinite' : 'none',
              boxShadow: `0 0 24px ${leagueColor}18`,
              WebkitTapHighlightColor: 'transparent',
              display: 'flex', alignItems: 'center', gap: '12px',
              touchAction: 'manipulation',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = `${leagueColor}28`
              e.currentTarget.style.boxShadow = `0 0 44px ${leagueColor}38`
              e.currentTarget.style.transform = 'scale(1.03)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = `linear-gradient(135deg,${leagueColor}18,${leagueColor}08)`
              e.currentTarget.style.boxShadow = `0 0 24px ${leagueColor}18`
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {cta.icon} {cta.text} →
          </button>

          <div style={{ fontSize: '11px', color: 'var(--text3)', letterSpacing: '1px' }}>
            {leagueLineCount} live props available
          </div>
        </div>
      )}

      {/* Error */}
      {error && !isAnalyzing && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={handleRefresh} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* Picks */}
      {!isAnalyzing && !error && hasPicks && currentPicks.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px' }}>
          {goldFilter === 'all' && goldPicks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: '#f5c842' }}>★ GOLD</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(245,200,66,0.2)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>90%+</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {goldPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
              </div>
            </div>
          )}
          {goldFilter === 'all' && highPicks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: '#10b981' }}>HIGH</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(16,185,129,0.2)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>75-89%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {highPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
              </div>
            </div>
          )}
          {goldFilter === 'all' && regularPicks.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: 'var(--text2)' }}>PICKS</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Below 75%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {regularPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
              </div>
            </div>
          )}
          {goldFilter === 'gold' && goldPicks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
              {goldPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
            </div>
          )}
          {goldFilter === 'gold' && goldPicks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: '20px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD PICKS</div>
              <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>No 90%+ picks for {selectedLeague} right now.</div>
              <button onClick={() => setGoldFilter('all')} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer' }}>View All Picks</button>
            </div>
          )}
        </div>
      )}

      {/* Empty picks — re-analyze button */}
      {!isAnalyzing && !error && hasPicks && currentPicks.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '20px', letterSpacing: '2px', color: 'var(--text2)' }}>NO PICKS FOUND</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', maxWidth: '260px', lineHeight: 1.6 }}>No strong plays for {selectedLeague} right now. Try another league or re-analyze.</div>
          <button onClick={() => { setPicksCache(prev => { const n = { ...prev }; delete n[selectedLeague]; return n }); loadPicksForLeague(selectedLeague) }} style={{ background: `${leagueColor}18`, border: `1px solid ${leagueColor}55`, color: leagueColor, fontFamily: 'var(--font-d)', fontSize: '14px', letterSpacing: '2px', padding: '12px 28px', borderRadius: '12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            RE-ANALYZE {selectedLeague}
          </button>
        </div>
      )}

      <style>{`
        @keyframes livePulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes dotPulse{0%,80%,100%{opacity:0.2;transform:scale(1);}40%{opacity:1;transform:scale(1.2);}}
        @keyframes ctaPulse{
          0%,100%{box-shadow:0 0 24px ${leagueColor}18,0 0 0 0 transparent;}
          50%{box-shadow:0 0 44px ${leagueColor}44,0 0 0 8px transparent;}
        }
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>
    </div>
  )
}