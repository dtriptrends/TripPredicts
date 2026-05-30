import React, { useEffect } from 'react'

export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{
      position:'fixed',inset:0,zIndex:9999,background:'var(--bg)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'6px'
    }}>
      <div style={{
        fontFamily:'var(--font-d)',fontSize:'72px',letterSpacing:'6px',
        background:'linear-gradient(135deg,#c8960c 0%,#f5c842 40%,#fff 65%,#3b82f6 100%)',
        WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
        animation:'splashUp 0.9s cubic-bezier(0.16,1,0.3,1) forwards',opacity:0
      }}>TRIP PREDICTS</div>
      <div style={{
        fontFamily:'var(--font-c)',fontSize:'13px',letterSpacing:'5px',color:'var(--text2)',textTransform:'uppercase',
        animation:'splashUp 0.9s 0.2s cubic-bezier(0.16,1,0.3,1) forwards',opacity:0
      }}>by Devin Triplett</div>
      <div style={{
        marginTop:'40px',width:'200px',height:'1px',background:'var(--border2)',overflow:'hidden',
        animation:'splashUp 0.5s 0.4s ease forwards',opacity:0
      }}>
        <div style={{
          height:'100%',
          background:'linear-gradient(90deg,var(--gold2),var(--gold),var(--accent))',
          animation:'fillBar 1.8s 0.5s ease forwards',width:0
        }}/>
      </div>
      <style>{`
        @keyframes splashUp{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fillBar{to{width:100%;}}
      `}</style>
    </div>
  )
}