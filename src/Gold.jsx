import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'
import ParlayBuilder, { MAX_LEGS } from './ParlayBuilder'
import { useSubscription } from './useSubscription'
import { supabase } from './supabase'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

// Football season: NFL and college football lead the tab row. Any league on
// the slate that is not listed here still gets a tab, appended at the end.
const LEAGUE_ORDER = ['ALL', 'NFL', 'CFB', 'NBA', 'NHL', 'MLB', 'WNBA', 'CS2', 'LOL', 'VALORANT', 'COD', 'SOCCER', 'TENNIS', 'GOLF', 'MMA']

// Sports backed by real BALLDONTLIE game data get the fiery tab treatment.
// The BDL feed is paused for the offseason, so nothing qualifies right now.
// Put 'MLB', 'WNBA', 'LOL', 'CS2' back here when the subscriptions return.
const REAL_DATA_LEAGUES = []

// Football is detected by prefix because PrizePicks runs partial-game and
// season-long football boards too (NFL1H, NFLSZN, CFB1H and so on).
function isFootball(lg) {
  const l = String(lg || '').toUpperCase()
  return l.startsWith('NFL') || l.startsWith('CFB') || l.includes('FOOTBALL')
}

// Football is a weekly sport. PrizePicks posts the Sunday slate days ahead,
// and a football board that only appears 36 hours before kickoff would be
// empty most of the week. Football lines are kept for 6 days out; every
// other sport keeps the 36 hour window.
const LINE_WINDOW_HOURS = 36
const FOOTBALL_WINDOW_HOURS = 6 * 24

const LEAGUE_COLORS = {
  'ALL':      '#f5c842',
  'NFL':      '#4a90d9',
  'CFB':      '#e8a33d',
  'NBA':      '#e17210',
  'MLB':      '#4a90d9',
  'NHL':      '#aab4cc',
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
  ['CONNECTING', 'SCANNING LINES', 'TRAP FILTER', 'VERIFYING STATUS'],
  ['STARTING SCAN', 'LIVE PROPS', 'SCORING EDGES', 'CHECKING INJURY REPORTS'],
  ['GOING LIVE', 'FULL SCAN', 'HUNTING EDGES', 'STATUS CHECK'],
  ['POWERING UP', 'REAL-TIME LINES', 'DEEP ANALYSIS', 'PAIRING LEGS'],
  ['BOOTING SCAN', 'LOADING SLATE', 'WEIGHING FORM', 'FINAL VERIFY'],
]

const FACTS = [
  'Gold picks are the rarest plays on the board. Most sessions only have 1 or 2.',
  'Gold means clearing the score floor, the trap filter, AND the status check.',
  'Football season: NFL and college football lead every board while the season is on.',
  'Every sport with live lines gets scanned. All top picks go through the analyst.',
  'Football props are scored on role and volume: targets, carries, snaps, and game script.',
  'The starting quarterback decides every pass catcher on that team. The analyst checks him.',
  'Streak traps are filtered out. 12+ of 15 green games is bait, not value.',
  'Ratings are shrunk for sample size, so a short hot streak can never fake a lock.',
  'Every top pick is checked against the injury report: designation, practice status, lineup.',
  'A player ruled out, inactive, or missing from the lineup is removed from the board entirely.',
  'Best Slips shows the strongest 2 to 6 man combos, built from verified legs only.',
  'Two legs from the same team never get paired. One bad team night kills both.',
  'A 2-leg Power Play pays 3x, so anything above 33% combined is a real edge.',
  'Lines are fetched fresh every time so you never see stale or outdated props.',
  'The model scores the LINE, not the streak. Projection vs number is what matters.',
  'Football lines stay on the board up to 6 days out. Everything else shows within 36 hours.',
  'Outdoor football games get a weather check. Wind hurts passing and kicking props.',
  'Tap View Info on any card to read the analyst\'s finding on that player.',
  'The status check runs live web searches. That is why gold takes a moment to build.',
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
      const playerId = proj.relationships?.new_player?.data?.id
      const player = players[playerId]
      if (!player || !player.name) return
      const windowHours = isFootball(player.league) ? FOOTBALL_WINDOW_HOURS : LINE_WINDOW_HOURS
      if (hoursUntil < 0 || hoursUntil > windowHours) return
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
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '18px', letterSpacing: '2px', color: 'var(--gold)' }}>CHECKING ACCESS...</div>
      </div>
    )
  }

  if (status === 'inactive') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', overflowY: 'auto' }}>
        <div style={{ fontSize: '52px', marginBottom: '16px' }}>🔒</div>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '32px', letterSpacing: '2px', background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '12px' }}>
          ★ GOLD PICKS
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text2)', maxWidth: '320px', lineHeight: 1.6, marginBottom: '16px' }}>
          Every gold pick, scored, trap-filtered, and verified against the injury report and lineups. NFL and college football first all season, plus the strongest slips, updated live.
        </div>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '40px', letterSpacing: '1px', color: '#f5c842', marginBottom: '4px', lineHeight: 1 }}>
          $25<span style={{ fontSize: '18px', color: 'var(--text2)' }}>/month</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '28px' }}>Cancel anytime</div>

        <button
          onClick={handleSubscribe}
          disabled={loadingCheckout}
          style={{
            background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)',
            border: 'none', borderRadius: '12px',
            color: '#1a0f00', fontFamily: 'var(--font-d)', fontSize: '20px',
            letterSpacing: '2px', padding: '16px 48px', cursor: loadingCheckout ? 'not-allowed' : 'pointer',
            opacity: loadingCheckout ? 0.6 : 1, textTransform: 'uppercase',
            WebkitTapHighlightColor: 'transparent', boxShadow: '0 0 30px rgba(245,200,66,0.3)'
          }}
        >
          {loadingCheckout ? 'Loading...' : 'Unlock Gold'}
        </button>

        <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '20px', maxWidth: '280px', lineHeight: 1.5 }}>
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
  const [pairsCache, setPairsCache] = useState({})
  const [warningsCache, setWarningsCache] = useState({})
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

  // Add both legs of a suggested pairing to the parlay in one tap. Legs in the
  // pair are slim objects, so pull the full pick from the current board by id.
  function addPairToParlay(pair, boardPicks) {
    const fullLegs = pair.legs
      .map(l => boardPicks.find(p => p.id === l.id))
      .filter(Boolean)
    setParlayPicks(prev => {
      let next = [...prev]
      for (const leg of fullLegs) {
        if (!next.some(p => p.id === leg.id) && next.length < MAX_LEGS) next.push(leg)
      }
      return next
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
    setPairsCache({})
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
    // Unlisted leagues: any football variant (NFL1H, NFLSZN, CFB1H) goes
    // right after the main football tabs, everything else goes to the end.
    const others = [...leagueSet].filter(l => l && !LEAGUE_ORDER.includes(l))
    const otherFootball = others.filter(isFootball)
    const otherRest = others.filter(l => !isFootball(l))
    const mainFootball = ordered.filter(isFootball)
    const nonFootball = ordered.filter(l => !isFootball(l) && l !== 'ALL')
    setAvailableLeagues(['ALL', ...mainFootball, ...otherFootball, ...nonFootball, ...otherRest])
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

    // The gold pipeline now includes a live status-verification stage, so a
    // cold load can take 30-60s. Creep the bar so the wait reads as work
    // being done, not a hang. Cached loads snap straight to 100.
    let prog = 40
    const creep = setInterval(() => {
      prog = Math.min(prog + 1, 85)
      setProgress(prog)
      if (prog >= 68) setStepIdx(3)
    }, 700)

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

      clearInterval(creep)
      setProgress(88); setStepIdx(3)
      const data = await res.json()

      if (!res.ok || !data.picks) {
        setPicksCache(prev => ({ ...prev, [league]: [] }))
        setPairsCache(prev => ({ ...prev, [league]: [] }))
        setLoadingLeague(null)
        return
      }

      const imageMap = {}
      lns.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setProgress(100)
      await new Promise(r => setTimeout(r, 300))
      setPicksCache(prev => ({ ...prev, [league]: data.picks }))
      const slips = (data.slips && data.slips.length)
        ? data.slips
        : (data.pairs || []).map(p => ({ size: 2, payout: 3, breakeven: 33.3, ...p }))
      setPairsCache(prev => ({ ...prev, [league]: slips }))
      setWarningsCache(prev => ({ ...prev, [league]: data.warnings || [] }))
    } catch (e) {
      clearInterval(creep)
      console.error('Gold fetch error:', e.message)
      setPicksCache(prev => ({ ...prev, [league]: [] }))
      setPairsCache(prev => ({ ...prev, [league]: [] }))
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
  const currentPairs = pairsCache[selectedLeague] || []
  const currentWarnings = warningsCache[selectedLeague] || []

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '28px', letterSpacing: '2px', lineHeight: 1, background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>★ GOLD PICKS</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '3px' }}>Scored · Trap-filtered · Verified against the injury report</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isLoading && <button onClick={handleRefresh} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.25)', color: 'var(--gold)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold)', animation: 'pulse 1.5s infinite' }} />LIVE
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
                const color = LEAGUE_COLORS[league] || (isFootball(league) ? LEAGUE_COLORS['NFL'] : '#7a8aaa')
                const cached = picksCache[league] || []
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
                    opacity: loadingLeague && !isActive ? 0.5 : 1, WebkitTapHighlightColor: 'transparent',
                    ...realStyle
                  }}>
                    {isReal
                      ? <span style={{ fontSize: '11px', display: 'inline-block', animation: 'flameFlick 0.85s ease-in-out infinite' }}>🔥</span>
                      : isFootball(league)
                        ? <span style={{ fontSize: '11px' }}>🏈</span>
                        : <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>}
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

      {!isLoading && !error && currentPicks.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: `14px 20px ${parlayPicks.length > 0 ? '76px' : '24px'}` }}>

          {currentWarnings.length > 0 && (
            <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,170,0,0.35)', background: 'rgba(255,170,0,0.07)', fontSize: '12px', color: '#ffca5f', lineHeight: 1.5 }}>
              ⚠ {currentWarnings[0]}
            </div>
          )}

          {currentPairs.length > 0 && (
            <div style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: '#f5c842' }}>⛓ BEST SLIPS</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(245,200,66,0.2)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text3)' }}>2 to 6 man power plays · caution legs never included</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
                {currentPairs.map((pair, pi) => {
                  const bothIn = pair.legs.every(l => parlayPicks.some(p => p.id === l.id))
                  const fullyVerified = !!pair.verified
                  const statusLabel = fullyVerified ? '✓ VERIFIED' : pair.analystDown ? '○ UNVERIFIED' : '○ NO RED FLAGS'
                  return (
                    <div key={pi} style={{
                      background: pi === 0
                        ? 'linear-gradient(135deg, rgba(245,200,66,0.10), rgba(212,160,23,0.04), var(--bg3))'
                        : 'var(--bg3)',
                      border: pi === 0 ? '1px solid rgba(245,200,66,0.45)' : '1px solid var(--border)',
                      borderRadius: '14px', padding: '14px',
                      boxShadow: pi === 0 ? '0 0 22px rgba(245,200,66,0.12)' : 'none'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px',
                          color: fullyVerified ? '#00e676' : '#f5c842',
                          background: fullyVerified ? 'rgba(0,230,118,0.08)' : 'rgba(245,200,66,0.08)',
                          border: fullyVerified ? '1px solid rgba(0,230,118,0.25)' : '1px solid rgba(245,200,66,0.25)',
                          padding: '3px 8px', borderRadius: '20px'
                        }}>
                          {pair.size || pair.legs.length}-MAN · {statusLabel}
                        </span>
                        <span style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '1px', color: '#f5c842', lineHeight: 1 }}>
                          {pair.combined}%<span style={{ fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.5px', marginLeft: '4px' }}>COMBINED</span>
                        </span>
                      </div>

                      {pair.legs.map((leg, li) => (
                        <div key={li} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderTop: li > 0 ? '1px solid var(--border)' : 'none' }}>
                          <span style={{ color: leg.dir === 'HIGHER' ? '#00e676' : '#ef4444', fontSize: '14px', fontWeight: 800, width: '14px', textAlign: 'center' }}>
                            {leg.dir === 'HIGHER' ? '▲' : '▼'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leg.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{leg.league}{leg.team ? ` · ${leg.team}` : ''} · {leg.stat} {leg.dir === 'HIGHER' ? 'over' : 'under'} {leg.val}</div>
                          </div>
                          <span style={{ fontFamily: 'var(--font-c)', fontSize: '13px', fontWeight: 700, color: 'var(--gold)' }}>{leg.conf}</span>
                        </div>
                      ))}

                      {pair.payout && (
                        <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>
                          Power play pays <span style={{ color: '#f5c842', fontWeight: 700 }}>{pair.payout}x</span> · breakeven {pair.breakeven}% · this slip {pair.combined >= (pair.breakeven || 0) ? 'clears it' : 'is below it'}
                        </div>
                      )}
                      <button
                        onClick={() => addPairToParlay(pair, currentPicks)}
                        disabled={bothIn}
                        style={{
                          width: '100%', marginTop: '10px',
                          background: bothIn ? 'rgba(0,230,118,0.08)' : 'none',
                          border: bothIn ? '1px solid rgba(0,230,118,0.3)' : '1px solid rgba(245,200,66,0.35)',
                          color: bothIn ? '#00e676' : '#f5c842',
                          fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                          padding: '8px 0', borderRadius: '10px',
                          cursor: bothIn ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent'
                        }}
                      >
                        {bothIn ? '✓ IN PARLAY' : 'ADD ALL TO PARLAY'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontFamily: 'var(--font-d)', fontSize: '16px', letterSpacing: '2px', color: '#f5c842' }}>★ GOLD — {selectedLeague}</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(245,200,66,0.2)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{currentPicks.length} pick{currentPicks.length !== 1 ? 's' : ''} · verified board</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
            {currentPicks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 60} selected={parlayPicks.some(x => x.id === p.id)} onToggleParlay={toggleParlay} />)}
          </div>
        </div>
      )}

      {!isLoading && !error && currentPicks.length === 0 && availableLeagues.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>★</div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD FOR {selectedLeague}</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '24px', lineHeight: 1.6, maxWidth: '280px' }}>No picks cleared the gold score floor, the trap filter, and the status check for {selectedLeague}. Try another league or check back later.</div>
          {selectedLeague !== 'ALL' && <button onClick={() => handleTabSelect('ALL')} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', marginBottom: '10px' }}>Check All Sports</button>}
          <button onClick={handleRefresh} style={{ background: 'none', border: '1px solid rgba(245,200,66,0.3)', color: '#f5c842', fontFamily: 'var(--font)', fontSize: '13px', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer' }}>Refresh Picks</button>
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
      <ParlayBuilder
        picks={parlayPicks}
        onRemove={id => setParlayPicks(prev => prev.filter(p => p.id !== id))}
        onClear={() => setParlayPicks([])}
      />
    </div>
  )
}