import React, { useState, useEffect, useMemo } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

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

function tierOf(c) { return c >= 90 ? 'gold' : c >= 75 ? 'high' : 'regular' }

// Map a PrizePicks prop label to the real stat value for one game row.
// Combos (PRA, H+R+RBI, etc.) are computed from base fields. Returns null when
// we cannot map the stat, so the UI hides the hit-rate instead of guessing.
function bdlStatValue(league, g, propLabel) {
  const p = String(propLabel || '').toLowerCase()
  if (p.includes('fantasy')) return null // weighted formula we can't verify; skip, don't fake

  if (league === 'WNBA') {
    const pts = +g.pts || 0, reb = +g.reb || 0, ast = +g.ast || 0
    const stl = +g.stl || 0, blk = +g.blk || 0
    const oreb = +g.oreb || 0, dreb = +g.dreb || 0
    const fg3m = +g.fg3m || 0, fg3a = +g.fg3a || 0
    const fgm = +g.fgm || 0, fga = +g.fga || 0
    const ftm = +g.ftm || 0, fta = +g.fta || 0
    const tov = +g.turnover || 0, pf = +g.pf || 0
    const isAtt = p.includes('attempt')
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
    if (p.includes('free throw')) return isAtt ? fta : ftm
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

// Honest last-N bar chart. Cleared games are green, missed are red, with a
// dashed marker at the prop line. Most recent game sits on the right.
function MiniChart({ real }) {
  const ordered = [...real.rows].reverse()
  const maxV = Math.max(real.line, ...ordered.map(r => r.value)) || 1
  const H = 42
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: '2px', height: `${H}px`, marginTop: '7px' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(real.line / maxV) * H}px`, borderTop: '1px dashed rgba(245,200,66,0.65)', zIndex: 2 }} />
      {ordered.map((r, i) => {
        const h = Math.max(3, (r.value / maxV) * H)
        return (
          <div key={i} title={`${fmtDate(r.date)}: ${r.value}`} style={{
            flex: 1, height: `${h}px`, borderRadius: '2px 2px 0 0',
            background: r.cleared ? 'linear-gradient(180deg,#15d68f,#0a7d5a)' : 'linear-gradient(180deg,#ef4444,#7d2a2a)',
            boxShadow: r.cleared ? '0 0 6px rgba(21,214,143,0.45)' : 'none',
          }} />
        )
      })}
    </div>
  )
}

// Green goblin (safer, lower line) or red demon (harder, higher line) flag.
// Only rendered when real game data says the alternate line is worth it.
function VariantChip({ variant }) {
  const demon = variant.type === 'demon'
  return (
    <span
      title={demon
        ? `Demon line ${variant.line} still cleared in ${variant.pct}% of recent games — bigger payout`
        : `Goblin line ${variant.line} cleared in ${variant.pct}% of recent games — safer play`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        fontFamily: "'Barlow Condensed',sans-serif", fontSize: '9px', fontWeight: 700,
        letterSpacing: '0.5px', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: '7px', whiteSpace: 'nowrap',
        background: demon ? 'rgba(239,68,68,0.16)' : 'rgba(21,214,143,0.16)',
        color: demon ? '#ff6b6b' : '#15d68f',
        border: `1px solid ${demon ? 'rgba(239,68,68,0.4)' : 'rgba(21,214,143,0.4)'}`,
      }}
    >
      <span style={{ fontSize: '10px' }}>{demon ? '👹' : '👺'}</span>
      {demon ? 'Demon' : 'Goblin'} {variant.line} · {variant.pct}%
    </span>
  )
}

const LEAGUE_COLORS = {
  'NBA':      { bg: 'rgba(225,114,16,0.15)',  color: '#e17210', border: 'rgba(225,114,16,0.3)' },
  'MLB':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'NHL':      { bg: 'rgba(255,255,255,0.08)', color: '#aab4cc', border: 'rgba(255,255,255,0.15)' },
  'NFL':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'WNBA':     { bg: 'rgba(255,105,0,0.12)',   color: '#ff6900', border: 'rgba(255,105,0,0.25)' },
  'CS2':      { bg: 'rgba(0,180,216,0.12)',   color: '#00b4d8', border: 'rgba(0,180,216,0.25)' },
  'LOL':      { bg: 'rgba(200,155,60,0.12)',  color: '#c89b3c', border: 'rgba(200,155,60,0.25)' },
  'VALORANT': { bg: 'rgba(255,70,85,0.12)',   color: '#ff4655', border: 'rgba(255,70,85,0.25)' },
  'COD':      { bg: 'rgba(0,230,118,0.12)',   color: '#00e676', border: 'rgba(0,230,118,0.25)' },
}

const BOTTOM_FLAMES = [
  { left: '3%',  w: 14, h: 36, dur: '0.55s', delay: '0.00s', type: 0 },
  { left: '12%', w: 20, h: 52, dur: '0.80s', delay: '0.09s', type: 1 },
  { left: '23%', w: 12, h: 28, dur: '0.48s', delay: '0.04s', type: 2 },
  { left: '33%', w: 22, h: 58, dur: '0.72s', delay: '0.16s', type: 0 },
  { left: '44%', w: 16, h: 42, dur: '0.60s', delay: '0.07s', type: 1 },
  { left: '55%', w: 24, h: 60, dur: '0.88s', delay: '0.13s', type: 2 },
  { left: '66%', w: 14, h: 32, dur: '0.62s', delay: '0.03s', type: 0 },
  { left: '76%', w: 20, h: 46, dur: '0.76s', delay: '0.11s', type: 1 },
  { left: '86%', w: 16, h: 38, dur: '0.50s', delay: '0.06s', type: 2 },
  { left: '93%', w: 12, h: 26, dur: '0.65s', delay: '0.14s', type: 0 },
]

const LEFT_FLAMES = [
  { bottom: '20%', w: 12, h: 30, dur: '0.58s', delay: '0.05s', type: 1 },
  { bottom: '45%', w: 10, h: 24, dur: '0.70s', delay: '0.12s', type: 2 },
  { bottom: '65%', w: 8,  h: 18, dur: '0.52s', delay: '0.08s', type: 0 },
]

const RIGHT_FLAMES = [
  { bottom: '15%', w: 11, h: 28, dur: '0.62s', delay: '0.10s', type: 2 },
  { bottom: '40%', w: 9,  h: 22, dur: '0.75s', delay: '0.04s', type: 0 },
  { bottom: '60%', w: 8,  h: 16, dur: '0.55s', delay: '0.15s', type: 1 },
]

const FLAME_GRADIENTS = [
  'radial-gradient(ellipse at bottom, rgba(255,20,0,0.95), rgba(255,80,0,0.55) 40%, transparent 80%)',
  'radial-gradient(ellipse at bottom, rgba(255,80,0,0.9),  rgba(255,150,0,0.45) 42%, transparent 80%)',
  'radial-gradient(ellipse at bottom, rgba(255,140,0,0.85),rgba(255,210,50,0.35) 45%, transparent 80%)',
]

export default function PickCard({ pick, delay = 0 }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const t = tierOf(pick.conf)
  const up = pick.dir === 'HIGHER'
  const league = (pick.league || pick.sport || '').toUpperCase()
  const lc = LEAGUE_COLORS[league] || { bg: 'rgba(255,255,255,0.06)', color: '#7a8aaa', border: 'rgba(255,255,255,0.1)' }
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

  // per-game stat values, computed once from the real game log. For esports we
  // reduce to a per-MAP value: LoL rows are already per map; CS2 rows are match
  // totals, so we divide by the maps played in that match.
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

  // hit-rate of clearing a line in the pick's direction
  function rateFor(lineRaw) {
    if (!gameVals) return null
    const L = parseFloat(lineRaw)
    if (isNaN(L)) return null
    const rows = gameVals.map(gv => ({ date: gv.date, value: gv.value, cleared: up ? gv.value > L : gv.value < L }))
    const cleared = rows.filter(r => r.cleared).length
    return { rows, cleared, total: rows.length, line: L, pct: Math.round((cleared / rows.length) * 100) }
  }

  // For esports the prop line covers mapCount maps, so the per-map target is
  // line / mapCount. Ball sports compare against the line directly.
  const effLine = isEsport ? (parseFloat(pick.val) / mapCount) : pick.val
  const real = useMemo(() => rateFor(effLine), [gameVals, effLine, up])

  // Flag the goblin (safer/lower) or demon (harder/higher) line, but only when
  // the real data earns it: goblin near-automatic, or demon still live.
  const GOBLIN_LOCK = 80, DEMON_LIVE = 50
  const variant = useMemo(() => {
    if (!real || real.total < MIN_REAL_GAMES || !pick.altLines || isEsport) return null
    const dL = pick.altLines.demon, gL = pick.altLines.goblin
    if (dL != null && dL !== real.line) {
      const dr = rateFor(dL)
      if (dr && dr.pct >= DEMON_LIVE) return { type: 'demon', line: dL, pct: dr.pct }
    }
    if (gL != null && gL !== real.line) {
      const gr = rateFor(gL)
      if (gr && gr.pct >= GOBLIN_LOCK) return { type: 'goblin', line: gL, pct: gr.pct }
    }
    return null
  }, [real, pick.altLines, gameVals, up])

  const pctColor = real ? (real.pct >= 66 ? '#15d68f' : real.pct >= 40 ? '#f5c842' : '#ef4444') : '#7a8aaa'

  const borderColor = isGold ? '#b84000' : t === 'high' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'
  const confColor = isGold ? '#f5c842' : t === 'high' ? '#10b981' : '#7a8aaa'
  const fillBg = isGold ? 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)' : t === 'high' ? '#10b981' : '#3a4a6a'

  return (
    <div style={{
      position: 'relative',
      paddingBottom: isGold ? '20px' : '0',
      marginBottom: isGold ? '8px' : '0',
      transform: 'translateZ(0)',
      willChange: 'transform',
      WebkitTransform: 'translateZ(0)',
    }}>

      {/* Outside fire — only for gold */}
      {isGold && revealed && (
        <>
          <div style={{ position: 'absolute', bottom: 0, left: '-4px', right: '-4px', height: '80px', pointerEvents: 'none', zIndex: 10 }}>
            {BOTTOM_FLAMES.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', bottom: 0, left: fc.left,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(4px)',
                animation: `flicker${fc.type} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
            <div style={{ position: 'absolute', bottom: 0, left: '3%', right: '3%', height: '22px', background: 'radial-gradient(ellipse at bottom, rgba(255,50,0,0.6), rgba(255,100,0,0.25) 55%, transparent 80%)', filter: 'blur(8px)' }} />
          </div>

          <div style={{ position: 'absolute', top: 0, bottom: '20px', left: '-18px', width: '28px', pointerEvents: 'none', zIndex: 10 }}>
            {LEFT_FLAMES.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', left: '4px', bottom: fc.bottom,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(4px)',
                transform: 'rotate(-90deg)',
                animation: `flickerSide${i % 2} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
          </div>

          <div style={{ position: 'absolute', top: 0, bottom: '20px', right: '-18px', width: '28px', pointerEvents: 'none', zIndex: 10 }}>
            {RIGHT_FLAMES.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', right: '4px', bottom: fc.bottom,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(4px)',
                transform: 'rotate(90deg)',
                animation: `flickerSide${(i + 1) % 2} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
          </div>

          <div style={{ position: 'absolute', inset: '-2px', bottom: '18px', borderRadius: '18px', pointerEvents: 'none', zIndex: 0, animation: 'outerFireGlow 2s ease infinite' }} />
        </>
      )}

      {/* Card */}
      <div style={{
        background: isGold ? 'linear-gradient(180deg,#0d1219 60%,#190700 100%)' : 'rgba(13,18,28,0.92)',
        border: `1px solid ${borderColor}`,
        borderRadius: '16px',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 1,
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'translateY(0) translateZ(0)' : 'translateY(24px) translateZ(0)',
        WebkitTransform: revealed ? 'translateY(0) translateZ(0)' : 'translateY(24px) translateZ(0)',
        transition: isGold
          ? 'opacity 0.5s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)'
          : 'opacity 0.4s ease, transform 0.4s ease',
        boxShadow: revealed && isGold ? '0 0 0 1px rgba(180,40,0,0.5), inset 0 -30px 40px -10px rgba(180,30,0,0.2)' : 'none',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>

        {/* Image area */}
        <div style={{ height: '130px', background: '#0d1118', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          {pick.image
            ? <img src={pick.image} alt={pick.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
            : <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: isGold ? 'linear-gradient(135deg,#2a1000,#180800)' : 'linear-gradient(135deg,#141c2a,#0c1018)',
                border: isGold ? '2px solid rgba(255,100,0,0.3)' : '2px solid rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Bebas Neue',sans-serif", fontSize: '24px',
                color: isGold ? '#f5a030' : '#7a8aaa', letterSpacing: '1px'
              }}>{pick.initials}</div>
          }

          <div style={{
            position: 'absolute', top: '8px', right: '8px',
            fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
            letterSpacing: '1.5px', textTransform: 'uppercase',
            padding: '3px 9px', borderRadius: '10px',
            background: isGold ? 'linear-gradient(90deg,#b83000,#e87000)' : t === 'high' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.07)',
            color: isGold ? '#fff' : t === 'high' ? '#10b981' : '#3a4a6a',
            border: isGold ? '1px solid rgba(255,100,0,0.45)' : t === 'high' ? '1px solid rgba(16,185,129,0.25)' : 'none',
            boxShadow: isGold ? '0 0 8px rgba(255,80,0,0.4)' : 'none'
          }}>{isGold ? '🔥 GOLD' : t === 'high' ? 'HIGH' : 'PICK'}</div>

          <div style={{ position: 'absolute', bottom: '7px', left: '8px', fontFamily: "'Bebas Neue',sans-serif", fontSize: '8px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.07)' }}>TRIP PREDICTS</div>

          <div style={{
            position: 'absolute', bottom: '6px', right: '8px',
            fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
            letterSpacing: '1px', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: '6px',
            background: lc.bg, color: lc.color, border: `1px solid ${lc.border}`
          }}>{league || pick.sport}</div>

          {/* Real-data flag on the image, for MLB / WNBA */}
          {hasRealData && (
            <div style={{
              position: 'absolute', top: '8px', left: '8px',
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              fontFamily: "'Barlow Condensed',sans-serif", fontSize: '9px', fontWeight: 700,
              letterSpacing: '1px', textTransform: 'uppercase',
              padding: '3px 7px', borderRadius: '10px',
              background: 'linear-gradient(90deg,#c2360a,#ff6a00)', color: '#fff',
              border: '1px solid rgba(255,140,40,0.55)',
              animation: 'realGlow 2.4s ease-in-out infinite',
            }}>🔥 Real</div>
          )}

          {isGold && revealed && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '45%', height: '100%', background: 'linear-gradient(105deg,transparent,rgba(255,140,40,0.07),transparent)', animation: 'shimmerMove 2.5s 0.8s ease infinite' }} />
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '12px 13px 10px' }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '15px', fontWeight: 700, color: '#eef2ff', letterSpacing: '0.5px', lineHeight: 1.1 }}>{pick.name}</div>
          <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '2px' }}>{pick.meta}</div>

          {/* Real data panel (MLB / WNBA) replaces the AI record badge */}
          {hasRealData ? (
            <div style={{ marginTop: '6px', marginBottom: '6px' }}>
              {real && real.total >= MIN_REAL_GAMES ? (
                <div style={{
                  border: '1px solid rgba(255,90,20,0.4)',
                  background: 'linear-gradient(135deg, rgba(255,70,0,0.13), rgba(30,12,6,0.55))',
                  borderRadius: '10px', padding: '7px 9px',
                  animation: 'realGlow 2.4s ease-in-out infinite',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', color: '#ff8a4c', fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase' }}>
                      <span style={{ fontSize: '10px' }}>🔥</span> Real Data{isEsport ? ' · per map' : ''}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", color: pctColor }}>
                      {real.cleared} of {real.total} {isEsport ? 'maps' : 'hit'} · {real.pct}%
                    </span>
                  </div>
                  <MiniChart real={real} />
                  <div style={{ fontSize: '8px', color: 'rgba(255,170,130,0.6)', marginTop: '5px', letterSpacing: '0.4px' }}>
                    {isEsport
                      ? `Last ${real.total} maps · per-map pace vs ${pick.val}${mapCount > 1 ? ` (${mapCount} maps)` : ''} · BALLDONTLIE`
                      : `Last ${real.total} games vs ${pick.val} · verified by BALLDONTLIE`}
                  </div>
                </div>
              ) : glState === 'loading' ? (
                <div style={{ fontSize: '10px', color: '#ff8a4c', fontFamily: "'Barlow Condensed',sans-serif", display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ fontSize: '10px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Loading real game data
                </div>
              ) : real ? (
                <div style={{ fontSize: '10px', color: '#7a8aaa', fontFamily: "'Barlow Condensed',sans-serif", padding: '2px 0' }}>
                  Not enough game history yet ({real.total} of {MIN_REAL_GAMES} needed)
                </div>
              ) : (
                <div style={{ fontSize: '10px', color: '#7a8aaa', fontFamily: "'Barlow Condensed',sans-serif", padding: '2px 0' }}>
                  No real game data for this stat yet
                </div>
              )}
            </div>
          ) : (
            pick.record && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                marginTop: '5px', marginBottom: '4px',
                background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: '8px', padding: '3px 8px'
              }}>
                <span style={{ fontSize: '10px' }}>📊</span>
                <span style={{ fontSize: '10px', color: '#10b981', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.3px' }}>{pick.record}</span>
              </div>
            )
          )}

          {(pick.time || pick.date) && (
            <div style={{ fontSize: '10px', color: isGold ? '#ff9944' : '#f5c842', marginTop: '4px', marginBottom: '8px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.5px' }}>
              🕐 {pick.date ? `${pick.date} · ` : ''}{pick.time || ''}
            </div>
          )}
          {!pick.time && !pick.date && <div style={{ marginBottom: '8px' }} />}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#7a8aaa' }}>{pick.stat}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '17px', fontWeight: 700, color: '#eef2ff', lineHeight: 1 }}>{pick.val}</div>
                {variant && <VariantChip variant={variant} />}
              </div>
            </div>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', fontWeight: 700, flexShrink: 0,
              background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: up ? '#10b981' : '#ef4444',
              border: up ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)',
            }}>{up ? '↑' : '↓'}</div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <span style={{ fontSize: '10px', color: '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1px' }}>Confidence</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '14px', fontWeight: 700, color: confColor }}>{pick.conf}%</span>
            </div>
            <div style={{ height: '4px', background: '#0d1118', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '2px', background: fillBg, width: `${barWidth}%`, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
          </div>

          {/* Toggle button — WebkitTapHighlightColor prevents mobile ghost tap */}
          <button
            onClick={() => setInfoOpen(prev => !prev)}
            style={{
              width: '100%', padding: '7px 0',
              background: isGold ? 'rgba(255,60,0,0.05)' : 'rgba(255,255,255,0.03)',
              border: isGold ? '1px solid rgba(255,60,0,0.15)' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px',
              color: isGold ? 'rgba(255,130,0,0.75)' : '#3a4a6a',
              fontFamily: "'Barlow',sans-serif", fontSize: '11px', fontWeight: 500,
              letterSpacing: '0.5px', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >{infoOpen ? 'Hide Info ▴' : 'View Info ▾'}</button>
        </div>

        {/* Info section — maxHeight transition instead of conditional render = no mobile freeze */}
        <div style={{
          maxHeight: infoOpen ? '640px' : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.35s ease',
        }}>
          <div style={{ padding: '12px 13px', borderTop: `1px solid ${isGold ? 'rgba(255,60,0,0.12)' : 'rgba(255,255,255,0.06)'}`, background: isGold ? '#130800' : '#0c1018' }}>

            {/* Real recent games (MLB / WNBA) */}
            {hasRealData && real && real.total >= MIN_REAL_GAMES && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '9px', color: '#ff8a4c', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>
                  🔥 Recent {isEsport ? 'maps' : 'games'} · {real.cleared}/{real.total} cleared {isEsport ? `${(parseFloat(pick.val) / mapCount).toFixed(1)}/map` : pick.val}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {[...real.rows].reverse().map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                      minWidth: '34px', padding: '4px 2px', borderRadius: '6px',
                      background: r.cleared ? 'rgba(21,214,143,0.1)' : 'rgba(239,68,68,0.1)',
                      border: `1px solid ${r.cleared ? 'rgba(21,214,143,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    }}>
                      <span style={{ fontSize: '8px', color: '#7a8aaa' }}>{fmtDate(r.date)}</span>
                      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '13px', fontWeight: 700, color: r.cleared ? '#15d68f' : '#ef4444' }}>{Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</span>
                      <span style={{ fontSize: '8px', color: r.cleared ? '#15d68f' : '#ef4444' }}>{r.cleared ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(255,110,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Why it's strong</div>
              <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bull}</div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(255,110,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Risk factor</div>
              <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bear}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: isGold ? 'rgba(255,110,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Stat category breakdown</div>
              {pick.cats && pick.cats.map((c, i) => {
                const cc = c.p >= 90 ? '#f5c842' : c.p >= 75 ? '#10b981' : '#7a8aaa'
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <span style={{ fontSize: '11px', color: '#7a8aaa' }}>{c.n}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", color: cc }}>{c.p}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes outerFireGlow {
          0%,100% { box-shadow: 0 0 18px 4px rgba(255,50,0,0.25), 0 0 40px 8px rgba(255,90,0,0.12); }
          33%      { box-shadow: 0 0 24px 6px rgba(255,90,0,0.35), 0 0 55px 12px rgba(255,140,0,0.18); }
          66%      { box-shadow: 0 0 20px 5px rgba(255,140,0,0.3), 0 0 48px 10px rgba(245,190,50,0.15); }
        }
        @keyframes realGlow {
          0%,100% { box-shadow: 0 0 8px rgba(255,70,0,0.25), inset 0 0 12px rgba(255,90,0,0.06); }
          50%      { box-shadow: 0 0 16px rgba(255,90,0,0.45), inset 0 0 16px rgba(255,120,0,0.1); }
        }
        @keyframes shimmerMove {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes flicker0 {
          from { transform: scaleX(1)    translateY(2px)   rotate(-4deg); opacity: 0.92; }
          to   { transform: scaleX(0.5)  translateY(-18px) rotate(5deg);  opacity: 0.05; }
        }
        @keyframes flicker1 {
          from { transform: scaleX(0.85) translateY(0px)   rotate(3deg);  opacity: 1; }
          to   { transform: scaleX(1.3)  translateY(-22px) rotate(-6deg); opacity: 0.06; }
        }
        @keyframes flicker2 {
          from { transform: scaleX(1.2)  translateY(1px)   rotate(-2deg); opacity: 0.88; }
          to   { transform: scaleX(0.6)  translateY(-14px) rotate(7deg);  opacity: 0.04; }
        }
        @keyframes flickerSide0 {
          from { transform: rotate(-90deg) scaleX(1)   translateY(1px);   opacity: 0.8; }
          to   { transform: rotate(-90deg) scaleX(0.5) translateY(-14px); opacity: 0.04; }
        }
        @keyframes flickerSide1 {
          from { transform: rotate(90deg) scaleX(0.9)  translateY(0px);   opacity: 0.85; }
          to   { transform: rotate(90deg) scaleX(1.2)  translateY(-16px); opacity: 0.05; }
        }
      `}</style>
    </div>
  )
}