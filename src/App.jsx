import React, { useState } from 'react'
import Splash from './Splash'
import Navbar from './Navbar'
import Tonight from './Tonight'
import Chat from './Chat'
import About from './About'

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [tab, setTab] = useState('tonight')
  const [showAbout, setShowAbout] = useState(false)

  if (showSplash) return <Splash onDone={() => setShowSplash(false)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Navbar tab={tab} setTab={setTab} onAbout={() => setShowAbout(true)} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {tab === 'tonight' && <Tonight />}
        {tab === 'chat' && <Chat />}
      </div>
      <footer style={{
        padding: '8px 24px', textAlign: 'center',
        fontSize: '11px', color: 'var(--text3)', letterSpacing: '1.5px', textTransform: 'uppercase',
        borderTop: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0
      }}>
        Built by Devin Triplett &nbsp;·&nbsp; Trip Predicts &nbsp;·&nbsp; Powered by AI
      </footer>
      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  )
}