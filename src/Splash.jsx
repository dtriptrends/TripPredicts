import React, { useEffect } from 'react'
import logoPng from './trip-logo.png'

// The TRIP logo (transparent PNG) now carries the splash, with PREDICTS set
// under it in the same gradient wordmark the splash always used. Every
// element from before is still here: the byline, the 200px fill bar, the
// cycling status line, the grid, the tokens and fonts. Additions are the
// logo, a gold glow and light sweep masked to its shape, a basketball court
// fading toward the horizon under it, and an NBA SEASON tag.
//
// Asset: trip-logo.png sits next to this file and is imported below, so
// Vite bundles it with the code and the path can never 404.
//
// Timeline (ms):
//   0     grid and court fade in, glow starts breathing
//   100   logo wipes in left to right while rising
//   200   PREDICTS wipes in the same way
//   450   byline rises in
//   550   NBA SEASON rule and tag rise in
//   600   bar appears, fills over 1.8s (unchanged)
//   700   status line cycles Pulling live lines / Scoring the slate / Filtering traps
//   1000  a single gold light sweep crosses the logo, then PREDICTS
//   2600  whole splash dissolves out (0.4s) instead of cutting
//   3000  onDone
const LOGO = logoPng

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
        {/* Basketball court in perspective: real NBA dimensions (94 x 50 ft,
            16 ft lane, 23.75 ft three-point arc) projected toward the
            horizon, drawn in the gold token at low opacity across the bottom
            third. Same vanishing geometry the football field used. */}
        <svg className="splashField" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true"
          style={{position:'absolute',left:0,right:0,bottom:0,width:'100%',height:'34vh',opacity:0.28}}>
          <defs>
            <linearGradient id="splashFieldFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--gold)" stopOpacity="0.15"/>
              <stop offset="1" stopColor="var(--gold)" stopOpacity="1"/>
            </linearGradient>
          </defs>
          <path d="M290 0L710 0L1060 400L-60 400L290 0M194.5 109.1L805.5 109.1M573.3 109.1L573.1 112.3L571 115.5L567.1 118.5L561.4 121.4L554.1 124L545.2 126.3L535.1 128.1L524 129.5L512.2 130.3L500 130.6L487.8 130.3L476 129.5L464.9 128.1L454.8 126.3L445.9 124L438.6 121.4L432.9 118.5L429 115.5L426.9 112.3L426.7 109.1L428.2 106L431.5 102.9L436.4 100.1L442.6 97.6L450.2 95.3L458.8 93.4L468.4 91.9L478.5 90.8L489.2 90.2L500 89.9L510.8 90.2L521.5 90.8L531.6 91.9L541.2 93.4L549.8 95.3L557.4 97.6L563.6 100.1L568.5 102.9L571.8 106L573.3 109.1M432.8 0L423.1 34.7L576.9 34.7L567.2 0M557.7 34.7L557.5 36.4L556.4 38L554.2 39.6L551.1 41.1L547.1 42.6L542.2 43.9L536.4 45L530 46L523 46.8L515.6 47.4L507.9 47.7L500 47.8L492.1 47.7L484.4 47.4L477 46.8L470 46L463.6 45L457.8 43.9L452.9 42.6L448.9 41.1L445.8 39.6L443.6 38L442.5 36.4L442.3 34.7M315.2 0L295.9 25L295.9 25L299.7 27.8L304.6 30.6L310.4 33.3L317.3 36L325.2 38.6L334.1 41.1L344 43.4L354.8 45.7L366.5 47.7L379 49.7L392.3 51.4L406.3 52.9L421 54.2L436.1 55.3L451.7 56.2L467.6 56.8L483.8 57.2L500 57.3L516.2 57.2L532.4 56.8L548.3 56.2L563.9 55.3L579 54.2L593.7 52.9L607.7 51.4L621 49.7L633.5 47.7L645.2 45.7L656 43.4L665.9 41.1L674.8 38.6L682.7 36L689.6 33.3L695.4 30.6L700.3 27.8L704.1 25L684.8 0M506.5 8.7L505.9 9.2L504.1 9.7L501.5 9.9L498.5 9.9L495.9 9.7L494.1 9.2L493.5 8.7L494.1 8.1L495.9 7.7L498.6 7.4L501.4 7.4L504.1 7.7L505.9 8.1L506.5 8.7M474.1 6.6L525.9 6.6M320.8 400L366 238.7L634 238.7L679.2 400M600.5 238.7L598.6 233.8L595.1 229.1L590.1 224.6L583.7 220.4L576.1 216.6L567.3 213.2L557.6 210.3L547 207.9L535.8 205.9L524.2 204.6L512.2 203.7L500 203.4L487.8 203.7L475.8 204.6L464.2 205.9L453 207.9L442.4 210.3L432.7 213.2L423.9 216.6L416.3 220.4L409.9 224.6L404.9 229.1L401.4 233.8L399.5 238.7M7.2 400L106.3 271.3L106.3 271.3L125.3 261.2L144.9 251.7L165 243L185.6 234.9L206.7 227.4L228.1 220.6L249.9 214.4L271.9 208.7L294.1 203.7L316.6 199.2L339.2 195.3L361.9 191.9L384.8 189.1L407.7 186.8L430.7 185L453.8 183.7L476.9 182.9L500 182.7L523.1 182.9L546.2 183.7L569.3 185L592.3 186.8L615.2 189.1L638.1 191.9L660.8 195.3L683.4 199.2L705.9 203.7L728.1 208.7L750.1 214.4L771.9 220.6L793.3 227.4L814.4 234.9L835 243L855.1 251.7L874.7 261.2L893.7 271.3L992.8 400M515.4 345.5L513.9 348.6L509.7 351.1L503.5 352.5L496.5 352.5L490.3 351.1L486.1 348.6L484.6 345.5L486.2 342.4L490.5 340L496.6 338.6L503.4 338.6L509.5 340L513.8 342.4L515.4 345.5M437.3 357.6L562.7 357.6" stroke="url(#splashFieldFade)" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
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
        <div style={{fontFamily:'var(--font-c)',fontSize:'12px',letterSpacing:'6px',color:'var(--text2)',textTransform:'uppercase'}}>NBA Season</div>
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