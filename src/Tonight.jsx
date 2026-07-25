import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'
import ParlayBuilder, { MAX_LEGS } from './ParlayBuilder'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

// ============ SIGNAL design tokens (kept in sync with PickCard.jsx) ============
const VOID      = '#0A0C11'
const INK       = '#F1EEE6'
const INK_DIM   = '#9AA0AB'
const INK_FAINT = '#565A66'
const PANEL     = '#12151C'
const LINE_SOFT = 'rgba(255,255,255,0.08)'
const AMBER      = '#E3A548'
const AMBER_DIM  = 'rgba(227,165,72,0.12)'
const AMBER_MED  = 'rgba(227,165,72,0.4)'
const GOOD = '#3DDD8F'
const BAD  = '#F2555F'
const FONT_D = "'Space Grotesk',sans-serif"
const FONT_M = "'IBM Plex Mono',monospace"
const FONT_B = "'Barlow',sans-serif"

const LEAGUE_ORDER = ['ALL', 'MLB', 'WNBA', 'NBA', 'NHL', 'NFL', 'CS2', 'LOL', 'VALORANT', 'COD', 'SOCCER', 'TENNIS', 'GOLF', 'MMA']

// Sports backed by real BALLDONTLIE game data. These tabs get the verified treatment.
const REAL_DATA_LEAGUES = ['MLB', 'WNBA']

const LEAGUE_COLORS = {
  'ALL':      AMBER,
  'NBA':      '#e17210',
  'MLB':      '#4a90d9',
  'NHL':      '#aab4cc',
  'NFL':      '#4a90d9',
  'WNBA':     AMBER,
  'CS2':      '#00b4d8',
  'LOL':      '#c89b3c',
  'VALORANT': '#ff4655',
  'COD':      '#00e676',
  'SOCCER':   GOOD,
  'TENNIS':   AMBER,
  'GOLF':     '#4a9e5c',
  'MMA':      BAD,
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
  'MLB and WNBA picks now show real game-by-game hit rates from verified data.',
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
  'A verified league tab means the numbers on those cards come from real game logs.',
  'HIGHER or LOWER is never a guess. The model picks a direction based on stats.',
  'Gold picks are rare. When they show up, they carry real conviction behind them.',
  'Trip Predicts is free to use. No account needed. Just open and get your picks.',
  'Bull case tells you why the pick hits. Bear case tells you why it might not.',
  'A balanced slate beats a single-sport parlay almost every time.',
  'The AI scans all available leagues simultaneously to find the best plays.',
  'Each card has a TRIP PREDICTS watermark so your screenshots carry the brand.',
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
    const now = new Date()
    // Board is built from STANDARD lines only, kept exactly as PrizePicks sends
    // them. Demon and goblin variants are set aside as alternates for the chip,
    // never shown as the main line and never merged into the standard line.
    const altMap = {} // "name|stat" -> { goblin, demon }
    const standardRows = []
    data.data.forEach(proj => {
      const a = proj.attributes
      const startTime = new Date(a.start_time)
      const hoursUntil = (startTime - now) / (1000 * 60 * 60)
      if (a.status !== 'pre_game') return
      if (hoursUntil < 0 || hoursUntil > 36) return
      const playerId = proj.relationships?.new_player?.data?.id
      const player = players[playerId]
      if (!player || !player.name) return
      const oddsType = (a.odds_type || 'standard').toLowerCase()
      const key = `${player.name}|${a.stat_display_name}`
      const lineVal = Number(a.line_score)
      if (isNaN(lineVal)) return
      if (oddsType === 'demon' || oddsType === 'goblin') {
        if (!altMap[key]) altMap[key] = {}
        altMap[key][oddsType] = lineVal
        return
      }
      standardRows.push({
        name: player.name, team: player.team, league: player.league, image: player.image,
        stat: a.stat_display_name, line: lineVal, key,
        start_time: startTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET',
        date: startTime.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
      })
    })
    const results = standardRows.map(r => ({
      name: r.name, team: r.team, league: r.league, image: r.image,
      stat: r.stat, line: r.line, oddsType: 'standard',
      altLines: {
        standard: r.line,
        goblin: altMap[r.key] && altMap[r.key].goblin != null ? altMap[r.key].goblin : null,
        demon: altMap[r.key] && altMap[r.key].demon != null ? altMap[r.key].demon : null
      },
      start_time: r.start_time, date: r.date
    }))
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
  const [parlayPicks, setParlayPicks] = useState([])

  function toggleParlay(pick) {
    setParlayPicks(prev => {
      if (prev.some(p => p.id === pick.id)) return prev.filter(p => p.id !== pick.id)
      if (prev.length >= MAX_LEGS) return prev
      return [...prev, pick]
    })
  }

  const now = new Date()
  const hour = now.getHours()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const isLate = hour >= 22
  const displayDate = isLate
    ? tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const pageTitle = isLate ? "TOMORROW'S PICKS" : "TONIGHT'S PICKS"
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => { initLines() }, [])

  useEffect(() => {
    const isLoading = linesLoading || !!loadingLeague
    if (!isLoading) return
    const interval = setInterval(() => {
      setFactVisible(false)
      setTimeout(() => { setFactIdx(i => (i + 1) % facts.length); setFactVisible(true) }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [linesLoading, loadingLeague, facts])

  async function initLines() {
    setLinesLoading(true)
    setPicksCache({})
    setFacts(shuffle(FACTS))
    setStepLabels(STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)])
    setProgress(0); setStepIdx(0); setFactIdx(0); setFactVisible(true); setError(null)
    await new Promise(r => setTimeout(r, 200))
    setProgress(15); setStepIdx(1)
    const lines = await fetchAllLines(SERVER)
    setAllLines(lines)
    setLiveCount(lines.length)
    setProgress(35)
    const leagueSet = new Set(lines.map(l => (l.league || '').toUpperCase()).filter(Boolean))
    const ordered = LEAGUE_ORDER.filter(l => l === 'ALL' || leagueSet.has(l))
    const others = [...leagueSet].filter(l => l && !LEAGUE_ORDER.includes(l))
    setAvailableLeagues([...ordered, ...others])
    setLinesLoading(false)
    if (lines.length === 0) { setError('No live props on PrizePicks right now. Check back soon.'); return }
    await loadPicksForLeague('ALL', lines)
  }

  async function loadPicksForLeague(league, lines) {
    const lns = lines || allLines
    if (!lns || lns.length === 0) return
    setStepLabels(STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)])
    setLoadingLeague(league); setProgress(40); setStepIdx(2); setError(null)
    try {
      const res = await fetch(`${SERVER}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, lines: lns, league: league === 'ALL' ? null : league, count: 10 })
      })
      setProgress(88); setStepIdx(3)
      const data = await res.json()
      if (!data.picks) throw new Error(data.error || 'No picks returned')
      const imageMap = {}
      lns.forEach(l => { if (l.image) imageMap[l.name] = l.image })
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

  async function handleTabSelect(league) {
    if (loadingLeague) return
    setSelectedLeague(league)
    setGoldFilter('all')
    if (picksCache[league] === undefined) await loadPicksForLeague(league)
  }

  function handleRefresh() {
    setSelectedLeague('ALL')
    setGoldFilter('all')
    initLines()
  }

  const isLoading = linesLoading || loadingLeague === selectedLeague
  const currentPicks = picksCache[selectedLeague] || []
  const goldPicks = currentPicks.filter(p => p.conf >= 90)
  const highPicks = currentPicks.filter(p => p.conf >= 75 && p.conf < 90)
  const regularPicks = currentPicks.filter(p => p.conf < 75)
  const displayPicks = goldFilter === 'gold' ? goldPicks : currentPicks

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: VOID }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: FONT_D, fontSize: '26px', fontWeight: 700, letterSpacing: '0.5px', color: INK, lineHeight: 1 }}>{pageTitle}</div>
          <div style={{ fontSize: '11px', color: INK_DIM, marginTop: '4px', fontFamily: FONT_M }}>{displayDate}{liveCount > 0 ? ` · ${liveCount} live props` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isLoading && <button onClick={handleRefresh} style={{ background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM, fontFamily: FONT_M, fontSize: '11px', padding: '5px 12px', borderRadius: '7px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(61,221,143,0.1)', border: '1px solid rgba(61,221,143,0.25)', color: GOOD, fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '7px', fontFamily: FONT_M }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: GOOD, animation: 'pulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {availableLeagues.length > 0 && (
        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <div style={{ overflowX: 'auto', paddingBottom: '6px' }}>
            <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
              {availableLeagues.map(league => {
                const isActive = selectedLeague === league
                const isThisLoading = loadingLeague === league
                const color = LEAGUE_COLORS[league] || INK_DIM
                const cached = picksCache[league] || []
                const hasGold = cached.some(p => p.conf >= 90)
                const isReal = REAL_DATA_LEAGUES.includes(league)
                const realStyle = isReal ? {
                  border: `1px solid ${isActive ? AMBER : AMBER_MED}`,
                  background: isActive ? AMBER : AMBER_DIM,
                  color: isActive ? '#100b02' : AMBER,
                  fontWeight: 700,
                } : {}
                return (
                  <button key={league} onClick={() => handleTabSelect(league)} disabled={!!loadingLeague} style={{
                    background: isActive ? `${color}22` : PANEL,
                    border: `1px solid ${isActive ? color : LINE_SOFT}`,
                    color: isActive ? color : INK_DIM,
                    fontFamily: FONT_M, fontSize: '12px', fontWeight: 600, letterSpacing: '1px',
                    padding: '8px 14px', borderRadius: '8px',
                    cursor: loadingLeague ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
                    opacity: loadingLeague && !isActive ? 0.5 : 1,
                    WebkitTapHighlightColor: 'transparent',
                    ...realStyle
                  }}>
                    {isReal
                      ? <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isActive ? '#100b02' : AMBER, display: 'inline-block', animation: 'pulseDot 1.8s ease-in-out infinite' }} />
                      : (hasGold && <span style={{ fontSize: '10px', color: AMBER }}>◆</span>)}
                    {league}
                    {isThisLoading && <span style={{ fontSize: '10px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
                    {cached.length > 0 && !isThisLoading && <span style={{ background: isActive ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)', color: isActive ? '#100b02' : INK_FAINT, fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '5px' }}>{cached.length}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!isLoading && currentPicks.length > 0 && (
        <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setGoldFilter('all')} style={{ background: goldFilter === 'all' ? 'rgba(255,255,255,0.07)' : 'none', border: `1px solid ${goldFilter === 'all' ? 'rgba(255,255,255,0.18)' : LINE_SOFT}`, color: goldFilter === 'all' ? INK : INK_FAINT, fontFamily: FONT_M, fontSize: '12px', fontWeight: 600, letterSpacing: '1px', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ALL PICKS <span style={{ background: 'rgba(255,255,255,0.08)', color: INK_FAINT, fontSize: '10px', padding: '1px 6px', borderRadius: '5px' }}>{currentPicks.length}</span>
          </button>
          {goldPicks.length > 0 && (
            <button onClick={() => setGoldFilter('gold')} style={{ background: goldFilter === 'gold' ? AMBER_DIM : 'none', border: `1px solid ${goldFilter === 'gold' ? AMBER : LINE_SOFT}`, color: goldFilter === 'gold' ? AMBER : INK_FAINT, fontFamily: FONT_M, fontSize: '12px', fontWeight: 600, letterSpacing: '1px', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ◆ GOLD <span style={{ background: goldFilter === 'gold' ? 'rgba(227,165,72,0.25)' : 'rgba(255,255,255,0.08)', color: goldFilter === 'gold' ? AMBER : INK_FAINT, fontSize: '10px', padding: '1px 6px', borderRadius: '5px' }}>{goldPicks.length}</span>
            </button>
          )}
          {highPicks.length > 0 && <div style={{ fontSize: '11px', color: INK_FAINT, marginLeft: 'auto', fontFamily: FONT_M }}>{highPicks.length} high · {regularPicks.length} regular</div>}
        </div>
      )}

      {isLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                <div style={{ width: '32px', height: '32px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: stepIdx > i ? AMBER : stepIdx === i ? AMBER_DIM : PANEL, border: stepIdx === i ? `2px solid ${AMBER}` : stepIdx > i ? 'none' : `1px solid ${LINE_SOFT}`, transition: 'all 0.4s ease', fontSize: '12px', fontWeight: 700, color: stepIdx > i ? '#100b02' : stepIdx === i ? AMBER : INK_FAINT, fontFamily: FONT_M }}>
                  {stepIdx > i ? '✓' : i + 1}
                </div>
                {i < 3 && <div style={{ width: '44px', height: '2px', background: stepIdx > i ? AMBER : LINE_SOFT, transition: 'background 0.6s ease' }} />}
              </React.Fragment>
            ))}
          </div>
          <div style={{ width: '100%', maxWidth: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontFamily: FONT_M, fontSize: '14px', fontWeight: 600, letterSpacing: '2px', color: AMBER }}>{stepLabels[stepIdx] || stepLabels[0]}</div>
              <div style={{ fontFamily: FONT_M, fontSize: '16px', fontWeight: 700, color: INK_DIM }}>{progress}%</div>
            </div>
            <div style={{ height: '6px', background: PANEL, borderRadius: '3px', overflow: 'hidden', border: `1px solid ${LINE_SOFT}` }}>
              <div style={{ height: '100%', background: AMBER, borderRadius: '3px', width: `${progress}%`, transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <div style={{ fontSize: '13px', color: INK_DIM, marginTop: '18px', lineHeight: 1.7, textAlign: 'center', minHeight: '44px', opacity: factVisible ? 1 : 0, transition: 'opacity 0.3s ease', fontFamily: FONT_B }}>{facts[factIdx]}</div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: INK_DIM, marginBottom: '16px', lineHeight: 1.6, fontFamily: FONT_B }}>{error}</div>
          <button onClick={handleRefresh} style={{ background: AMBER, border: 'none', color: '#100b02', fontFamily: FONT_M, fontWeight: 700, fontSize: '13px', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!isLoading && !error && displayPicks.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: `14px 20px ${parlayPicks.length > 0 ? '76px' : '24px'}` }}>
          {goldFilter === 'all' && goldPicks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: FONT_D, fontSize: '15px', fontWeight: 700, letterSpacing: '0.5px', color: AMBER }}>◆ GOLD</span>
                <div style={{ flex: 1, height: '1px', background: AMBER_DIM }} />
                <span style={{ fontSize: '11px', color: INK_FAINT, fontFamily: FONT_M }}>90%+</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {goldPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
              </div>
            </div>
          )}
          {goldFilter === 'all' && highPicks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: FONT_D, fontSize: '15px', fontWeight: 700, letterSpacing: '0.5px', color: GOOD }}>HIGH</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(61,221,143,0.2)' }} />
                <span style={{ fontSize: '11px', color: INK_FAINT, fontFamily: FONT_M }}>75-89%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {highPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
              </div>
            </div>
          )}
          {goldFilter === 'all' && regularPicks.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: FONT_D, fontSize: '15px', fontWeight: 700, letterSpacing: '0.5px', color: INK_DIM }}>PICKS</span>
                <div style={{ flex: 1, height: '1px', background: LINE_SOFT }} />
                <span style={{ fontSize: '11px', color: INK_FAINT, fontFamily: FONT_M }}>Below 75%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
                {regularPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
              </div>
            </div>
          )}
          {goldFilter === 'gold' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
              {goldPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && goldFilter === 'gold' && goldPicks.length === 0 && currentPicks.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_D, fontSize: '19px', fontWeight: 700, letterSpacing: '0.5px', color: INK_DIM, marginBottom: '8px' }}>NO GOLD PICKS</div>
          <div style={{ fontSize: '13px', color: INK_FAINT, marginBottom: '20px', fontFamily: FONT_B }}>No 90%+ confidence picks for {selectedLeague} right now.</div>
          <button onClick={() => setGoldFilter('all')} style={{ background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM, fontFamily: FONT_M, fontSize: '13px', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>View All Picks</button>
        </div>
      )}

      {!isLoading && !error && currentPicks.length === 0 && availableLeagues.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_D, fontSize: '19px', fontWeight: 700, letterSpacing: '0.5px', color: INK_DIM, marginBottom: '8px' }}>NO {selectedLeague} PICKS</div>
          <div style={{ fontSize: '13px', color: INK_FAINT, marginBottom: '20px', fontFamily: FONT_B }}>Try another sport or hit refresh.</div>
          <button onClick={() => handleTabSelect('ALL')} style={{ background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM, fontFamily: FONT_M, fontSize: '13px', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>View All Sports</button>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes pulseDot{0%,100%{opacity:1;}50%{opacity:0.35;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>
      <ParlayBuilder
        picks={parlayPicks}
        onRemove={id => setParlayPicks(prev => prev.filter(p => p.id !== id))}
        onClear={() => setParlayPicks([])}
      />
    </div>
  )
}