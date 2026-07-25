import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'
import ParlayBuilder, { MAX_LEGS } from './ParlayBuilder'
import { useSubscription } from './useSubscription'
import { supabase } from './supabase'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

// ============ SIGNAL design tokens (kept in sync with PickCard.jsx / Tonight.jsx) ============
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
  ['CONNECTING', 'SCANNING LINES', 'GOLD FILTER', 'VERIFYING EDGE'],
  ['STARTING SCAN', 'LIVE PROPS', 'CONFIDENCE CHECK', 'ELITE PLAYS'],
  ['GOING LIVE', 'FULL SCAN', 'HUNTING EDGES', 'FINAL CUT'],
  ['POWERING UP', 'REAL-TIME LINES', 'DEEP ANALYSIS', 'LOCKING GOLD'],
  ['BOOTING SCAN', 'LOADING DATA', 'WEIGHING FORM', 'GOLD BOARD'],
]

const FACTS = [
  'Gold picks are the rarest plays on the board. Most sessions only have 1 or 2.',
  'The bar for gold is 80%+ confidence. 90%+ for non-real-data sports.',
  'Over 250 live props are scanned every load to find the few that truly qualify.',
  'When gold picks hit they carry real conviction behind every number.',
  'Hot streak plus weak opponent plus high usage is the gold formula.',
  'Gold picks are shown separately because they deserve a different kind of attention.',
  'Recent form matters more than season averages when it comes to prop bets.',
  'The AI scores every line from 50 to 95. Gold means 90 or above.',
  'If the confidence is not there, no pick is made. Quality always beats quantity.',
  'MLB and WNBA picks are now backed by real game-by-game data from BALLDONTLIE.',
  'Lines are fetched fresh every time so you never see stale or outdated props.',
  'The AI never defaults to HIGHER. Direction is set by the data every time.',
  'Stat category breakdown is on every card so you can verify the logic yourself.',
  'Only pre-game props starting within the next 36 hours are ever shown.',
  'A verified league tab means those numbers come from real game logs.',
  'Every gold pick includes a risk factor so you know what could go wrong.',
  'High usage players hit volume-based lines more consistently over a full season.',
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

// ===== PAYWALL WRAPPER =====
export default function Gold() {
  const { status } = useSubscription()
  const [loadingCheckout, setLoadingCheckout] = useState(false)

  async function handleSubscribe() {
    setLoadingCheckout(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingCheckout(false); return }

    try {
      const res = await fetch(`${SERVER}/stripe/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, email: user.email })
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else { alert('Could not start checkout. Try again.'); setLoadingCheckout(false) }
    } catch (e) {
      alert('Could not start checkout. Try again.')
      setLoadingCheckout(false)
    }
  }

  if (status === 'loading') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: VOID }}>
        <div style={{ fontFamily: FONT_M, fontSize: '15px', letterSpacing: '2px', color: AMBER }}>CHECKING ACCESS...</div>
      </div>
    )
  }

  if (status === 'inactive') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', overflowY: 'auto', background: VOID }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%', marginBottom: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: AMBER_DIM, border: `1px solid ${AMBER_MED}`,
          fontFamily: FONT_D, fontSize: '26px', color: AMBER, fontWeight: 700
        }}>◆</div>
        <div style={{ fontFamily: FONT_D, fontSize: '30px', fontWeight: 700, letterSpacing: '0.5px', color: AMBER, marginBottom: '12px' }}>
          GOLD PICKS
        </div>
        <div style={{ fontSize: '14px', color: INK_DIM, maxWidth: '320px', lineHeight: 1.6, marginBottom: '16px', fontFamily: FONT_B }}>
          Unlock every gold pick across all sports. 80%+ confidence plays, the full board, updated live.
        </div>
        <div style={{ fontFamily: FONT_M, fontSize: '36px', fontWeight: 700, letterSpacing: '0.5px', color: INK, marginBottom: '4px', lineHeight: 1 }}>
          $25<span style={{ fontSize: '16px', color: INK_DIM, fontFamily: FONT_B, fontWeight: 400 }}>/month</span>
        </div>
        <div style={{ fontSize: '11px', color: INK_FAINT, marginBottom: '28px', fontFamily: FONT_M }}>Cancel anytime</div>

        <button
          onClick={handleSubscribe}
          disabled={loadingCheckout}
          style={{
            background: AMBER,
            border: 'none', borderRadius: '10px',
            color: '#100b02', fontFamily: FONT_D, fontSize: '17px', fontWeight: 700,
            letterSpacing: '1px', padding: '15px 44px', cursor: loadingCheckout ? 'not-allowed' : 'pointer',
            opacity: loadingCheckout ? 0.6 : 1, textTransform: 'uppercase',
            WebkitTapHighlightColor: 'transparent', boxShadow: '0 0 24px rgba(227,165,72,0.25)'
          }}
        >
          {loadingCheckout ? 'Loading...' : 'Unlock Gold'}
        </button>

        <div style={{ fontSize: '11px', color: INK_FAINT, marginTop: '20px', maxWidth: '280px', lineHeight: 1.5, fontFamily: FONT_B }}>
          Free Tonight picks still include occasional gold calls. This unlocks the full gold board.
        </div>
      </div>
    )
  }

  return <GoldContent />
}

// ===== GOLD CONTENT (subscribers only) =====
function GoldContent() {
  const [allLines, setAllLines] = useState([])
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
  const [parlayPicks, setParlayPicks] = useState([])

  function toggleParlay(pick) {
    setParlayPicks(prev => {
      if (prev.some(p => p.id === pick.id)) return prev.filter(p => p.id !== pick.id)
      if (prev.length >= MAX_LEGS) return prev
      return [...prev, pick]
    })
  }

  const now = new Date()
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => { initLines('ALL') }, [])

  useEffect(() => {
    const isLoading = linesLoading || !!loadingLeague
    if (!isLoading) return
    const interval = setInterval(() => {
      setFactVisible(false)
      setTimeout(() => { setFactIdx(i => (i + 1) % facts.length); setFactVisible(true) }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [linesLoading, loadingLeague, facts])

  async function initLines(startLeague = 'ALL') {
    setLinesLoading(true)
    setPicksCache({})
    setFacts(shuffle(FACTS))
    setStepLabels(STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)])
    setProgress(0); setStepIdx(0); setFactIdx(0); setFactVisible(true); setError(null)
    setSelectedLeague(startLeague)
    await new Promise(r => setTimeout(r, 200))
    setProgress(15); setStepIdx(1)

    const lines = await fetchAllLines(SERVER)
    setAllLines(lines)
    setProgress(35)

    const leagueSet = new Set(lines.map(l => (l.league || '').toUpperCase()).filter(Boolean))
    const ordered = LEAGUE_ORDER.filter(l => l === 'ALL' || leagueSet.has(l))
    const others = [...leagueSet].filter(l => l && !LEAGUE_ORDER.includes(l))
    setAvailableLeagues([...ordered, ...others])
    setLinesLoading(false)

    if (lines.length === 0) {
      setError('No live props on PrizePicks right now. Check back soon.')
      return
    }

    await loadGoldForLeague(startLeague, lines)
  }

  async function loadGoldForLeague(league, lines) {
    const lns = lines || allLines
    if (!lns || lns.length === 0) return

    setStepLabels(STEP_LABELS[Math.floor(Math.random() * STEP_LABELS.length)])
    setLoadingLeague(league)
    setProgress(40); setStepIdx(2); setError(null)

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

      setProgress(88); setStepIdx(3)
      const data = await res.json()

      if (!res.ok || !data.picks) {
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

  async function handleTabSelect(league) {
    if (loadingLeague) return
    setSelectedLeague(league)
    if (picksCache[league] === undefined) {
      await loadGoldForLeague(league, allLines)
    }
  }

  function handleRefresh() {
    initLines(selectedLeague)
  }

  const isLoading = linesLoading || loadingLeague === selectedLeague
  const currentPicks = picksCache[selectedLeague] || []

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: VOID }}>

      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: FONT_D, fontSize: '26px', fontWeight: 700, letterSpacing: '0.5px', lineHeight: 1, color: AMBER }}>◆ GOLD PICKS</div>
          <div style={{ fontSize: '11px', color: INK_DIM, marginTop: '4px', fontFamily: FONT_M }}>80%+ confidence · Strongest verified plays right now</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isLoading && <button onClick={handleRefresh} style={{ background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM, fontFamily: FONT_M, fontSize: '11px', padding: '5px 12px', borderRadius: '7px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: AMBER_DIM, border: `1px solid ${AMBER_MED}`, color: AMBER, fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '7px', fontFamily: FONT_M }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: AMBER, animation: 'pulse 1.5s infinite' }} />LIVE
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
                    opacity: loadingLeague && !isActive ? 0.5 : 1, WebkitTapHighlightColor: 'transparent',
                    ...realStyle
                  }}>
                    {isReal
                      ? <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isActive ? '#100b02' : AMBER, display: 'inline-block', animation: 'pulseDot 1.8s ease-in-out infinite' }} />
                      : <span style={{ fontSize: '10px', color: AMBER }}>◆</span>}
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

      {!isLoading && !error && currentPicks.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: `14px 20px ${parlayPicks.length > 0 ? '76px' : '24px'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontFamily: FONT_D, fontSize: '15px', fontWeight: 700, letterSpacing: '0.5px', color: AMBER }}>◆ GOLD — {selectedLeague}</span>
            <div style={{ flex: 1, height: '1px', background: AMBER_DIM }} />
            <span style={{ fontSize: '11px', color: INK_FAINT, fontFamily: FONT_M }}>{currentPicks.length} pick{currentPicks.length !== 1 ? 's' : ''} · 80%+</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
            {currentPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
          </div>
        </div>
      )}

      {!isLoading && !error && currentPicks.length === 0 && availableLeagues.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_D, fontSize: '24px', color: AMBER, marginBottom: '16px' }}>◆</div>
          <div style={{ fontFamily: FONT_D, fontSize: '20px', fontWeight: 700, letterSpacing: '0.5px', color: INK_DIM, marginBottom: '8px' }}>NO GOLD FOR {selectedLeague}</div>
          <div style={{ fontSize: '13px', color: INK_FAINT, marginBottom: '24px', lineHeight: 1.6, maxWidth: '280px', fontFamily: FONT_B }}>No verified picks hit {selectedLeague === 'WNBA' ? '70%+' : selectedLeague === 'MLB' ? '80%+' : '90%+'} confidence for {selectedLeague} right now. Try another league or check back later.</div>
          {selectedLeague !== 'ALL' && <button onClick={() => handleTabSelect('ALL')} style={{ background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM, fontFamily: FONT_M, fontSize: '13px', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', marginBottom: '10px' }}>Check All Sports</button>}
          <button onClick={handleRefresh} style={{ background: 'none', border: `1px solid ${AMBER_MED}`, color: AMBER, fontFamily: FONT_M, fontSize: '13px', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>Refresh Picks</button>
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