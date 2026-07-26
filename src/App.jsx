import React, { useState, useEffect } from 'react'
import { supabase } from './supabase'
import Auth from './Auth'
import Splash from './Splash'
import Navbar from './Navbar'
import Tonight from './Tonight'
import Gold from './Gold'
import Moneylines from './Moneylines'
import Chat from './Chat'
import About from './About'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showSplash, setShowSplash] = useState(true)
  const [tab, setTab] = useState('tonight')
  const [showAbout, setShowAbout] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setShowAbout(false)
    setTab('tonight')
  }

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070b12' }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '24px', letterSpacing: '3px', color: '#f5c842' }}>TRIP PREDICTS</div>
      </div>
    )
  }

  if (!session) return <Auth />

  if (showSplash) return <Splash onDone={() => setShowSplash(false)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#070b12', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #06090f 0%, #0a0f1c 50%, #070b12 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div style={{ position: 'absolute', top: '-15%', right: '-8%', width: '60%', height: '60%', background: 'radial-gradient(ellipse, rgba(245,200,66,0.05) 0%, transparent 65%)', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: '55%', height: '55%', background: 'radial-gradient(ellipse, rgba(59,130,246,0.045) 0%, transparent 65%)', filter: 'blur(50px)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Navbar tab={tab} setTab={setTab} onAbout={() => setShowAbout(true)} />
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div style={{ display: tab === 'tonight' ? 'flex' : 'none', position: 'absolute', inset: 0 }}><Tonight /></div>
          <div style={{ display: tab === 'gold' ? 'flex' : 'none', position: 'absolute', inset: 0 }}><Gold /></div>
          <div style={{ display: tab === 'moneylines' ? 'flex' : 'none', position: 'absolute', inset: 0 }}><Moneylines /></div>
          <div style={{ display: tab === 'chat' ? 'flex' : 'none', position: 'absolute', inset: 0 }}><Chat /></div>
        </div>
        <footer style={{ padding: '8px 24px', textAlign: 'center', fontSize: '11px', color: 'var(--text3)', letterSpacing: '1.5px', textTransform: 'uppercase', borderTop: '1px solid var(--border)', background: 'transparent', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Built by Devin Triplett · Trip Predicts</span>
          <span onClick={handleLogout} style={{ cursor: 'pointer', color: '#7a8aaa' }}>Log Out</span>
        </footer>
      </div>

      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  )
}