import React from 'react'

export default function About({ onClose }) {
  return (
    <div style={{
      display:'flex',position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',
      zIndex:500,alignItems:'center',justifyContent:'center'
    }}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:'20px',
        padding:'28px',maxWidth:'360px',width:'90%'
      }}>
        <div style={{fontFamily:'var(--font-d)',fontSize:'30px',letterSpacing:'3px',color:'var(--gold)',marginBottom:'4px'}}>TRIP PREDICTS</div>
        <div style={{fontSize:'12px',color:'var(--text2)',letterSpacing:'2px',marginBottom:'18px',textTransform:'uppercase'}}>By Devin Triplett</div>
        <div style={{fontSize:'13px',color:'var(--text2)',lineHeight:1.7,marginBottom:'14px'}}>
          AI-powered prop pick analysis for PrizePicks and similar platforms — covering all major sports and esports in one place.
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px'}}>
          {[
            {color:'var(--text3)',label:'Regular — below 75% confidence'},
            {color:'var(--high)',label:'High — 75% to 89% confidence'},
            {color:'var(--gold)',label:'Gold — 90%+ confidence · Rare · Elite plays only'},
          ].map((t,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'12px'}}>
              <div style={{width:'10px',height:'10px',borderRadius:'50%',background:t.color,flexShrink:0}}/>
              <span style={{color:'var(--text2)'}}>{t.label}</span>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{
          background:'var(--bg3)',border:'1px solid var(--border2)',color:'var(--text2)',
          fontFamily:'var(--font)',fontSize:'13px',padding:'9px 24px',borderRadius:'10px',cursor:'pointer'
        }}>Close</button>
      </div>
    </div>
  )
}