import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { balanceBreakdown, formatAdjustment, formatTime } from '../lib/balance';
import '../styles.css';

const QUICK_ADD = [15, 30, 60];
const UNDOABLE = ['grant', 'removal'];

export default function AdjustTimePage() {
  const { childId } = useParams();
  const [child, setChild] = useState(null);
  const [removals, setRemovals] = useState([]);
  const [changes, setChanges] = useState([]);
  const [mode, setMode] = useState('add'); // 'add' | 'remove'
  const [custom, setCustom] = useState({ minutes:'', reason:'' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const [all, r, adj] = await Promise.all([
      api.get('/time/today-all'),
      api.get('/removals/templates', { params: { childId } }),
      api.get(`/time/adjustments/${childId}`, { params: { days: 1 } }),
    ]);
    setChild(all.data.find(c => String(c.id) === childId) || null);
    setRemovals(r.data);
    setChanges(adj.data.adjustments);
  }, [childId]);

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    load()
      .catch(e => setLoadError(e.response?.data?.error || ''))
      .finally(() => setLoading(false));
  }, [load]);

  async function run(action) {
    setError('');
    setBusy(true);
    try { await action(); }
    catch (e) {
      setError(e.response?.data?.error || 'Something went wrong');
      setBusy(false);
      return false;
    }
    // The change is saved from here on; a failed refresh must not look like a failed save.
    try { await load(); }
    catch { setError("Saved, but couldn't refresh. Reload the page."); }
    setBusy(false);
    return true;
  }

  const adjust = body => run(() => api.post('/time/adjust', { childId, ...body }));
  const undo = id => run(() => api.delete(`/time/adjust/${id}`));

  function resetUsage() {
    if (!window.confirm("Reset today's watched time to 0? Earned and removed time stay as they are.")) return;
    run(() => api.post('/time/reset', { childId }));
  }

  async function submitCustom(e) {
    e.preventDefault();
    const ok = await adjust({ kind: mode === 'add' ? 'grant' : 'removal', minutes: parseInt(custom.minutes), reason: custom.reason });
    if (ok) setCustom({ minutes:'', reason:'' });
  }

  if (loading) return <div className="page" style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>⏳</div>;

  if (!child) return (
    <div className="page">
      <nav className="nav">
        <Link to="/parent" className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem',fontSize:'0.85rem' }}>← Dashboard</Link>
      </nav>
      <div className="card" style={{ maxWidth:600,margin:'1.5rem auto',textAlign:'center' }}>
        <h3 style={{ fontWeight:800,marginBottom:'0.5rem' }}>Couldn't load this kid</h3>
        {loadError && <p style={{ color:'#ef4444',fontSize:'0.9rem' }}>{loadError}</p>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <nav className="nav">
        <Link to="/parent" className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem',fontSize:'0.85rem' }}>← Dashboard</Link>
        <span className="nav-title" style={{ flex:1,textAlign:'center' }}>{child.avatar_emoji} {child.name}</span>
        <div style={{ width:60 }} />
      </nav>

      <div className="stack" style={{ padding:'1.5rem',maxWidth:600,margin:'0 auto' }}>
        <div className="card" style={{ textAlign:'center' }}>
          <div style={{ fontSize:'2rem',fontWeight:900 }}>{child.remaining_minutes}m left</div>
          <div style={{ color:'#a0a0c0',fontSize:'0.9rem' }}>{balanceBreakdown(child)} · {child.minutes_used}m watched</div>
        </div>

        <div className="card stack">
          <div style={{ display:'flex',gap:'0.5rem' }}>
            <button className={`btn ${mode==='add'?'btn-green':'btn-ghost'}`} style={{ flex:1 }} onClick={()=>setMode('add')}>＋ Add time</button>
            <button className={`btn ${mode==='remove'?'btn-red':'btn-ghost'}`} style={{ flex:1 }} onClick={()=>setMode('remove')}>－ Remove time</button>
          </div>

          <div style={{ display:'flex',gap:'0.5rem',flexWrap:'wrap' }}>
            {mode === 'add' && QUICK_ADD.map(m => (
              <button key={m} disabled={busy} className="btn btn-ghost" onClick={()=>adjust({ kind:'grant', minutes:m })}>+{m}m</button>
            ))}
            {mode === 'remove' && removals.length === 0 && (
              <span style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>
                No removal templates for {child.name} yet. Add some under Chores → Removals, or use a custom amount below.
              </span>
            )}
            {mode === 'remove' && removals.map(t => (
              <button key={t.id} disabled={busy} className="btn btn-ghost" onClick={()=>adjust({ kind:'removal', templateId:t.id })}>
                {t.icon} {t.name} −{t.minutes}m
              </button>
            ))}
          </div>

          <form onSubmit={submitCustom} style={{ display:'flex',gap:'0.5rem',flexWrap:'wrap' }}>
            <input className="input" style={{ width:110 }} type="number" min="1" max="1440" placeholder="Minutes"
              value={custom.minutes} onChange={e=>setCustom(p=>({...p,minutes:e.target.value}))} required />
            <input className="input" style={{ flex:1,minWidth:160 }}
              placeholder={mode==='add' ? 'Reason (optional)' : 'Reason (required)'}
              value={custom.reason} onChange={e=>setCustom(p=>({...p,reason:e.target.value}))} required={mode==='remove'} />
            <button type="submit" disabled={busy} className={`btn ${mode==='add'?'btn-green':'btn-red'}`}>{mode==='add'?'Add':'Remove'}</button>
          </form>
          {error && <div style={{ color:'#ef4444',fontSize:'0.85rem' }}>{error}</div>}
        </div>

        <div className="card">
          <h3 style={{ fontWeight:800,marginBottom:'0.75rem' }}>Today's changes</h3>
          {changes.length === 0 ? (
            <p style={{ color:'#a0a0c0',fontSize:'0.9rem' }}>No changes yet today.</p>
          ) : (
            <div className="stack" style={{ gap:'0.6rem' }}>
              {changes.map(a => (
                <div key={a.id} style={{ display:'flex',alignItems:'center',gap:'0.75rem' }}>
                  <span style={{ fontSize:'1.3rem' }}>{a.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700 }}>{a.reason}</div>
                    <div style={{ color:'#a0a0c0',fontSize:'0.8rem' }}>{formatTime(a.created_at)}</div>
                  </div>
                  <span className={`badge ${a.minutes > 0 ? 'badge-green' : 'badge-red'}`}>{formatAdjustment(a)}</span>
                  {UNDOABLE.includes(a.kind) && (
                    <button disabled={busy} className="btn btn-ghost" style={{ padding:'0.3rem 0.6rem',fontSize:'0.8rem' }} onClick={()=>undo(a.id)}>Undo</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-ghost" style={{ color:'#ef4444' }} onClick={resetUsage}>Reset today's watched time</button>
      </div>
    </div>
  );
}
