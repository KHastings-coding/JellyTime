import React, { useState } from 'react';
import api from '../lib/api';
import '../styles.css';

export default function SetupPage({ jellyfinConfigured, onDone }) {
  const [step, setStep] = useState(jellyfinConfigured ? 'auth' : 'jellyfin');
  const [authTab, setAuthTab] = useState('jellyfin'); // 'jellyfin' | 'local'

  // Jellyfin step state
  const [jf, setJf] = useState({ url: '', apiKey: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Auth step state
  const [jfAuth, setJfAuth] = useState({ username: '', password: '' });
  const [localForm, setLocalForm] = useState({ username: '', password: '', confirm: '' });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const setJ = (f, v) => setJf(p => ({ ...p, [f]: v }));
  const setJA = (f, v) => setJfAuth(p => ({ ...p, [f]: v }));
  const setL = (f, v) => setLocalForm(p => ({ ...p, [f]: v }));

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post('/settings/test', { jellyfin_url: jf.url, jellyfin_api_key: jf.apiKey });
      setTestResult(r.data);
    } catch { setTestResult({ ok: false, error: 'Connection failed' }); }
    setTesting(false);
  }

  function handleJellyfinNext(e) {
    e.preventDefault();
    setError('');
    if (!jf.url || !jf.apiKey) return setError('URL and API key are required');
    setStep('auth');
  }

  function handleSkipJellyfin() {
    setError('');
    setAuthTab('local');
    setStep('auth');
  }

  async function handleJellyfinLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      // Save Jellyfin settings first (allowed unauthenticated during setup)
      if (!jellyfinConfigured) {
        await api.post('/settings', { jellyfin_url: jf.url, jellyfin_api_key: jf.apiKey });
      }
      const r = await api.post('/auth/jellyfin-login', { username: jfAuth.username, password: jfAuth.password });
      localStorage.setItem('jt_token', r.data.token);
      localStorage.setItem('jt_role', 'parent');
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  }

  async function handleLocalAccount(e) {
    e.preventDefault();
    setError('');
    if (localForm.password !== localForm.confirm) return setError('Passwords do not match');
    if (localForm.password.length < 6) return setError('Password must be at least 6 characters');
    setLoading(true);
    try {
      // Save Jellyfin settings first (allowed unauthenticated during setup)
      if (!jellyfinConfigured) {
        await api.post('/settings', { jellyfin_url: jf.url, jellyfin_api_key: jf.apiKey });
      }
      await api.post('/auth/setup', { username: localForm.username, password: localForm.password });
      const loginRes = await api.post('/auth/login', { username: localForm.username, password: localForm.password });
      localStorage.setItem('jt_token', loginRes.data.token);
      localStorage.setItem('jt_role', 'parent');
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Setup failed');
    }
    setLoading(false);
  }

  const totalSteps = jellyfinConfigured ? 1 : 2;
  const currentStepNum = step === 'jellyfin' ? 1 : totalSteps;

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🎬</div>
          <h1 style={{ fontFamily: 'Fredoka One, cursive', fontSize: '2.2rem', color: '#a855f7', marginBottom: '0.25rem' }}>JellyTime</h1>
          <p style={{ color: '#a0a0c0', fontSize: '0.9rem' }}>Screen time manager for Jellyfin</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} style={{
              width: 32, height: 6, borderRadius: 999,
              background: currentStepNum > i ? '#7c3aed' : '#252540',
              transition: 'background 0.3s'
            }} />
          ))}
        </div>

        <div className="card">
          {step === 'jellyfin' && (
            <>
              <h2 style={{ fontWeight: 800, fontSize: '1.3rem', marginBottom: '0.5rem' }}>Connect to Jellyfin</h2>
              <p style={{ color: '#a0a0c0', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Enter your Jellyfin server URL and API key. Generate one in Jellyfin → Dashboard → API Keys.
              </p>
              <form onSubmit={handleJellyfinNext} className="stack">
                <div>
                  <label className="label">Jellyfin URL</label>
                  <input className="input" placeholder="http://192.168.1.x:8096" value={jf.url} onChange={e => setJ('url', e.target.value)} required />
                </div>
                <div>
                  <label className="label">API Key</label>
                  <input className="input" type="password" placeholder="paste API key" value={jf.apiKey} onChange={e => setJ('apiKey', e.target.value)} required />
                </div>

                {testResult && (
                  <div style={{
                    padding: '0.75rem', borderRadius: 10,
                    background: testResult.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    color: testResult.ok ? '#10b981' : '#ef4444',
                    fontSize: '0.9rem'
                  }}>
                    {testResult.ok ? `✅ Connected to "${testResult.serverName}"` : `❌ ${testResult.error}`}
                  </div>
                )}

                {error && <p style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</p>}

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-ghost" onClick={handleTest} disabled={testing} style={{ flex: 1 }}>
                    {testing ? 'Testing...' : '🔌 Test'}
                  </button>
                  <button className="btn btn-primary" type="submit" style={{ flex: 2 }}>
                    Continue →
                  </button>
                </div>
              </form>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleSkipJellyfin}
                style={{ width: '100%', marginTop: '0.75rem', fontSize: '0.85rem', color: '#a0a0c0' }}
              >
                Skip for now — use local account
              </button>
            </>
          )}

          {step === 'auth' && (
            <>
              <h2 style={{ fontWeight: 800, fontSize: '1.3rem', marginBottom: '1rem' }}>Sign in</h2>

              {/* Tabs — only shown when Jellyfin is available */}
              {(jellyfinConfigured || jf.url) && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  {['jellyfin', 'local'].map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => { setAuthTab(tab); setError(''); }}
                      style={{
                        flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: '0.9rem',
                        background: authTab === tab ? '#7c3aed' : '#252540',
                        color: authTab === tab ? 'white' : '#a0a0c0',
                        transition: 'all 0.2s',
                      }}
                    >
                      {tab === 'jellyfin' ? '🎬 Jellyfin Account' : '🔑 Local Account'}
                    </button>
                  ))}
                </div>
              )}

              {authTab === 'jellyfin' && (
                <form onSubmit={handleJellyfinLogin} className="stack">
                  <p style={{ color: '#a0a0c0', fontSize: '0.9rem', marginTop: 0 }}>
                    Use your Jellyfin admin username and password.
                  </p>
                  <div>
                    <label className="label">Jellyfin Username</label>
                    <input className="input" value={jfAuth.username} onChange={e => setJA('username', e.target.value)} required autoFocus />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input className="input" type="password" value={jfAuth.password} onChange={e => setJA('password', e.target.value)} required />
                  </div>
                  {error && <p style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</p>}
                  <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? '...' : 'Sign In with Jellyfin →'}
                  </button>
                </form>
              )}

              {authTab === 'local' && (
                <form onSubmit={handleLocalAccount} className="stack">
                  <p style={{ color: '#a0a0c0', fontSize: '0.9rem', marginTop: 0 }}>
                    Create a separate JellyTime account.
                  </p>
                  <div>
                    <label className="label">Username</label>
                    <input className="input" value={localForm.username} onChange={e => setL('username', e.target.value)} required autoFocus />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input className="input" type="password" value={localForm.password} onChange={e => setL('password', e.target.value)} required />
                  </div>
                  <div>
                    <label className="label">Confirm password</label>
                    <input className="input" type="password" value={localForm.confirm} onChange={e => setL('confirm', e.target.value)} required />
                  </div>
                  {error && <p style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</p>}
                  <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? '...' : 'Create Account →'}
                  </button>
                </form>
              )}

              {!jellyfinConfigured && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setStep('jellyfin'); setError(''); }}
                  style={{ width: '100%', marginTop: '0.75rem', fontSize: '0.85rem' }}
                >
                  ← Back
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
