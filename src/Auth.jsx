import React, { useState } from 'react'
import { supabase } from './supabase'

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' or 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function handleSubmit() {
    setError(null)
    setNotice(null)
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: 'https://trip-predicts.vercel.app' }
      })
      if (error) setError(error.message)
      else setNotice('Check your email to confirm your account, then log in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setError('Please confirm your email first. Check your inbox.')
        } else {
          setError('Invalid email or password.')
        }
      }
    }
    setLoading(false)
  }

  async function handleReset() {
    if (!email) { setError('Enter your email first, then tap reset.'); return }
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://trip-predicts.vercel.app'
    })
    if (error) setError(error.message)
    else setNotice('Password reset link sent. Check your email.')
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #06090f 0%, #0a0f1c 50%, #070b12 100%)',
      padding: '20px', position: 'relative', overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: '-15%', right: '-8%', width: '60%', height: '60%', background: 'radial-gradient(ellipse, rgba(245,200,66,0.06) 0%, transparent 65%)', filter: 'blur(50px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: '55%', height: '55%', background: 'radial-gradient(ellipse, rgba(59,130,246,0.05) 0%, transparent 65%)', filter: 'blur(50px)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: '380px', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '40px', letterSpacing: '3px', background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1 }}>
            TRIP PREDICTS
          </div>
          <div style={{ fontSize: '12px', color: '#7a8aaa', marginTop: '6px', letterSpacing: '1px' }}>
            {mode === 'login' ? 'Welcome back. Log in to continue.' : 'Create your free account.'}
          </div>
        </div>

        <div style={{ background: 'rgba(13,18,28,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px', backdropFilter: 'blur(8px)' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            style={inputStyle}
          />

          {error && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px', lineHeight: 1.5 }}>{error}</div>}
          {notice && <div style={{ color: '#10b981', fontSize: '12px', marginBottom: '12px', lineHeight: 1.5 }}>{notice}</div>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%', padding: '13px',
              background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)',
              border: 'none', borderRadius: '10px',
              color: '#1a0f00', fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: '16px', fontWeight: 700, letterSpacing: '1px',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
              textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent'
            }}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>

          {mode === 'login' && (
            <div onClick={handleReset} style={{ textAlign: 'center', fontSize: '11px', color: '#7a8aaa', marginTop: '14px', cursor: 'pointer' }}>
              Forgot password?
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#7a8aaa' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setNotice(null) }}
            style={{ color: '#f5c842', cursor: 'pointer', fontWeight: 600 }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </span>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '12px 14px', marginBottom: '12px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px', color: '#eef2ff', fontSize: '14px',
  fontFamily: "'Barlow', sans-serif", outline: 'none', boxSizing: 'border-box'
}