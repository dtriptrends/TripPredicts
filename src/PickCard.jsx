import React, { useState, useEffect } from 'react'

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

export default function PickCard({ pick, delay = 0 }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
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

  return (
    <div style={{ position: 'relative', paddingBottom: isGold ? '18px' : '0', marginBottom: isGold ? '8px' : '0' }}>

      {/* ── OUTSIDE FIRE ── only renders for gold, sits outside the card */}
      {isGold && revealed && (
        <>
          {/* Bottom flames rising from below the card */}
          <div style={{
            position: 'absolute', bottom: 0, left: '-4px', right: '-4px',
            height: '80px', pointerEvents: 'none', zIndex: 10
          }}>
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
            <div style={{
              position: 'absolute', bottom: 0, left: '3%', right: '3%', height: '22px',
              background: 'radial-gradient(ellipse at bottom, rgba(255,50,0,0.6), rgba(255,100,0,0.25) 55%, transparent 80%)',
              filter: 'blur(8px)'
            }} />
          </div>

          {/* Left side flames */}
          <div style={{
            position: 'absolute', top: 0, bottom: '18px', left: '-18px',
            width: '28px', pointerEvents: 'none', zIndex: 10
          }}>
            {LEFT_FLAMES.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', left: '4px',
                bottom: fc.bottom,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(4px)',
                transform: 'rotate(-90deg)',
                animation: `flickerSide${i % 2} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
          </div>

          {/* Right side flames */}
          <div style={{
            position: 'absolute', top: 0, bottom: '18px', right: '-18px',
            width: '28px', pointerEvents: 'none', zIndex: 10
          }}>
            {RIGHT_FLAMES.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', right: '4px',
                bottom: fc.bottom,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(4px)',
                transform: 'rotate(90deg)',
                animation: `flickerSide${(i + 1) % 2} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
          </div>

          {/* Outer glow ring around card */}
          <div style={{
            position: 'absolute', inset: '-2px', bottom: '16px',
            borderRadius: '18px', pointerEvents: 'none', zIndex: 0,
            boxShadow: '0 0 18px 4px rgba(255,60,0,0.28), 0 0 40px 8px rgba(255,100,0,0.14)',
            animation: 'outerFireGlow 2s ease infinite'
          }} />
        </>
      )}

      {/* ── THE CARD ── */}
      <div style={{
        background: isGold ? 'linear-gradient(180deg,#0f1520 60%,#1a0700 100%)' : '#0f1520',
        border: `1px solid ${borderColor}`,
        borderRadius: '16px',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 1,
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'translateY(0)' : 'translateY(24px)',
        transition: isGold
          ? 'opacity 0.5s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)'
          : 'opacity 0.4s ease, transform 0.4s ease',
        boxShadow: revealed && isGold ? '0 0 0 1px rgba(180,40,0,0.5), inset 0 -30px 40px -10px rgba(180,30,0,0.2)' : 'none',
      }}>

        {/* Image area */}
        <div style={{ height: '130px', background: '#111722', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          {pick.image
            ? <img src={pick.image} alt={pick.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
            : <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: isGold ? 'linear-gradient(135deg,#2a1000,#180800)' : 'linear-gradient(135deg,#161e2e,#0c1018)',
                border: isGold ? '2px solid rgba(255,100,0,0.3)' : '2px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Bebas Neue',sans-serif", fontSize: '24px',
                color: isGold ? '#f5a030' : '#7a8aaa', letterSpacing: '1px'
              }}>{pick.initials}</div>
          }

          {/* Tier badge */}
          <div style={{
            position: 'absolute', top: '8px', right: '8px',
            fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
            letterSpacing: '1.5px', textTransform: 'uppercase',
            padding: '3px 9px', borderRadius: '10px',
            background: isGold
              ? 'linear-gradient(90deg,#b83000,#e87000)'
              : t === 'high' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.07)',
            color: isGold ? '#fff' : t === 'high' ? '#10b981' : '#3a4a6a',
            border: isGold ? '1px solid rgba(255,100,0,0.45)' : t === 'high' ? '1px solid rgba(16,185,129,0.25)' : 'none',
            boxShadow: isGold ? '0 0 8px rgba(255,80,0,0.4)' : 'none'
          }}>{isGold ? '🔥 GOLD' : t === 'high' ? 'HIGH' : 'PICK'}</div>

          <div style={{ position: 'absolute', bottom: '7px', left: '8px', fontFamily: "'Bebas Neue',sans-serif", fontSize: '8px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.08)' }}>TRIP PREDICTS</div>

          <div style={{
            position: 'absolute', bottom: '6px', right: '8px',
            fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
            letterSpacing: '1px', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: '6px',
            background: lc.bg, color: lc.color, border: `1px solid ${lc.border}`
          }}>{league || pick.sport}</div>

          {/* Shimmer */}
          {isGold && revealed && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '45%', height: '100%', background: 'linear-gradient(105deg,transparent,rgba(255,140,40,0.08),transparent)', animation: 'shimmerMove 2.5s 0.8s ease infinite' }} />
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '12px 13px 10px' }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '15px', fontWeight: 700, color: '#eef2ff', letterSpacing: '0.5px', lineHeight: 1.1 }}>{pick.name}</div>
          <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '2px' }}>{pick.meta}</div>
          {(pick.time || pick.date) && (
            <div style={{ fontSize: '10px', color: isGold ? '#ff9944' : '#f5c842', marginTop: '3px', marginBottom: '8px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.5px' }}>
              🕐 {pick.date ? `${pick.date} · ` : ''}{pick.time || ''}
            </div>
          )}
          {!pick.time && !pick.date && <div style={{ marginBottom: '11px' }} />}

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
            <div style={{ height: '4px', background: '#111722', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '2px', background: fillBg, width: `${barWidth}%`, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
          </div>

          <button onClick={() => setInfoOpen(!infoOpen)} style={{
            width: '100%', padding: '7px 0',
            background: isGold ? 'rgba(255,60,0,0.05)' : 'rgba(255,255,255,0.03)',
            border: isGold ? '1px solid rgba(255,60,0,0.15)' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: '8px',
            color: isGold ? 'rgba(255,120,0,0.7)' : '#3a4a6a',
            fontFamily: "'Barlow',sans-serif", fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.5px', cursor: 'pointer', transition: 'all 0.2s'
          }}>{infoOpen ? 'Hide Info ▴' : 'View Info ▾'}</button>
        </div>

        {infoOpen && (
          <div style={{ padding: '12px 13px', borderTop: `1px solid ${isGold ? 'rgba(255,60,0,0.12)' : 'rgba(255,255,255,0.06)'}`, background: isGold ? '#140800' : '#111722' }}>
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
        )}
      </div>

      <style>{`
        @keyframes outerFireGlow {
          0%,100% { box-shadow: 0 0 18px 4px rgba(255,50,0,0.25),  0 0 40px 8px rgba(255,90,0,0.12); }
          33%      { box-shadow: 0 0 24px 6px rgba(255,90,0,0.35),  0 0 55px 12px rgba(255,140,0,0.18); }
          66%      { box-shadow: 0 0 20px 5px rgba(255,140,0,0.3),  0 0 48px 10px rgba(245,190,50,0.15); }
        }
        @keyframes shimmerMove {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
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
          from { transform: rotate(-90deg) scaleX(1)   translateY(1px)   ; opacity: 0.8; }
          to   { transform: rotate(-90deg) scaleX(0.5) translateY(-14px) ; opacity: 0.04; }
        }
        @keyframes flickerSide1 {
          from { transform: rotate(90deg) scaleX(0.9)  translateY(0px)   ; opacity: 0.85; }
          to   { transform: rotate(90deg) scaleX(1.2)  translateY(-16px) ; opacity: 0.05; }
        }
      `}</style>
    </div>
  )
}