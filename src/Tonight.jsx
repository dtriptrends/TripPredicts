import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const LEAGUE_ORDER = ['ALL', 'MLB', 'WNBA', 'NBA', 'NHL', 'NFL', 'CS2', 'LOL', 'VALORANT', 'COD', 'SOCCER', 'TENNIS', 'GOLF', 'MMA']

// Sports backed by real BALLDONTLIE game data. These tabs get the fiery treatment.
const REAL_DATA_LEAGUES = ['MLB', 'WNBA']

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
  'A red flame tab means the numbers on those cards come from real game logs.',
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
    // Group projections by player + stat so the standard, goblin and demon
    // variants of the same prop collapse into one line. We show the standard
    // line by default and keep the goblin/demon values as alternates.
    const groups = {}
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
      if (!groups[key]) {
        groups[key] = {
          name: player.name, team: player.team, league: player.league, image: player.image,
          stat: a.stat_display_name,
          start_time: startTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET',
          date: startTime.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }),
          variants: {}
        }
      }
      groups[key].variants[oddsType] = Number(a.line_score)
    })
    const results = []
    Object.values(groups).forEach(g => {
      const v = g.variants
      const line = v.standard != null ? v.standard : (v.goblin != null ? v.goblin : v.demon)
      if (line == null || isNaN(line)) return
      results.push({
        name: g.name,
        team: g.team,
        league: g.league,
        image: g.image,
        stat: g.stat,
        line,
        oddsType: v.standard != null ? 'standard' : (v.goblin != null ? 'goblin' : 'demon'),
        altLines: {
          standard: v.standard != null ? v.standard : null,
          goblin: v.goblin != null ? v.goblin : null,
          demon: v.demon != null ? v.demon : null
        },
        start_time: g.start_time,
        date: g.date
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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '28px', letterSpacing: '2px', color: 'var(--text)', lineHeight: 1 }}>{pageTitle}</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '3px' }}>{displayDate}{liveCount > 0 ? ` · ${liveCount} live props` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isLoading && <button onClick={handleRefresh} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--high)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--high)', animation: 'pulse 1.5s infinite' }} />LIVE
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
                const color = LEAGUE_COLORS[league] || '#7a8aaa'
                const cached = picksCache[league] || []
                const hasGold = cached.some(p => p.conf >= 90)
                const isReal = REAL_DATA_LEAGUES.includes(league)
                const realStyle = isReal ? {
                  border: `1px solid ${isActive ? '#ff7a1a' : 'rgba(255,95,25,0.55)'}`,
                  background: isActive
                    ? 'linear-gradient(115deg, #a82200, #ff6200, #ffa432, #ff5400, #a82200)'
                    : 'linear-gradient(115deg, rgba(255,70,0,0.22), rgba(255,140,0,0.12), rgba(38,16,8,0.55), rgba(255,70,0,0.22))',
                  backgroundSize: '300% 100%',
                  color: isActive ? '#fff' : '#ffae73',
                  fontWeight: 800,
                  textShadow: isActive ? '0 0 9px rgba(255,150,0,0.75)' : 'none',
                  animation: 'realFlow 3s linear infinite, realDataGlow 2.2s ease-in-out infinite',
                } : {}
                return (
                  <button key={league} onClick={() => handleTabSelect(league)} disabled={!!loadingLeague} style={{
                    background: isActive ? `${color}22` : 'var(--bg3)',
                    border: `1px solid ${isActive ? color : 'var(--border)'}`,
                    color: isActive ? color : 'var(--text2)',
                    fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                    padding: '8px 14px', borderRadius: '20px',
                    cursor: loadingLeague ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
                    opacity: loadingLeague && !isActive ? 0.5 : 1,
                    WebkitTapHighlightColor: 'transparent',
                    ...realStyle
                  }}>
                    {isReal
                      ? <span style={{ fontSize: '11px', display: 'inline-block', animation: 'flameFlick 0.85s ease-in-out infinite' }}>🔥</span>
                      : (hasGold && <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>)}
                    {league}
                    {isThisLoading && <span style={{ fontSize: '10px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
                    {cached.length > 0 && !isThisLoading && <span style={{ background: isActive ? color : 'var(--border2)', color: isActive ? '#000' : 'var(--text3)', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px' }}>{cached.length}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!isLoading && currentPicks.length > 0 && (
        <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setGoldFilter('all')} style={{ background: goldFilter === 'all' ? 'rgba(255,255,255,0.08)' : 'none', border: `1px solid ${goldFilter === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`, color: goldFilter === 'all' ? 'var(--text)' : 'var(--text3)', fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px', padding: '6px 14px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ALL PICKS <span style={{ background: 'var(--border2)', color: 'var(--text3)', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{currentPicks.length}</span>
          </button>
          {goldPicks.length > 0 && (
            <button onClick={() => setGoldFilter('gold')} style={{ background: goldFilter === 'gold' ? 'rgba(245,200,66,0.12)' : 'none', border: `1px solid ${goldFilter === 'gold' ? '#f5c842' : 'var(--border)'}`, color: goldFilter === 'gold' ? '#f5c842' : 'var(--text3)', fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px', padding: '6px 14px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px' }}>★</span> GOLD <span style={{ background: goldFilter === 'gold' ? 'rgba(245,200,66,0.25)' : 'var(--border2)', color: goldFilter === 'gold' ? '#f5c842' : 'var(--text3)', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{goldPicks.length}</span>
            </button>
          )}
          {highPicks.length > 0 && <div style={{ fontSize: '11px', color: 'var(--text3)', marginLeft: 'auto' }}>{highPicks.length} high · {regularPicks.length} regular</div>}
        </div>
      )}

      {isLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: stepIdx > i ? 'var(--gold)' : stepIdx === i ? 'rgba(245,200,66,0.15)' : 'var(--bg3)', border: stepIdx === i ? '2px solid var(--gold)' : stepIdx > i ? 'none' : '1px solid var(--border2)', transition: 'all 0.4s ease', fontSize: '12px', fontWeight: 700, color: stepIdx > i ? '#1a0f00' : stepIdx === i ? 'var(--gold)' : 'var(--text3)', fontFamily: 'var(--font-c)' }}>
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
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '18px', lineHeight: 1.7, textAlign: 'center', minHeight: '44px', opacity: factVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}>{facts[factIdx]}</div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={handleRefresh} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!isLoading && !error && displayPicks.length > 0 && (
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
          {goldFilter === 'gold' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
              {goldPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} />)}
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && goldFilter === 'gold' && goldPicks.length === 0 && currentPicks.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '20px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD PICKS</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>No 90%+ confidence picks for {selectedLeague} right now.</div>
          <button onClick={() => setGoldFilter('all')} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer' }}>View All Picks</button>
        </div>
      )}

      {!isLoading && !error && currentPicks.length === 0 && availableLeagues.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '20px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO {selectedLeague} PICKS</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>Try another sport or hit refresh.</div>
          <button onClick={() => handleTabSelect('ALL')} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer' }}>View All Sports</button>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        @keyframes realDataGlow{
          0%,100%{box-shadow:0 0 8px rgba(255,60,0,0.35), 0 0 18px rgba(255,110,0,0.18), inset 0 0 8px rgba(255,90,0,0.15);}
          50%{box-shadow:0 0 16px rgba(255,80,0,0.6), 0 0 34px rgba(255,140,0,0.32), inset 0 0 12px rgba(255,110,0,0.25);}
        }
        @keyframes realFlow{
          0%{background-position:0% 50%;}
          50%{background-position:100% 50%;}
          100%{background-position:0% 50%;}
        }
        @keyframes flameFlick{
          0%,100%{transform:scale(1) rotate(-3deg);filter:brightness(1) drop-shadow(0 0 3px rgba(255,120,0,0.85));}
          30%{transform:scale(1.18) rotate(3deg);filter:brightness(1.35) drop-shadow(0 0 6px rgba(255,165,0,0.95));}
          60%{transform:scale(0.94) rotate(-2deg);filter:brightness(1.1) drop-shadow(0 0 4px rgba(255,90,0,0.85));}
        }
      `}</style>
    </div>
  )
}