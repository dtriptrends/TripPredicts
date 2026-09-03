import React, { useEffect } from 'react'

// The TRIP logo (transparent PNG) now carries the splash, with PREDICTS set
// under it in the same gradient wordmark the splash always used. Every
// element from before is still here: the byline, the 200px fill bar, the
// cycling status line, the grid, the tokens and fonts. Additions are the
// logo, a gold glow and light sweep masked to its shape, a stadium field
// fading toward the horizon under it, and a FOOTBALL SEASON tag.
//
// Asset: save trip-logo-transparent.png as public/trip-logo.png so Vite
// serves it at /trip-logo.png.
//
// Timeline (ms):
//   0     grid and field fade in, glow starts breathing
//   100   logo wipes in left to right while rising
//   200   PREDICTS wipes in the same way
//   450   byline rises in
//   550   FOOTBALL SEASON rule and tag rise in
//   600   bar appears, fills over 1.8s (unchanged)
//   700   status line cycles Pulling live lines / Scoring the slate / Filtering traps
//   1000  a single gold light sweep crosses the logo, then PREDICTS
//   2600  whole splash dissolves out (0.4s) instead of cutting
//   3000  onDone
const LOGO = '/trip-logo.png'

export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [])

  // NOTE: the background shorthand resets background-clip, so the clip
  // properties must come AFTER background on each element, never before.
  const wordmark = { fontFamily:'var(--font-d)',fontSize:'44px',letterSpacing:'10px',lineHeight:1 }
  const clipText = { WebkitBackgroundClip:'text',backgroundClip:'text',WebkitTextFillColor:'transparent' }
  // The logo sweep uses a CSS mask instead of background-clip: the moving
  // gold highlight is clipped to the PNG's alpha, so it only ever lights
  // the letters and the profile, never the box around them.
  const logoMask = {
    WebkitMaskImage:`url(${LOGO})`,maskImage:`url(${LOGO})`,
    WebkitMaskSize:'contain',maskSize:'contain',
    WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat',
    WebkitMaskPosition:'center',maskPosition:'center'
  }

  return (
    <div className="splashRoot" style={{
      position:'fixed',inset:0,zIndex:9999,background:'var(--bg)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'6px',overflow:'hidden'
    }}>
      {/* Same grid and glow language as the app shell, breathing softly underneath. */}
      <div className="splashGrid" style={{position:'absolute',inset:0,pointerEvents:'none'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)',backgroundSize:'44px 44px'}}/>
        <div className="splashGlow" style={{position:'absolute',top:'42%',left:'50%',width:'80vw',height:'50vh',transform:'translate(-50%,-50%)',background:'radial-gradient(ellipse, var(--gold-glow) 0%, transparent 65%)',filter:'blur(60px)',opacity:0.35}}/>
        {/* Stadium field: yard lines and sidelines converging on the horizon,
            drawn in the gold token at low opacity across the bottom third. */}
        <svg className="splashField" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true"
          style={{position:'absolute',left:0,right:0,bottom:0,width:'100%',height:'34vh',opacity:0.28}}>
          <defs>
            <linearGradient id="splashFieldFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--gold)" stopOpacity="0.15"/>
              <stop offset="1" stopColor="var(--gold)" stopOpacity="1"/>
            </linearGradient>
            <radialGradient id="splashHorizon" cx="0.5" cy="0" r="0.6">
              <stop offset="0" stopColor="var(--gold)" stopOpacity="0.35"/>
              <stop offset="1" stopColor="var(--gold)" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="1000" height="160" fill="url(#splashHorizon)"/>
          <g stroke="url(#splashFieldFade)" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke">
            <line x1="290" y1="0" x2="-60" y2="400"/>
            <line x1="710" y1="0" x2="1060" y2="400"/>
            <line x1="290" y1="0" x2="710" y2="0"/>
            <line x1="279" y1="12" x2="721" y2="12"/>
            <line x1="258" y1="36" x2="742" y2="36"/>
            <line x1="228" y1="70" x2="772" y2="70"/>
            <line x1="188" y1="116" x2="812" y2="116"/>
            <line x1="139" y1="172" x2="861" y2="172"/>
            <line x1="81" y1="238" x2="919" y2="238"/>
            <line x1="14" y1="315" x2="986" y2="315"/>
            <line x1="-60" y1="400" x2="1060" y2="400"/>
          </g>
          <g stroke="var(--gold)" strokeOpacity="0.35" strokeWidth="1.5">
            <line x1="410" y1="20" x2="410" y2="30"/><line x1="590" y1="20" x2="590" y2="30"/>
            <line x1="400" y1="88" x2="400" y2="100"/><line x1="600" y1="88" x2="600" y2="100"/>
            <line x1="392" y1="196" x2="392" y2="212"/><line x1="608" y1="196" x2="608" y2="212"/>
            <line x1="384" y1="268" x2="384" y2="288"/><line x1="616" y1="268" x2="616" y2="288"/>
          </g>
        </svg>
      </div>

      {/* Logo with a gold glow behind it and a text-style light sweep masked
          to its shape. Both duplicates are invisible at rest. */}
      <div className="splashLogoWrap" style={{position:'relative',zIndex:1,width:'min(78vw, 440px)',aspectRatio:'1732 / 580'}}>
        <div className="splashLogoGlow" aria-hidden="true" style={{
          position:'absolute',inset:'-6%',
          background:'var(--gold)',
          ...logoMask,
          filter:'blur(14px)',opacity:0.55
        }}/>
        <img className="splashLogo" src={LOGO} alt="TRIP" draggable="false" style={{
          position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',
          filter:'drop-shadow(0 10px 22px rgba(0,0,0,0.55))',opacity:0
        }}/>
        <div className="splashSweep" aria-hidden="true" style={{
          position:'absolute',inset:0,
          background:'linear-gradient(105deg, transparent 42%, var(--gold3) 50%, transparent 58%)',
          backgroundSize:'250% 100%',backgroundPosition:'200% 0',
          ...logoMask,
          pointerEvents:'none'
        }}/>
      </div>

      {/* PREDICTS: the original gradient wordmark, same wipe, same sweep. */}
      <div style={{position:'relative',zIndex:1,marginTop:'4px'}}>
        <div className="splashWord" style={{
          ...wordmark,
          background:'linear-gradient(135deg,#c8960c 0%,#f5c842 40%,#fff 65%,#3b82f6 100%)',
          ...clipText,
          opacity:0
        }}>PREDICTS</div>
        <div className="splashSweep splashSweepWord" aria-hidden="true" style={{
          ...wordmark,position:'absolute',inset:0,
          background:'linear-gradient(105deg, transparent 42%, var(--gold3) 50%, transparent 58%)',
          backgroundSize:'250% 100%',backgroundPosition:'200% 0',
          ...clipText,
          pointerEvents:'none'
        }}>PREDICTS</div>
      </div>

      <div style={{
        fontFamily:'var(--font-c)',fontSize:'13px',letterSpacing:'5px',color:'var(--text2)',textTransform:'uppercase',
        animation:'splashUp 0.9s 0.45s cubic-bezier(0.16,1,0.3,1) forwards',opacity:0,position:'relative',zIndex:1
      }}>by Devin Triplett</div>

      {/* Season tag: thin gold rule fading at both ends, then the label. */}
      <div style={{
        marginTop:'18px',display:'flex',flexDirection:'column',alignItems:'center',gap:'10px',
        animation:'splashUp 0.9s 0.55s cubic-bezier(0.16,1,0.3,1) forwards',opacity:0,position:'relative',zIndex:1
      }}>
        <div style={{width:'min(60vw, 300px)',height:'1px',background:'linear-gradient(90deg, transparent, var(--gold) 35%, var(--gold) 65%, transparent)',opacity:0.8}}/>
        <div style={{fontFamily:'var(--font-c)',fontSize:'12px',letterSpacing:'6px',color:'var(--text2)',textTransform:'uppercase'}}>Football Season</div>
      </div>

      <div style={{
        marginTop:'28px',width:'200px',height:'1px',background:'var(--border2)',overflow:'hidden',
        animation:'splashUp 0.5s 0.6s ease forwards',opacity:0,position:'relative',zIndex:1
      }}>
        <div style={{
          height:'100%',
          background:'linear-gradient(90deg,var(--gold2),var(--gold),var(--accent))',
          animation:'fillBar 1.8s 0.6s ease forwards',width:0
        }}/>
      </div>

      {/* Status line: the three stages the product already names on the
          Gold tab, cycling in sync with the bar. */}
      <div style={{position:'relative',zIndex:1,height:'14px',marginTop:'14px',width:'260px',fontFamily:'var(--font-c)',fontSize:'11px',letterSpacing:'4px',color:'var(--text3)',textTransform:'uppercase',textAlign:'center'}}>
        <span className="splashStep s1">Pulling live lines</span>
        <span className="splashStep s2">Scoring the slate</span>
        <span className="splashStep s3">Filtering traps</span>
      </div>

      <style>{`
        @keyframes splashUp{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fillBar{to{width:100%;}}
        @keyframes splashWipe{
          from{opacity:0;transform:translateY(24px);clip-path:inset(0 100% 0 0);}
          35%{opacity:1;}
          to{opacity:1;transform:translateY(0);clip-path:inset(0 0 0 0);}
        }
        @keyframes splashSweep{from{background-position:200% 0;}to{background-position:-100% 0;}}
        @keyframes splashBreathe{0%,100%{opacity:0.35;}50%{opacity:0.7;}}
        @keyframes splashLogoBreathe{0%,100%{opacity:0.45;}50%{opacity:0.75;}}
        @keyframes splashGridIn{from{opacity:0;}to{opacity:1;}}
        @keyframes splashStep{0%,100%{opacity:0;transform:translateY(4px);}15%,85%{opacity:1;transform:translateY(0);}}
        @keyframes splashOut{to{opacity:0;transform:scale(1.015);}}
        .splashRoot{animation:splashOut 0.4s 2.6s ease forwards;}
        .splashGrid{animation:splashGridIn 0.8s ease forwards;opacity:0;}
        .splashGlow{animation:splashBreathe 2.4s ease-in-out infinite;}
        .splashLogo{animation:splashWipe 1s 0.1s cubic-bezier(0.16,1,0.3,1) forwards;}
        .splashLogoGlow{animation:splashWipe 1s 0.1s cubic-bezier(0.16,1,0.3,1) forwards, splashLogoBreathe 2.4s 1.1s ease-in-out infinite;opacity:0;}
        .splashWord{animation:splashWipe 1s 0.2s cubic-bezier(0.16,1,0.3,1) forwards;}
        .splashSweep{animation:splashSweep 0.9s 1s cubic-bezier(0.4,0,0.2,1) forwards;}
        .splashSweepWord{animation-delay:1.25s;}
        .splashStep{position:absolute;left:0;right:0;opacity:0;}
        .splashStep.s1{animation:splashStep 0.75s 0.7s ease forwards;}
        .splashStep.s2{animation:splashStep 0.75s 1.4s ease forwards;}
        .splashStep.s3{animation:splashStep 0.75s 2.1s ease forwards;}
        @media (prefers-reduced-motion: reduce){
          .splashLogo,.splashLogoGlow,.splashWord,.splashSweep,.splashGrid,.splashGlow,.splashStep{animation:none !important;opacity:1 !important;clip-path:none !important;}
          .splashLogoGlow{opacity:0.55 !important;}
          .splashSweep{opacity:0 !important;}
        }
      `}</style>
    </div>
  )
}