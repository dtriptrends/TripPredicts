import React, { useState, useEffect } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

function tierOf(c) { return c >= 90 ? 'gold' : c >= 75 ? 'high' : 'regular' }

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

// session cache so re-clicking a player is instant
const statsCache = {}

export default function PickCard({ pick, delay = 0 }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsData, setStatsData] = useState(null)
  const [statsError, setStatsError] = useState(null)
  const t = tierOf(pick.conf)
  const up = pick.dir === 'HIGHER'
  const league = (pick.league || pick.sport || '').toUpperCase()
  const lc = LEAGUE_COLORS[league] || { bg: 'rgba(255,255,255,0.06)', color: '#7a8aaa', border: 'rgba(255,255,255,0.1)' }
  const isGold = t === 'gold'

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), delay)
    const t2 = setTimeout(() => setBarWidth(pick.conf), delay + 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const borderColor = isGold ? '#b84000' : t === 'high' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'
  const confColor = isGold ? '#f5c842' : t === 'high' ? '#10b981' : '#7a8aaa'
  const fillBg = isGold ? 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)' : t === 'high' ? '#10b981' : '#3a4a6a'

  const cacheKey = `${pick.name}|${pick.stat}|${league}`

  async function openStats() {
    setStatsOpen(true)
    if (statsCache[cacheKey]) { setStatsData(statsCache[cacheKey]); return }
    setStatsLoading(true)
    setStatsError(null)
    try {
      const res = await fetch(`${SERVER}/player-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: pick.name, stat: pick.stat, league })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      statsCache[cacheKey] = data
      setStatsData(data)
    } catch (e) {
      setStatsError('Could not load recent games right now. Try again in a moment.')
    }
    setStatsLoading(false)
  }

  const lineNum = Number(pick.val)
  const games = statsData?.games || []
  const maxVal = games.length ? Math.max(...games.map(g => Number(g.value) || 0), lineNum) : lineNum
  const clearedCount = games.filter(g => up ? Number(g.value) > lineNum : Number(g.value) < lineNum).length

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

          {isGold && revealed && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '45%', height: '100%', background: 'linear-gradient(105deg,transparent,rgba(255,140,40,0.07),transparent)', animation: 'shimmerMove 2.5s 0.8s ease infinite' }} />
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '12px 13px 10px' }}>
          {/* Clickable player name → recent games */}
          <div
            onClick={openStats}
            style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '15px', fontWeight: 700, color: '#eef2ff', letterSpacing: '0.5px', lineHeight: 1.1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', WebkitTapHighlightColor: 'transparent' }}
          >
            {pick.name}
            <span style={{ fontSize: '10px', color: isGold ? '#ff9944' : '#4a90d9' }}>📊</span>
          </div>
          <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '2px' }}>{pick.meta}</div>

          <div
            onClick={openStats}
            style={{ fontSize: '10px', color: isGold ? '#ff9944' : '#4a90d9', marginTop: '4px', cursor: 'pointer', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.3px' }}
          >
            ▸ View recent games
          </div>

          {(pick.time || pick.date) && (
            <div style={{ fontSize: '10px', color: isGold ? '#ff9944' : '#f5c842', marginTop: '6px', marginBottom: '8px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.5px' }}>
              🕐 {pick.date ? `${pick.date} · ` : ''}{pick.time || ''}
            </div>
          )}
          {!pick.time && !pick.date && <div style={{ marginBottom: '8px' }} />}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#7a8aaa' }}>{pick.stat}</div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '17px', fontWeight: 700, color: '#eef2ff', lineHeight: 1 }}>{pick.val}</div>
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

        {/* Info section */}
        <div style={{
          maxHeight: infoOpen ? '400px' : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.35s ease',
        }}>
          <div style={{ padding: '12px 13px', borderTop: `1px solid ${isGold ? 'rgba(255,60,0,0.12)' : 'rgba(255,255,255,0.06)'}`, background: isGold ? '#130800' : '#0c1018' }}>
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

      {/* Recent games modal */}
      {statsOpen && (
        <div
          onClick={() => setStatsOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(3px)' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'linear-gradient(180deg,#0d1219,#0a0f1a)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '18px', width: '100%', maxWidth: '420px', maxHeight: '80vh', overflowY: 'auto', padding: '20px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '22px', letterSpacing: '1px', color: '#eef2ff' }}>{pick.name}</div>
              <div onClick={() => setStatsOpen(false)} style={{ fontSize: '20px', color: '#7a8aaa', cursor: 'pointer', lineHeight: 1 }}>×</div>
            </div>
            <div style={{ fontSize: '12px', color: '#7a8aaa', marginBottom: '16px' }}>Recent games · {pick.stat} · line {pick.val} {up ? '(higher)' : '(lower)'}</div>

            {statsLoading && (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginBottom: '14px' }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4a90d9', animation: `dotP 1.3s ${i*0.2}s infinite` }} />)}
                </div>
                <div style={{ fontSize: '13px', color: '#7a8aaa' }}>Pulling recent games from the web...</div>
                <div style={{ fontSize: '11px', color: '#3a4a6a', marginTop: '6px' }}>This can take a few seconds</div>
              </div>
            )}

            {statsError && <div style={{ padding: '30px 0', textAlign: 'center', fontSize: '13px', color: '#7a8aaa' }}>{statsError}</div>}

            {!statsLoading && !statsError && statsData && games.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '8px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px' }}>
                  <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '20px', color: '#10b981' }}>{clearedCount}/{games.length}</span>
                  <span style={{ fontSize: '12px', color: '#7a8aaa' }}>recent games {up ? 'cleared' : 'stayed under'} {pick.val}</span>
                </div>

                {/* Mini bar chart */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '90px', marginBottom: '16px', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {/* line marker */}
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(lineNum / maxVal) * 100}%`, height: '1px', background: 'rgba(245,200,66,0.6)', zIndex: 2 }}>
                    <span style={{ position: 'absolute', right: 0, top: '-14px', fontSize: '9px', color: '#f5c842' }}>line {pick.val}</span>
                  </div>
                  {games.slice(0, 12).map((g, i) => {
                    const v = Number(g.value) || 0
                    const cleared = up ? v > lineNum : v < lineNum
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ fontSize: '8px', color: '#7a8aaa', marginBottom: '2px' }}>{v}</div>
                        <div style={{ width: '100%', height: `${(v / maxVal) * 100}%`, background: cleared ? '#10b981' : '#ef4444', borderRadius: '2px 2px 0 0', minHeight: '2px' }} />
                      </div>
                    )
                  })}
                </div>

                {/* Game list */}
                <div>
                  {games.map((g, i) => {
                    const v = Number(g.value) || 0
                    const cleared = up ? v > lineNum : v < lineNum
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: '12px', color: '#aab4cc' }}>{g.opponent || g.date || `Game ${i+1}`}</span>
                        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '14px', fontWeight: 700, color: cleared ? '#10b981' : '#ef4444' }}>{v}</span>
                      </div>
                    )
                  })}
                </div>

                <div style={{ fontSize: '10px', color: '#3a4a6a', marginTop: '14px', lineHeight: 1.5, textAlign: 'center' }}>
                  {statsData.note || 'Pulled from live web search. May not include every game.'}
                </div>
              </>
            )}

            {!statsLoading && !statsError && statsData && games.length === 0 && (
              <div style={{ padding: '30px 0', textAlign: 'center', fontSize: '13px', color: '#7a8aaa' }}>
                {statsData.note || 'No recent games found for this player.'}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes outerFireGlow {
          0%,100% { box-shadow: 0 0 18px 4px rgba(255,50,0,0.25), 0 0 40px 8px rgba(255,90,0,0.12); }
          33%      { box-shadow: 0 0 24px 6px rgba(255,90,0,0.35), 0 0 55px 12px rgba(255,140,0,0.18); }
          66%      { box-shadow: 0 0 20px 5px rgba(255,140,0,0.3), 0 0 48px 10px rgba(245,190,50,0.15); }
        }
        @keyframes shimmerMove { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        @keyframes dotP { 0%,80%,100% { opacity:0.2; transform:scale(1); } 40% { opacity:1; transform:scale(1.2); } }
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