import React, { useEffect } from 'react'

// Everything that was here before is still here: the gradient wordmark, the
// byline, the 200px fill bar, the same tokens and fonts. This pass only
// changes how those elements ARRIVE and LEAVE. Timeline (ms):
//   0     grid fades in and starts breathing
//   100   wordmark wipes in left to right while rising (same splashUp motion)
//   1000  a single gold light sweep crosses the letters, text only
//   300   byline rises in
//   500   bar appears, fills over 1.8s (unchanged)
//   700   status line cycles Pulling live lines / Scoring the slate / Filtering traps
//   2600  whole splash dissolves out (0.4s) instead of cutting
//   3000  onDone
export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [])

  const wordmark = {
    fontFamily:'var(--font-d)',fontSize:'72px',letterSpacing:'6px',lineHeight:1,
    WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'
  }

  return (
    <div className="splashRoot" style={{
      position:'fixed',inset:0,zIndex:9999,background:'var(--bg)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'6px',overflow:'hidden'
    }}>
      {/* Same grid and glow language as the app shell, breathing softly underneath. */}
      <div className="splashGrid" style={{position:'absolute',inset:0,pointerEvents:'none'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)',backgroundSize:'44px 44px'}}/>
        <div className="splashGlow" style={{position:'absolute',top:'50%',left:'50%',width:'70vw',height:'50vh',transform:'translate(-50%,-50%)',background:'radial-gradient(ellipse, var(--gold-glow) 0%, transparent 65%)',filter:'blur(60px)',opacity:0.35}}/>
      </div>

      {/* Base wordmark, identical gradient, now revealed with a wipe. */}
      <div style={{position:'relative',zIndex:1}}>
        <div className="splashWord" style={{
          ...wordmark,
          background:'linear-gradient(135deg,#c8960c 0%,#f5c842 40%,#fff 65%,#3b82f6 100%)',
          opacity:0
        }}>TRIP PREDICTS</div>
        {/* Text-only light sweep: a transparent duplicate whose gradient is a
            moving gold highlight clipped to the letters. Invisible at rest, so
            the resting look is exactly the original. */}
        <div className="splashSweep" aria-hidden="true" style={{
          ...wordmark,position:'absolute',inset:0,
          background:'linear-gradient(105deg, transparent 42%, var(--gold3) 50%, transparent 58%)',
          backgroundSize:'250% 100%',backgroundPosition:'200% 0',
          pointerEvents:'none'
        }}>TRIP PREDICTS</div>
      </div>

      <div style={{
        fontFamily:'var(--font-c)',fontSize:'13px',letterSpacing:'5px',color:'var(--text2)',textTransform:'uppercase',
        animation:'splashUp 0.9s 0.3s cubic-bezier(0.16,1,0.3,1) forwards',opacity:0,position:'relative',zIndex:1
      }}>by Devin Triplett</div>

      <div style={{
        marginTop:'40px',width:'200px',height:'1px',background:'var(--border2)',overflow:'hidden',
        animation:'splashUp 0.5s 0.5s ease forwards',opacity:0,position:'relative',zIndex:1
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
        @keyframes splashGridIn{from{opacity:0;}to{opacity:1;}}
        @keyframes splashStep{0%,100%{opacity:0;transform:translateY(4px);}15%,85%{opacity:1;transform:translateY(0);}}
        @keyframes splashOut{to{opacity:0;transform:scale(1.015);}}
        .splashRoot{animation:splashOut 0.4s 2.6s ease forwards;}
        .splashGrid{animation:splashGridIn 0.8s ease forwards;opacity:0;}
        .splashGlow{animation:splashBreathe 2.4s ease-in-out infinite;}
        .splashWord{animation:splashWipe 1s 0.1s cubic-bezier(0.16,1,0.3,1) forwards;}
        .splashSweep{animation:splashSweep 0.9s 1s cubic-bezier(0.4,0,0.2,1) forwards;}
        .splashStep{position:absolute;left:0;right:0;opacity:0;}
        .splashStep.s1{animation:splashStep 0.75s 0.7s ease forwards;}
        .splashStep.s2{animation:splashStep 0.75s 1.4s ease forwards;}
        .splashStep.s3{animation:splashStep 0.75s 2.1s ease forwards;}
        @media (prefers-reduced-motion: reduce){
          .splashWord,.splashSweep,.splashGrid,.splashGlow,.splashStep{animation:none !important;opacity:1 !important;clip-path:none !important;}
          .splashSweep{opacity:0 !important;}
        }
      `}</style>
    </div>
  )
}