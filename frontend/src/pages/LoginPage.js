import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import '../styles.css';

export default function LoginPage() {
  const [tab, setTab] = useState('jellyfin'); // 'jellyfin' | 'local'
  const [jfForm, setJfForm] = useState({ username: '', password: '' });
  const [localForm, setLocalForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [jellyfinConfigured, setJellyfinConfigured] = useState(true);
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/auth/setup-status').then(r => {
      setJellyfinConfigured(r.data.jellyfinConfigured);
      setLocalLoginEnabled(r.data.localLoginEnabled);
      // If only local login is available, start on that tab
      if (!r.data.jellyfinConfigured) setTab('local');
    });
  }, []);

  async function handleJellyfinLogin(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await api.post('/auth/jellyfin-login', jfForm);
      localStorage.setItem('jt_token', r.data.token);
      localStorage.setItem('jt_role', 'parent');
      navigate('/parent');
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  }

  async function handleLocalLogin(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await api.post('/auth/login', localForm);
      localStorage.setItem('jt_token', r.data.token);
      localStorage.setItem('jt_role', 'parent');
      navigate('/parent');
    } catch {
      setError('Invalid username or password');
    }
    setLoading(false);
  }

  const showBothTabs = jellyfinConfigured && localLoginEnabled;
  const showJellyfin = jellyfinConfigured;
  const showLocal = localLoginEnabled;

  return (
    <div className="page" style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'2rem', minHeight:'100vh' }}>
      <div style={{ width:'100%', maxWidth:380 }}>
        <div style={{ textAlign:'center', marginBottom:'2rem' }}>
          <div style={{ fontSize:'3.5rem', marginBottom:'0.5rem' }}>🎬</div>
          <h1 style={{ fontFamily:'Fredoka One, cursive', fontSize:'2.5rem', color:'#a855f7' }}>JellyTime</h1>
          <p style={{ color:'#a0a0c0', marginTop:'0.25rem' }}>Screen time, your way</p>
        </div>

        <div className="card">
          <h2 style={{ fontWeight:800, marginBottom:'1rem' }}>Parent Login</h2>

          {/* Tabs — only shown when both options are available */}
          {showBothTabs && (
            <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.5rem' }}>
              {[
                showJellyfin && 'jellyfin',
                showLocal && 'local',
              ].filter(Boolean).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setError(''); }}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: '0.85rem',
                    background: tab === t ? '#7c3aed' : '#252540',
                    color: tab === t ? 'white' : '#a0a0c0',
                    transition: 'all 0.2s',
                  }}
                >
                  {t === 'jellyfin' ? '🎬 Jellyfin' : '🔑 Local'}
                </button>
              ))}
            </div>
          )}

          {(tab === 'jellyfin' && showJellyfin) && (
            <form onSubmit={handleJellyfinLogin} className="stack">
              <div>
                <label className="label">Jellyfin Username</label>
                <input className="input" value={jfForm.username} onChange={e => setJfForm(p=>({...p,username:e.target.value}))} required autoFocus />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" value={jfForm.password} onChange={e => setJfForm(p=>({...p,password:e.target.value}))} required />
              </div>
              {error && <p style={{ color:'#ef4444', fontSize:'0.9rem' }}>{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? '...' : 'Sign In'}</button>
            </form>
          )}

          {(tab === 'local' && showLocal) && (
            <form onSubmit={handleLocalLogin} className="stack">
              <div>
                <label className="label">Username</label>
                <input className="input" value={localForm.username} onChange={e => setLocalForm(p=>({...p,username:e.target.value}))} required autoFocus />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" value={localForm.password} onChange={e => setLocalForm(p=>({...p,password:e.target.value}))} required />
              </div>
              {error && <p style={{ color:'#ef4444', fontSize:'0.9rem' }}>{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? '...' : 'Sign In'}</button>
            </form>
          )}
        </div>

        <div style={{ textAlign:'center', marginTop:'1.5rem' }}>
          <button className="btn btn-ghost" onClick={() => navigate('/child-select')} style={{ width:'100%' }}>
            👧 I'm a kid →
          </button>
        </div>
      </div>
    </div>
  );
}
