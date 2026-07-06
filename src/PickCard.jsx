import React, { useState, useEffect, useMemo } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

// ============ SIGNAL design tokens ============
// Near-black terminal base, one signature amber accent for verified data and
// gold tier, a separate cool accent reserved only for the user's own parlay
// selections so it never gets confused with "the data says this is strong."
const INK       = '#F1EEE6'
const INK_DIM   = '#9AA0AB'
const INK_FAINT = '#565A66'
const PANEL     = 'rgba(16,18,24,0.92)'
const PANEL_GOLD = 'linear-gradient(180deg,#12141b 55%,#1c1608 100%)'
const IMG_BG    = '#0B0D12'
const LINE_SOFT = 'rgba(255,255,255,0.07)'
const AMBER      = '#E3A548'
const AMBER_DIM  = 'rgba(227,165,72,0.14)'
const AMBER_MED  = 'rgba(227,165,72,0.4)'
const PULSE_BLUE = '#4FC3F7'
const GOOD = '#3DDD8F'
const BAD  = '#F2555F'

const FONT_D = "'Space Grotesk',sans-serif"
const FONT_M = "'IBM Plex Mono',monospace"
const FONT_B = "'Barlow',sans-serif"

// Sports with real game-by-game data wired in (BALLDONTLIE).
const REAL_DATA_LEAGUES = ['MLB', 'WNBA']

// Never show a real-data chart on a tiny sample. Hide it until we have enough.
const MIN_REAL_GAMES = 10

// PrizePicks esports props are scoped to a number of maps ("Map 1", "Maps 1-2").
// We read that count so we can measure real per-map pace against the line.
function mapScope(label) {
  const p = String(label || '').toLowerCase()
  let m = p.match(/maps?\s*(\d+)\s*(?:-|to|through)\s*(\d+)/)
  if (m) return Math.max(1, parseInt(m[2], 10) - parseInt(m[1], 10) + 1)
  if (/map\s*\d+/.test(p)) return 1
  return 1
}

function tierOf(c) { return c >= 80 ? 'gold' : c >= 65 ? 'high' : 'regular' }

// Map a PrizePicks prop label to the real stat value for one game row.
// Combos (PRA, H+R+RBI, etc.) are computed from base fields. Returns null when
// we cannot map the stat, so the UI hides the hit-rate instead of guessing.
function bdlStatValue(league, g, propLabel) {
  const p = String(propLabel || '').toLowerCase()
  if (p.includes('fantasy') || /\bfs\b/.test(p)) return null // weighted formula we can't verify; skip, don't fake

  if (league === 'WNBA') {
    const pts = +g.pts || 0, reb = +g.reb || 0, ast = +g.ast || 0
    const stl = +g.stl || 0, blk = +g.blk || 0
    const oreb = +g.oreb || 0, dreb = +g.dreb || 0
    const fg3m = +g.fg3m || 0, fg3a = +g.fg3a || 0
    const fgm = +g.fgm || 0, fga = +g.fga || 0
    const ftm = +g.ftm || 0, fta = +g.fta || 0
    const tov = +g.turnover || 0, pf = +g.pf || 0
    const isAtt = p.includes('attempt') || /\b(3pta|fga|fta|pta)\b/.test(p)
    const hasPts = p.includes('point') || p.includes('pts')
    const hasReb = p.includes('rebound') || p.includes('reb')
    const hasAst = p.includes('assist') || p.includes('ast')

    // combos first
    if (hasPts && hasReb && hasAst) return pts + reb + ast
    if (hasPts && hasReb) return pts + reb
    if (hasPts && hasAst) return pts + ast
    if (hasReb && hasAst) return reb + ast
    if ((p.includes('blk') || p.includes('block')) && (p.includes('stl') || p.includes('steal'))) return blk + stl

    // shooting (check three before fg so "3-pt" never falls into fg)
    if (p.includes('three') || p.includes('3-pt') || p.includes('3pt') || p.includes('3 pt') || p.includes('3-point')) return isAtt ? fg3a : fg3m
    if (p.includes('free throw') || /\bft[ma]\b/.test(p)) return isAtt ? fta : ftm
    if (p.includes('field goal') || (p.includes('fg') && !p.includes('fg3'))) return isAtt ? fga : fgm

    if (p.includes('offensive') && hasReb) return oreb
    if (p.includes('defensive') && hasReb) return dreb
    if (p.includes('turnover')) return tov
    if (p.includes('foul')) return pf
    if (p.includes('steal')) return stl
    if (p.includes('block')) return blk
    if (hasReb) return reb
    if (hasAst) return ast
    if (hasPts) return pts
    return null
  }

  if (league === 'MLB') {
    // pitcher props first, identified by pitch / allowed / earned run wording
    if (p.includes('pitch') || p.includes('allowed') || p.includes('earned run')) {
      if (p.includes('pitches thrown') || p.includes('pitch count')) return +g.pitch_count || 0
      if (p.includes('strikeout') || p.includes('strike out')) return +g.p_k || 0
      if (p.includes('hit')) return +g.p_hits || 0
      if (p.includes('earned run')) return +g.er || 0
      if (p.includes('walk')) return +g.p_bb || 0
      if (p.includes('out')) return +g.pitching_outs || 0
      return null
    }
    const hits = +g.hits || 0, runs = +g.runs || 0, rbi = +g.rbi || 0
    const hr = +g.hr || 0, doubles = +g.doubles || 0, triples = +g.triples || 0
    if (p.includes('hits') && p.includes('runs') && p.includes('rbi')) return hits + runs + rbi
    if (p.includes('total base')) return +g.total_bases || 0
    if (p.includes('home run')) return hr
    if (p.includes('stolen')) return +g.stolen_bases || 0
    if (p.includes('single')) return Math.max(0, hits - doubles - triples - hr)
    if (p.includes('double')) return doubles
    if (p.includes('triple')) return triples
    if (p.includes('walk')) return +g.bb || 0
    if (p.includes('rbi')) return rbi
    if (p.includes('run')) return runs
    if (p.includes('strikeout') || p === 'k') return +g.k || 0
    if (p.includes('at bat') || p.includes('at-bat')) return +g.at_bats || 0
    if (p.includes('hit')) return hits
    return null
  }

  if (league === 'LOL') {
    // per-map rows from player_match_map_stats
    if (p.includes('kill') && !p.includes('participation')) return +g.kills || 0
    if (p.includes('death')) return +g.deaths || 0
    if (p.includes('assist')) return +g.assists || 0
    if (p.includes('cs') || p.includes('creep')) return +g.creep_score || 0
    if (p.includes('gold')) return +g.gold_earned || 0
    if (p.includes('damage')) return +g.damage || 0
    if (p.includes('ward')) return +g.wards_placed || 0
    return null
  }

  if (league === 'CS2') {
    // per-match totals (counts). The caller divides by maps_played for per-map
    // pace, so only true counting stats belong here. ADR/rating/KAST are already
    // per-round rates and must not be scaled, so they are intentionally omitted.
    if (p.includes('kill') && !p.includes('first')) return +g.kills || 0
    if (p.includes('death')) return +g.deaths || 0
    if (p.includes('assist')) return +g.assists || 0
    if (p.includes('first kill') || p.includes('opening kill')) return +g.first_kills || 0
    // headshots: only a percentage is available, not a count, so we can't verify it
    return null
  }

  return null
}

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

// Honest last-N bar chart. Cleared games are green, missed are red, with an
// amber dashed marker at the prop line. Most recent game sits on the right.
function MiniChart({ real }) {
  const ordered = [...real.rows].reverse()
  const maxV = Math.max(real.line, ...ordered.map(r => r.value)) || 1
  const H = 42
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: '2px', height: `${H}px`, marginTop: '7px' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(real.line / maxV) * H}px`, borderTop: `1px dashed ${AMBER_MED}`, zIndex: 2 }} />
      {ordered.map((r, i) => {
        const h = Math.max(3, (r.value / maxV) * H)
        return (
          <div key={i} title={`${fmtDate(r.date)}: ${r.value}`} style={{
            flex: 1, height: `${h}px`, borderRadius: '2px 2px 0 0',
            background: r.cleared ? `linear-gradient(180deg,${GOOD},#1c8f5c)` : `linear-gradient(180deg,${BAD},#7d2530)`,
            boxShadow: r.cleared ? '0 0 6px rgba(61,221,143,0.4)' : 'none',
          }} />
        )
      })}
    </div>
  )
}

// Signature element: a stepped signal-strength meter standing in for a plain
// progress bar. Reads like a real measurement, not a marketing gauge.
function SignalMeter({ pct, color, segments = 12 }) {
  const filled = Math.round((pct / 100) * segments)
  return (
    <div style={{ display: 'flex', gap: '2px', height: '16px', alignItems: 'flex-end' }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${28 + (i / (segments - 1)) * 72}%`,
          borderRadius: '1px',
          background: i < filled ? color : 'rgba(255,255,255,0.09)',
          transition: 'background 0.5s ease',
        }} />
      ))}
    </div>
  )
}

const LEAGUE_COLORS = {
  'NBA':      { bg: 'rgba(225,114,16,0.15)',  color: '#e17210', border: 'rgba(225,114,16,0.3)' },
  'MLB':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'NHL':      { bg: 'rgba(255,255,255,0.08)', color: '#aab4cc', border: 'rgba(255,255,255,0.15)' },
  'NFL':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'WNBA':     { bg: 'rgba(227,165,72,0.14)',  color: '#E3A548', border: 'rgba(227,165,72,0.3)' },
  'CS2':      { bg: 'rgba(0,180,216,0.12)',   color: '#00b4d8', border: 'rgba(0,180,216,0.25)' },
  'LOL':      { bg: 'rgba(200,155,60,0.12)',  color: '#c89b3c', border: 'rgba(200,155,60,0.25)' },
  'VALORANT': { bg: 'rgba(255,70,85,0.12)',   color: '#ff4655', border: 'rgba(255,70,85,0.25)' },
  'COD':      { bg: 'rgba(0,230,118,0.12)',   color: '#00e676', border: 'rgba(0,230,118,0.25)' },
}

export default function PickCard({ pick, delay = 0, selected = false, onToggleParlay = null }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const t = tierOf(pick.conf)
  const up = pick.dir === 'HIGHER'
  const league = (pick.league || pick.sport || '').toUpperCase()
  const lc = LEAGUE_COLORS[league] || { bg: 'rgba(255,255,255,0.06)', color: INK_DIM, border: 'rgba(255,255,255,0.1)' }
  const isGold = t === 'gold'
  const hasRealData = REAL_DATA_LEAGUES.includes(league)

  // real game log (MLB / WNBA only)
  const [gamelog, setGamelog] = useState(null)
  const [glState, setGlState] = useState('idle') // idle | loading | done | empty | error

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), delay)
    const t2 = setTimeout(() => setBarWidth(pick.conf), delay + 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (!hasRealData || !pick.name) return
    let cancelled = false
    setGlState('loading')
    const timer = setTimeout(() => {
      fetch(`${SERVER}/player-gamelog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: pick.name, league })
      })
        .then(r => r.json())
        .then(d => {
          if (cancelled) return
          setGamelog(d)
          setGlState(d && d.games && d.games.length ? 'done' : 'empty')
        })
        .catch(() => { if (!cancelled) setGlState('error') })
    }, Math.min(delay, 500) + 40)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pick.name, league, hasRealData])

  const isEsport = league === 'LOL' || league === 'CS2'
  const mapCount = isEsport ? mapScope(pick.stat) : 1

  const gameVals = useMemo(() => {
    if (!gamelog || !gamelog.games || !gamelog.games.length) return null
    const arr = []
    for (const game of gamelog.games) {
      let v = bdlStatValue(league, game, pick.stat)
      if (v === null || v === undefined || isNaN(v)) continue
      if (league === 'CS2') {
        const maps = Number(game.maps_played) || 1
        v = v / maps
      }
      arr.push({ date: game.date, value: v })
    }
    return arr.length ? arr : null
  }, [gamelog, league, pick.stat])

  function rateFor(lineRaw) {
    if (!gameVals) return null
    const L = parseFloat(lineRaw)
    if (isNaN(L)) return null
    const rows = gameVals.map(gv => ({ date: gv.date, value: gv.value, cleared: up ? gv.value > L : gv.value < L }))
    const cleared = rows.filter(r => r.cleared).length
    return { rows, cleared, total: rows.length, line: L, pct: Math.round((cleared / rows.length) * 100) }
  }

  const effLine = isEsport ? (parseFloat(pick.val) / mapCount) : pick.val
  const real = useMemo(() => rateFor(effLine), [gameVals, effLine, up])

  const pctColor = real ? (real.pct >= 66 ? GOOD : real.pct >= 40 ? AMBER : BAD) : INK_DIM

  const borderColor = selected ? PULSE_BLUE : isGold ? AMBER_MED : t === 'high' ? 'rgba(61,221,143,0.3)' : LINE_SOFT
  const confColor = isGold ? AMBER : t === 'high' ? GOOD : INK_DIM
  const meterColor = isGold ? AMBER : t === 'high' ? GOOD : INK_FAINT

  return (
    <div style={{ position: 'relative', transform: 'translateZ(0)', willChange: 'transform', WebkitTransform: 'translateZ(0)' }}>
      <div style={{
        background: isGold ? PANEL_GOLD : PANEL,
        border: `1px solid ${borderColor}`,
        borderRadius: '14px',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 1,
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'translateY(0) translateZ(0)' : 'translateY(24px) translateZ(0)',
        WebkitTransform: revealed ? 'translateY(0) translateZ(0)' : 'translateY(24px) translateZ(0)',
        transition: isGold
          ? 'opacity 0.5s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)'
          : 'opacity 0.4s ease, transform 0.4s ease',
        boxShadow: selected
          ? `0 0 0 2px ${PULSE_BLUE}, 0 0 16px rgba(79,195,247,0.3)`
          : (revealed && isGold ? `0 0 0 1px ${AMBER_MED}, inset 0 -24px 36px -10px rgba(227,165,72,0.1)` : 'none'),
        animation: isGold && revealed ? 'signalAmbient 3s ease-in-out infinite' : 'none',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>

        <div style={{ height: '130px', background: IMG_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          {pick.image
            ? <img src={pick.image} alt={pick.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
            : <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: isGold ? 'linear-gradient(135deg,#241a05,#15100a)' : 'linear-gradient(135deg,#181c22,#0f1116)',
                border: isGold ? `2px solid ${AMBER_MED}` : '2px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONT_D, fontSize: '22px', fontWeight: 700,
                color: isGold ? AMBER : INK_DIM, letterSpacing: '1px'
              }}>{pick.initials}</div>
          }

          <div style={{
            position: 'absolute', top: '8px', right: '8px',
            fontFamily: FONT_M, fontSize: '10px', fontWeight: 600,
            letterSpacing: '1.5px', textTransform: 'uppercase',
            padding: '3px 9px', borderRadius: '5px',
            background: isGold ? AMBER : t === 'high' ? 'rgba(61,221,143,0.12)' : 'rgba(255,255,255,0.06)',
            color: isGold ? '#100b02' : t === 'high' ? GOOD : INK_FAINT,
            border: isGold ? `1px solid ${AMBER}` : t === 'high' ? '1px solid rgba(61,221,143,0.25)' : 'none',
          }}>{isGold ? '◆ GOLD' : t === 'high' ? 'HIGH' : 'PICK'}</div>

          <div style={{ position: 'absolute', bottom: '7px', left: '8px', fontFamily: FONT_D, fontSize: '8px', fontWeight: 600, letterSpacing: '1.5px', color: 'rgba(255,255,255,0.08)' }}>TRIP PREDICTS</div>

          <div style={{
            position: 'absolute', bottom: '6px', right: '8px',
            fontFamily: FONT_M, fontSize: '10px', fontWeight: 600,
            letterSpacing: '1px', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: '5px',
            background: lc.bg, color: lc.color, border: `1px solid ${lc.border}`
          }}>{league || pick.sport}</div>

          {hasRealData && (
            <div style={{
              position: 'absolute', top: '8px', left: '8px',
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontFamily: FONT_M, fontSize: '9px', fontWeight: 600,
              letterSpacing: '1px', textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: '5px',
              background: 'rgba(10,11,15,0.75)', color: AMBER,
              border: `1px solid ${AMBER_MED}`,
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: AMBER, display: 'inline-block', animation: 'pulseDot 1.8s ease-in-out infinite' }} />
              Verified
            </div>
          )}
        </div>

        <div style={{ padding: '12px 13px 10px' }}>
          <div style={{ fontFamily: FONT_D, fontSize: '15px', fontWeight: 700, color: INK, letterSpacing: '0.2px', lineHeight: 1.1 }}>{pick.name}</div>
          <div style={{ fontSize: '11px', color: INK_DIM, marginTop: '2px', fontFamily: FONT_B }}>{pick.meta}</div>

          {hasRealData ? (
            <div style={{ marginTop: '6px', marginBottom: '6px' }}>
              {real && real.total >= MIN_REAL_GAMES ? (
                <div style={{
                  border: `1px solid ${AMBER_MED}`,
                  background: `linear-gradient(135deg, ${AMBER_DIM}, rgba(15,13,8,0.6))`,
                  borderRadius: '10px', padding: '7px 9px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 600, letterSpacing: '1px', color: AMBER, fontFamily: FONT_M, textTransform: 'uppercase' }}>
                      Real Data{isEsport ? ' · per map' : ''}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: FONT_M, color: pctColor }}>
                      {real.cleared} of {real.total} {isEsport ? 'maps' : 'hit'} · {real.pct}%
                    </span>
                  </div>
                  <MiniChart real={real} />
                  <div style={{ fontSize: '8px', color: 'rgba(227,165,72,0.55)', marginTop: '5px', letterSpacing: '0.4px', fontFamily: FONT_B }}>
                    {isEsport
                      ? `Last ${real.total} maps · per-map pace vs ${pick.val}${mapCount > 1 ? ` (${mapCount} maps)` : ''} · BALLDONTLIE`
                      : `Last ${real.total} games vs ${pick.val} · verified by BALLDONTLIE`}
                  </div>
                </div>
              ) : glState === 'loading' ? (
                <div style={{ fontSize: '10px', color: AMBER, fontFamily: FONT_M, display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ fontSize: '10px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Loading real game data
                </div>
              ) : real ? (
                <div style={{ fontSize: '10px', color: INK_DIM, fontFamily: FONT_M, padding: '2px 0' }}>
                  Not enough game history yet ({real.total} of {MIN_REAL_GAMES} needed)
                </div>
              ) : (
                <div style={{ fontSize: '10px', color: INK_DIM, fontFamily: FONT_M, padding: '2px 0' }}>
                  No real game data for this stat yet
                </div>
              )}
            </div>
          ) : (
            pick.record && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                marginTop: '5px', marginBottom: '4px',
                background: 'rgba(61,221,143,0.08)', border: '1px solid rgba(61,221,143,0.2)',
                borderRadius: '8px', padding: '3px 8px'
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: GOOD, display: 'inline-block' }} />
                <span style={{ fontSize: '10px', color: GOOD, fontFamily: FONT_M, fontWeight: 600, letterSpacing: '0.3px' }}>{pick.record}</span>
              </div>
            )
          )}

          {(pick.time || pick.date) && (
            <div style={{ fontSize: '10px', color: isGold ? AMBER : INK_DIM, marginTop: '4px', marginBottom: '8px', fontFamily: FONT_M, fontWeight: 600, letterSpacing: '0.5px' }}>
              {pick.date ? `${pick.date} · ` : ''}{pick.time || ''}
            </div>
          )}
          {!pick.time && !pick.date && <div style={{ marginBottom: '8px' }} />}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', color: INK_DIM, fontFamily: FONT_B }}>{pick.stat}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                <div style={{ fontFamily: FONT_M, fontSize: '17px', fontWeight: 700, color: INK, lineHeight: 1 }}>{pick.val}</div>
              </div>
            </div>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', fontWeight: 700, flexShrink: 0,
              background: up ? 'rgba(61,221,143,0.15)' : 'rgba(242,85,95,0.15)',
              color: up ? GOOD : BAD,
              border: up ? '1px solid rgba(61,221,143,0.25)' : '1px solid rgba(242,85,95,0.25)',
            }}>{up ? '↑' : '↓'}</div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <span style={{ fontSize: '10px', color: INK_FAINT, textTransform: 'uppercase', letterSpacing: '1.5px', fontFamily: FONT_M }}>Signal</span>
              <span style={{ fontFamily: FONT_M, fontSize: '14px', fontWeight: 700, color: confColor }}>{pick.conf}%</span>
            </div>
            <SignalMeter pct={barWidth} color={meterColor} />
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {onToggleParlay && (
              <button
                onClick={() => onToggleParlay(pick)}
                style={{
                  flex: '0 0 40%', padding: '7px 0',
                  background: selected ? PULSE_BLUE : 'rgba(255,255,255,0.03)',
                  border: selected ? `1px solid ${PULSE_BLUE}` : '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '8px',
                  color: selected ? '#04101f' : INK_DIM,
                  fontFamily: FONT_M, fontSize: '11px', fontWeight: 700,
                  letterSpacing: '0.5px', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >{selected ? '✓ Parlay' : '+ Parlay'}</button>
            )}
            <button
              onClick={() => setInfoOpen(prev => !prev)}
              style={{
                flex: 1, padding: '7px 0',
                background: isGold ? AMBER_DIM : 'rgba(255,255,255,0.03)',
                border: isGold ? `1px solid ${AMBER_MED}` : '1px solid rgba(255,255,255,0.07)',
                borderRadius: '8px',
                color: isGold ? AMBER : INK_FAINT,
                fontFamily: FONT_M, fontSize: '11px', fontWeight: 500,
                letterSpacing: '0.5px', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >{infoOpen ? 'Hide Info ▴' : 'View Info ▾'}</button>
          </div>
        </div>

        <div style={{ maxHeight: infoOpen ? '640px' : '0px', overflow: 'hidden', transition: 'max-height 0.35s ease' }}>
          <div style={{ padding: '12px 13px', borderTop: `1px solid ${isGold ? AMBER_DIM : 'rgba(255,255,255,0.06)'}`, background: isGold ? '#14100a' : '#0d0f13' }}>

            {hasRealData && real && real.total >= MIN_REAL_GAMES && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '9px', color: AMBER, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: FONT_M, fontWeight: 600 }}>
                  Recent {isEsport ? 'maps' : 'games'} · {real.cleared}/{real.total} cleared {isEsport ? `${(parseFloat(pick.val) / mapCount).toFixed(1)}/map` : pick.val}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {[...real.rows].reverse().map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      minWidth: '34px', padding: '4px 2px', borderRadius: '6px',
                      background: r.cleared ? 'rgba(61,221,143,0.1)' : 'rgba(242,85,95,0.1)',
                      border: `1px solid ${r.cleared ? 'rgba(61,221,143,0.25)' : 'rgba(242,85,95,0.25)'}`,
                    }}>
                      <span style={{ fontSize: '8px', color: INK_DIM, fontFamily: FONT_M }}>{fmtDate(r.date)}</span>
                      <span style={{ fontFamily: FONT_M, fontSize: '13px', fontWeight: 700, color: r.cleared ? GOOD : BAD }}>{Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</span>
                      <span style={{ fontSize: '8px', color: r.cleared ? GOOD : BAD }}>{r.cleared ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(227,165,72,0.65)' : INK_FAINT, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: FONT_M, fontWeight: 600 }}>Why it's strong</div>
              <div style={{ fontSize: '12px', color: INK_DIM, lineHeight: 1.55, fontFamily: FONT_B }}>{pick.bull}</div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(227,165,72,0.65)' : INK_FAINT, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: FONT_M, fontWeight: 600 }}>Risk factor</div>
              <div style={{ fontSize: '12px', color: INK_DIM, lineHeight: 1.55, fontFamily: FONT_B }}>{pick.bear}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(227,165,72,0.65)' : INK_FAINT, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: FONT_M, fontWeight: 600 }}>Stat category breakdown</div>
              {pick.cats && pick.cats.map((c, i) => {
                const cc = c.p >= 90 ? AMBER : c.p >= 75 ? GOOD : INK_DIM
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <span style={{ fontSize: '11px', color: INK_DIM, fontFamily: FONT_B }}>{c.n}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: FONT_M, color: cc }}>{c.p}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        @keyframes signalAmbient {
          0%,100% { box-shadow: 0 0 0 1px rgba(227,165,72,0.4), 0 0 14px rgba(227,165,72,0.12); }
          50%      { box-shadow: 0 0 0 1px rgba(227,165,72,0.55), 0 0 22px rgba(227,165,72,0.2); }
        }
        @keyframes pulseDot {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}