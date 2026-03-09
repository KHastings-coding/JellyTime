import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { registerPush } from '../lib/push';
import '../styles.css';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        api.get('/time/today-all'),
        api.get('/chores/pending')
      ]);
      setChildren(c.data);
      setPending(p.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') setShowPushBanner(true);
    }
  }, []);

  function logout() {
    localStorage.clear();
    navigate('/');
  }

  async function grantTime(childId, minutes) {
    await api.post('/time/grant', { childId, minutes });
    load();
  }

  async function resetTime(childId) {
    if (!window.confirm('Reset today\'s screen time for this child?')) return;
    await api.post('/time/reset', { childId });
    load();
  }

  async function reviewChore(completionId, action) {
    await api.post('/chores/review', { completionId, action });
    load();
  }

  if (loading) return <div className="page" style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>⏳</div>;

  return (
    <div className="page">
      {/* Nav */}
      <nav className="nav">
        <span className="nav-title">🎬 JellyTime</span>
        <span style={{ flex:1 }}/>
        <Link to="/parent/chores" className="btn btn-ghost" style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}>🧹 Chores</Link>
        <Link to="/parent/children" className="btn btn-ghost" style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}>👥 Kids</Link>
        <Link to="/parent/settings" className="btn btn-ghost" style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}>⚙️</Link>
        <button onClick={logout} className="btn btn-ghost" style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}>↩</button>
      </nav>

      <div style={{ padding:'1.5rem', maxWidth:900, margin:'0 auto' }}>
        <h2 style={{ fontWeight:900, fontSize:'1.6rem', marginBottom:'1.5rem' }}>Today's Overview</h2>

        {/* Push notification banner */}
        {showPushBanner && (
          <div style={{
            background:'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))',
            border:'1px solid rgba(124,58,237,0.3)',
            borderRadius:16, padding:'1rem 1.5rem', marginBottom:'1.5rem',
            display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem', flexWrap:'wrap'
          }}>
            <span style={{ fontSize:'0.95rem' }}>🔔 Enable push notifications to be alerted when chores need review.</span>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button
                className="btn btn-primary"
                style={{ padding:'0.4rem 1rem', fontSize:'0.85rem' }}
                onClick={async () => {
                  await registerPush();
                  setShowPushBanner(false);
                }}
              >
                Enable
              </button>
              <button
                className="btn btn-ghost"
                style={{ padding:'0.4rem 0.75rem', fontSize:'0.85rem' }}
                onClick={() => setShowPushBanner(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Pending approvals banner */}
        {pending.length > 0 && (
          <div style={{
            background:'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
            border:'1px solid rgba(245,158,11,0.3)',
            borderRadius:16, padding:'1rem 1.5rem', marginBottom:'1.5rem',
            display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem', flexWrap:'wrap'
          }}>
            <div>
              <span style={{ fontSize:'1.1rem', fontWeight:800 }}>⏳ {pending.length} chore{pending.length>1?'s':''} waiting for approval</span>
              <div style={{ color:'#a0a0c0', fontSize:'0.85rem', marginTop:'0.2rem' }}>
                {pending.slice(0,3).map(p => `${p.avatar_emoji} ${p.child_name}: ${p.icon} ${p.chore_name}`).join(' · ')}
              </div>
            </div>
            <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
              {pending.slice(0,3).map(p => (
                <div key={p.id} style={{ display:'flex', gap:'0.4rem' }}>
                  <button className="btn btn-green" style={{ padding:'0.4rem 0.8rem', fontSize:'0.8rem' }} onClick={() => reviewChore(p.id, 'approve')}>
                    ✓ Approve {p.icon}
                  </button>
                  <button className="btn btn-red" style={{ padding:'0.4rem 0.8rem', fontSize:'0.8rem' }} onClick={() => reviewChore(p.id, 'reject')}>
                    ✗
                  </button>
                </div>
              ))}
              {pending.length > 3 && (
                <Link to="/parent/chores" className="btn btn-ghost" style={{ padding:'0.4rem 0.8rem', fontSize:'0.8rem' }}>
                  +{pending.length-3} more
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Children cards */}
        {children.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:'3rem' }}>
            <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>👧🧒</div>
            <p style={{ color:'#a0a0c0', marginBottom:'1.5rem' }}>No children set up yet</p>
            <Link to="/parent/children" className="btn btn-primary">Add a child</Link>
          </div>
        ) : (
          <div className="stack">
            {children.map(child => {
              const pct = child.pct_used || 0;
              const danger = pct >= 80;
              const depleted = child.remaining_minutes <= 0;
              return (
                <div key={child.id} className="card" style={{ borderColor: depleted ? 'rgba(239,68,68,0.3)' : danger ? 'rgba(245,158,11,0.3)' : undefined }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
                    {/* Avatar & name */}
                    <div style={{ fontSize:'2.5rem', lineHeight:1 }}>{child.avatar_emoji}</div>
                    <div style={{ flex:1, minWidth:150 }}>
                      <div style={{ fontWeight:800, fontSize:'1.2rem' }}>{child.name}</div>
                      <div style={{ color:'#a0a0c0', fontSize:'0.85rem' }}>
                        {child.minutes_used}m used of {child.total_allowed}m
                        {child.bonus_minutes > 0 && <span style={{ color:'#10b981' }}> (+{child.bonus_minutes}m bonus)</span>}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className={`badge ${depleted ? 'badge-red' : danger ? 'badge-orange' : 'badge-green'}`}>
                      {depleted ? '🚫 Time up' : `⏱ ${child.remaining_minutes}m left`}
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                      {[15,30,60].map(m => (
                        <button key={m} className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem', fontSize:'0.8rem' }}
                          onClick={() => grantTime(child.id, m)}>
                          +{m}m
                        </button>
                      ))}
                      <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem', fontSize:'0.8rem', color:'#ef4444' }}
                        onClick={() => resetTime(child.id)}>
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="progress-bar" style={{ marginTop:'1rem' }}>
                    <div className={`progress-fill ${danger ? 'danger' : ''}`} style={{ width:`${pct}%` }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:'0.4rem', fontSize:'0.75rem', color:'#a0a0c0' }}>
                    <span>{pct}% used</span>
                    <span>Daily limit: {child.daily_limit_minutes}m</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
