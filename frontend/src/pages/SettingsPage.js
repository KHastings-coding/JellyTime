import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { registerPush, unregisterPush } from '../lib/push';
import '../styles.css';

export default function SettingsPage() {
  const [form, setForm] = useState({ jellyfin_url:'', jellyfin_api_key:'' });
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);

  // Access section
  const [jellyfinConfigured, setJellyfinConfigured] = useState(false);
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const [localUsers, setLocalUsers] = useState([]);
  const [newUser, setNewUser] = useState({ display_name:'', username:'', password:'', confirm:'' });
  const [userError, setUserError] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  // Notifications section
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [notifLoading, setNotifLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    const r = await api.get('/auth/setup-status');
    setJellyfinConfigured(r.data.jellyfinConfigured);
    setLocalLoginEnabled(r.data.localLoginEnabled);
  }, []);

  const loadLocalUsers = useCallback(async () => {
    const r = await api.get('/auth/local-users');
    setLocalUsers(r.data);
  }, []);

  useEffect(() => {
    api.get('/settings').then(r => setForm(p=>({...p,...r.data})));
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (localLoginEnabled) loadLocalUsers();
  }, [localLoginEnabled, loadLocalUsers]);

  async function handleSave(e) {
    e.preventDefault();
    await api.post('/settings', form);
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    const r = await api.post('/settings/test', form).catch(e=>({data:{ok:false,error:e.message}}));
    setTestResult(r.data);
    setTesting(false);
  }

  async function toggleLocalLogin(enabled) {
    setLocalLoginEnabled(enabled);
    await api.post('/settings', { local_login_enabled: enabled });
    if (enabled) loadLocalUsers();
  }

  async function deleteUser(id) {
    if (!window.confirm('Delete this user?')) return;
    await api.delete(`/auth/local-users/${id}`);
    loadLocalUsers();
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setUserError('');
    if (newUser.password !== newUser.confirm) return setUserError('Passwords do not match');
    if (newUser.password.length < 6) return setUserError('Password must be at least 6 characters');
    setUserSaving(true);
    try {
      await api.post('/auth/local-users', {
        display_name: newUser.display_name,
        username: newUser.username,
        password: newUser.password,
      });
      setNewUser({ display_name:'', username:'', password:'', confirm:'' });
      loadLocalUsers();
    } catch (e) {
      setUserError(e.response?.data?.error || 'Failed to create user');
    }
    setUserSaving(false);
  }

  async function handleEnableNotifications() {
    setNotifLoading(true);
    try {
      const ok = await registerPush();
      if (ok) setNotifPermission('granted');
      else setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
    } catch {}
    setNotifLoading(false);
  }

  async function handleDisableNotifications() {
    setNotifLoading(true);
    try {
      await unregisterPush();
      setNotifPermission('default');
    } catch {}
    setNotifLoading(false);
  }

  return (
    <div className="page">
      <nav className="nav">
        <Link to="/parent" className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem',fontSize:'0.85rem' }}>← Dashboard</Link>
        <span className="nav-title" style={{ flex:1,textAlign:'center' }}>⚙️ Settings</span>
      </nav>

      <div style={{ padding:'1.5rem',maxWidth:560,margin:'0 auto' }}>
        {/* Jellyfin Connection */}
        <div className="card">
          <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'0.5rem' }}>Jellyfin Connection</h3>
          <p style={{ color:'#a0a0c0',fontSize:'0.9rem',marginBottom:'1.5rem' }}>
            Generate an API key in Jellyfin → Dashboard → API Keys → + button.
          </p>
          <form onSubmit={handleSave} className="stack">
            <div>
              <label className="label">Server URL</label>
              <input className="input" placeholder="http://192.168.1.x:8096" value={form.jellyfin_url||''} onChange={e=>setForm(p=>({...p,jellyfin_url:e.target.value}))} />
            </div>
            <div>
              <label className="label">API Key</label>
              <input className="input" type="password" placeholder={form.jellyfin_api_key==='***configured***'?'(saved)':'paste key'} value={form.jellyfin_api_key==='***configured***'?'':form.jellyfin_api_key||''} onChange={e=>setForm(p=>({...p,jellyfin_api_key:e.target.value}))} />
            </div>
            {testResult && (
              <div style={{ padding:'0.75rem',borderRadius:10,background:testResult.ok?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:testResult.ok?'#10b981':'#ef4444',fontSize:'0.9rem' }}>
                {testResult.ok ? `✅ Connected to "${testResult.serverName}"` : `❌ ${testResult.error}`}
              </div>
            )}
            <div style={{ display:'flex',gap:'0.75rem' }}>
              <button type="button" className="btn btn-ghost" onClick={handleTest} disabled={testing} style={{ flex:1 }}>
                {testing?'Testing...':'🔌 Test'}
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex:2 }}>
                {saved?'✓ Saved!':'Save Settings'}
              </button>
            </div>
          </form>
        </div>

        {/* Access — only shown when Jellyfin is configured */}
        {jellyfinConfigured && (
          <div className="card" style={{ marginTop:'1rem' }}>
            <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'1rem' }}>Access</h3>

            {/* Local Login toggle */}
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem' }}>
              <div>
                <div style={{ fontWeight:700 }}>Local Login</div>
                <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>Allow signing in with JellyTime accounts</div>
              </div>
              <button
                type="button"
                onClick={() => toggleLocalLogin(!localLoginEnabled)}
                style={{
                  width:48,height:28,borderRadius:999,border:'none',cursor:'pointer',padding:3,
                  background:localLoginEnabled?'#7c3aed':'#252540',
                  transition:'background 0.2s',
                  display:'flex',alignItems:'center',
                  justifyContent:localLoginEnabled?'flex-end':'flex-start',
                }}
              >
                <div style={{ width:22,height:22,borderRadius:999,background:'white' }} />
              </button>
            </div>

            {/* Local Users list — shown when local login is enabled */}
            {localLoginEnabled && (
              <div>
                <div style={{ fontWeight:700,marginBottom:'0.75rem',fontSize:'0.95rem' }}>Local Users</div>

                {localUsers.length === 0 ? (
                  <p style={{ color:'#a0a0c0',fontSize:'0.85rem',marginBottom:'1rem' }}>No local users yet.</p>
                ) : (
                  <div className="stack" style={{ marginBottom:'1rem',gap:'0.5rem' }}>
                    {localUsers.map(u => (
                      <div key={u.id} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0.5rem 0.75rem',background:'#252540',borderRadius:10 }}>
                        <div>
                          <span style={{ fontWeight:700 }}>{u.display_name || u.username}</span>
                          {u.display_name && <span style={{ color:'#a0a0c0',fontSize:'0.8rem',marginLeft:'0.5rem' }}>@{u.username}</span>}
                        </div>
                        <button
                          className="btn btn-ghost"
                          style={{ color:'#ef4444',padding:'0.25rem 0.5rem',fontSize:'0.8rem' }}
                          onClick={() => deleteUser(u.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add user form */}
                <div style={{ borderTop:'1px solid rgba(255,255,255,0.05)',paddingTop:'1rem' }}>
                  <div style={{ fontWeight:700,marginBottom:'0.75rem',fontSize:'0.9rem' }}>Add User</div>
                  <form onSubmit={handleAddUser} className="stack" style={{ gap:'0.75rem' }}>
                    <div>
                      <label className="label">Display Name</label>
                      <input className="input" placeholder="e.g. Mom" value={newUser.display_name} onChange={e=>setNewUser(p=>({...p,display_name:e.target.value}))} />
                    </div>
                    <div>
                      <label className="label">Username</label>
                      <input className="input" value={newUser.username} onChange={e=>setNewUser(p=>({...p,username:e.target.value}))} required />
                    </div>
                    <div>
                      <label className="label">Password</label>
                      <input className="input" type="password" value={newUser.password} onChange={e=>setNewUser(p=>({...p,password:e.target.value}))} required />
                    </div>
                    <div>
                      <label className="label">Confirm Password</label>
                      <input className="input" type="password" value={newUser.confirm} onChange={e=>setNewUser(p=>({...p,confirm:e.target.value}))} required />
                    </div>
                    {userError && <p style={{ color:'#ef4444',fontSize:'0.85rem' }}>{userError}</p>}
                    <button type="submit" className="btn btn-primary" disabled={userSaving}>
                      {userSaving?'Adding...':'Add User'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notifications */}
        {'serviceWorker' in navigator && 'PushManager' in window && (
          <div className="card" style={{ marginTop:'1rem' }}>
            <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'0.5rem' }}>Notifications</h3>
            <p style={{ color:'#a0a0c0',fontSize:'0.85rem',marginBottom:'1rem' }}>
              Receive push notifications when a chore needs your approval.
              {typeof Notification === 'undefined' || notifPermission === 'denied'
                ? ' (Blocked — enable in your browser settings)'
                : ''}
            </p>
            <div style={{ display:'flex',gap:'0.75rem',flexWrap:'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={handleEnableNotifications}
                disabled={notifLoading || notifPermission === 'granted'}
                style={{ flex:1 }}
              >
                {notifLoading ? '...' : notifPermission === 'granted' ? '✓ Enabled' : 'Enable Notifications'}
              </button>
              {notifPermission === 'granted' && (
                <button
                  className="btn btn-ghost"
                  onClick={handleDisableNotifications}
                  disabled={notifLoading}
                  style={{ flex:1 }}
                >
                  Disable
                </button>
              )}
            </div>
            <p style={{ color:'#a0a0c0',fontSize:'0.75rem',marginTop:'0.75rem' }}>
              Status: {notifPermission} · iOS requires app added to Home Screen
            </p>
          </div>
        )}

        {/* How it works */}
        <div className="card" style={{ marginTop:'1rem' }}>
          <h3 style={{ fontWeight:800,marginBottom:'1rem' }}>How it works</h3>
          <div className="stack" style={{ gap:'0.75rem' }}>
            {[
              ['🔌','Connects to your Jellyfin server every 30 seconds'],
              ['⏱','Tracks actual video playback time (not just logged-in time)'],
              ['🚫','Disables the Jellyfin account when the daily limit is hit'],
              ['🧹','Kids earn bonus time by completing chores'],
              ['✅','Auto-approve chores grant time instantly; others wait for you'],
              ['🌅','Accounts re-enable automatically at midnight for a new day'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display:'flex',gap:'0.75rem',alignItems:'flex-start' }}>
                <span style={{ fontSize:'1.2rem' }}>{icon}</span>
                <span style={{ color:'#a0a0c0',fontSize:'0.9rem',lineHeight:1.5 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
