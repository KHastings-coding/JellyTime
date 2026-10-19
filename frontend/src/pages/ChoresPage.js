import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import '../styles.css';

export default function ChoresPage() {
  const { childId } = useParams();
  const [chores, setChores] = useState([]);
  const [childName, setChildName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [choresRes, statusRes] = await Promise.all([
        api.get(`/chores/child/${childId}`),
        api.get(`/children/${childId}/status`)
      ]);
      setChores(choresRes.data);
      setChildName(statusRes.data.name);
    } catch {}
    setLoading(false);
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  function showToast(msg, type='success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function submitChore(choreId) {
    setSubmitting(choreId);
    try {
      const r = await api.post('/chores/submit', { childId, choreId });
      if (r.data.auto_approved) {
        showToast(`🎉 +${r.data.reward_minutes} minutes earned!`);
      } else {
        showToast('✅ Submitted! Waiting for parent approval.', 'info');
      }
      load();
    } catch (e) {
      showToast(e.response?.data?.error || 'Something went wrong', 'error');
    }
    setSubmitting(null);
  }

  if (loading) return (
    <div className="page" style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>⏳</div>
  );

  const available = chores.filter(c => c.can_submit);
  const done = chores.filter(c => c.completions && c.completions.length > 0);

  return (
    <div className="page">
      <nav className="nav">
        <button onClick={() => navigate(`/child/${childId}`)} className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem', fontSize:'0.85rem' }}>←</button>
        <span style={{ fontFamily:'Fredoka One, cursive', fontSize:'1.3rem', color:'#a855f7', flex:1, textAlign:'center' }}>
          Earn Screen Time
        </span>
        <div style={{ width:60 }} />
      </nav>

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', top:80, left:'50%', transform:'translateX(-50%)',
          background: toast.type==='error' ? '#ef4444' : toast.type==='info' ? '#06b6d4' : '#10b981',
          color:'white', padding:'0.75rem 1.5rem', borderRadius:12,
          fontWeight:700, zIndex:999, boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
          fontSize:'1rem', whiteSpace:'nowrap', maxWidth:'90vw', textAlign:'center'
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding:'1.5rem', maxWidth:500, margin:'0 auto' }}>
        <p style={{ color:'#a0a0c0', marginBottom:'1.5rem', fontSize:'0.95rem' }}>
          Hey {childName}! Complete chores below to earn extra screen time. ✨
        </p>

        {/* Available chores */}
        {available.length > 0 && (
          <>
            <h3 style={{ fontWeight:800, marginBottom:'1rem', color:'#a0a0c0', fontSize:'0.85rem', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Available today
            </h3>
            <div className="stack" style={{ marginBottom:'2rem' }}>
              {available.map(chore => (
                <div key={chore.id} className="card" style={{ padding:'1.25rem' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
                    <span style={{ fontSize:'2.2rem' }}>{chore.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:800, fontSize:'1.05rem' }}>{chore.name}</div>
                      {chore.description && <div style={{ color:'#a0a0c0', fontSize:'0.85rem', marginTop:'0.2rem' }}>{chore.description}</div>}
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'0.4rem' }}>
                        <span style={{ background:'rgba(16,185,129,0.15)', color:'#10b981', padding:'0.15rem 0.6rem', borderRadius:999, fontSize:'0.8rem', fontWeight:800 }}>
                          +{chore.reward_minutes} min
                        </span>
                        {chore.auto_approve ? (
                          <span style={{ color:'#a0a0c0', fontSize:'0.75rem' }}>⚡ instant</span>
                        ) : (
                          <span style={{ color:'#a0a0c0', fontSize:'0.75rem' }}>👀 needs approval</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ padding:'0.6rem 1rem', fontSize:'0.9rem', minWidth:80 }}
                      onClick={() => submitChore(chore.id)}
                      disabled={submitting === chore.id}
                    >
                      {submitting === chore.id ? '...' : 'Done!'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Completed today */}
        {done.length > 0 && (
          <>
            <h3 style={{ fontWeight:800, marginBottom:'1rem', color:'#a0a0c0', fontSize:'0.85rem', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Done today
            </h3>
            <div className="stack">
              {done.map(chore => {
                const activeComps = chore.completions.filter(c => c.status !== 'rejected');
                const limit = chore.max_completions;
                const countLabel = limit === 0
                  ? `Done ${activeComps.length}× today`
                  : activeComps.length > 1
                    ? `${activeComps.length} / ${limit} done`
                    : null;
                return (
                  <div key={chore.id} className="card" style={{ padding:'1.25rem', opacity: chore.can_submit ? 1 : 0.7 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
                      <span style={{ fontSize:'2.2rem' }}>{chore.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:800 }}>{chore.name}</div>
                        {countLabel && <div style={{ color:'#a0a0c0', fontSize:'0.8rem', marginBottom:'0.25rem' }}>{countLabel}</div>}
                        <div style={{ display:'flex', flexWrap:'wrap', gap:'0.35rem', marginTop:'0.3rem' }}>
                          {chore.completions.map(c => (
                            <span key={c.id} className={c.status === 'approved' ? 'badge badge-green' : c.status === 'pending' ? 'badge badge-orange' : 'badge badge-red'}>
                              {c.status === 'approved' ? `✓ +${c.reward_minutes}m` : c.status === 'pending' ? '⏳ Pending' : '✗ Rejected'}
                            </span>
                          ))}
                        </div>
                      </div>
                      {chore.can_submit && (
                        <button
                          className="btn btn-primary"
                          style={{ padding:'0.6rem 1rem', fontSize:'0.9rem', minWidth:80 }}
                          onClick={() => submitChore(chore.id)}
                          disabled={submitting === chore.id}
                        >
                          {submitting === chore.id ? '...' : 'Done!'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {available.length === 0 && done.length === 0 && (
          <div className="card" style={{ textAlign:'center', padding:'2.5rem' }}>
            <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>🎊</div>
            <div style={{ fontWeight:800, fontSize:'1.1rem' }}>No chores today!</div>
            <div style={{ color:'#a0a0c0', marginTop:'0.5rem' }}>Ask a parent to add some chores.</div>
          </div>
        )}
      </div>
    </div>
  );
}
