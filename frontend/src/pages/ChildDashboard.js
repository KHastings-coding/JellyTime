import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { balanceBreakdown, formatAdjustment, formatTime } from '../lib/balance';
import '../styles.css';

function CircleTimer({ pct, remaining, total }) {
  const r = 80;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct / 100, 1));
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#7c3aed';

  const hrs = Math.floor(remaining / 60);
  const mins = remaining % 60;

  return (
    <div style={{ position:'relative', width:200, height:200, margin:'0 auto' }}>
      <svg width="200" height="200" style={{ transform:'rotate(-90deg)' }}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="#252540" strokeWidth="12" />
        <circle
          cx="100" cy="100" r={r} fill="none"
          stroke={color} strokeWidth="12"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition:'stroke-dashoffset 0.5s ease, stroke 0.3s' }}
        />
      </svg>
      <div style={{
        position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        textAlign:'center', lineHeight:1.2
      }}>
        {remaining <= 0 ? (
          <>
            <div style={{ fontSize:'2rem' }}>🚫</div>
            <div style={{ fontSize:'0.9rem', color:'#ef4444', fontWeight:800 }}>Time's up!</div>
          </>
        ) : (
          <>
            <div style={{ fontFamily:'Fredoka One, cursive', fontSize: hrs > 0 ? '1.8rem' : '2.2rem', color:'white' }}>
              {hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}
            </div>
            <div style={{ fontSize:'0.75rem', color:'#a0a0c0' }}>remaining</div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ChildDashboard() {
  const { childId } = useParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/children/${childId}/status`);
      setStatus(r.data);
    } catch {}
    setLoading(false);
  }, [childId]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  if (loading || !status) return (
    <div className="page" style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>⏳</div>
  );

  const pct = status.total_allowed > 0 ? (status.minutes_used / status.total_allowed) * 100 : 0;

  return (
    <div className="page">
      {/* Nav */}
      <nav className="nav">
        <button onClick={() => navigate('/child-select')} className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem', fontSize:'0.85rem' }}>←</button>
        <span style={{ fontFamily:'Fredoka One, cursive', fontSize:'1.3rem', color:'#a855f7', flex:1, textAlign:'center' }}>
          {status.avatar_emoji} {status.name}
        </span>
        <div style={{ width:60 }} />
      </nav>

      <div style={{ padding:'1.5rem', maxWidth:480, margin:'0 auto' }}>
        {/* Timer circle */}
        <div className="card" style={{ marginBottom:'1rem', textAlign:'center', padding:'2rem' }}>
          <CircleTimer pct={pct} remaining={status.remaining_minutes} total={status.total_allowed} />

          <div style={{ marginTop:'1.25rem', color:'#a0a0c0', fontSize:'0.85rem' }}>
            {status.minutes_used}m watched · {balanceBreakdown(status)}
          </div>
        </div>

        {/* Progress bar detail */}
        <div className="card" style={{ marginBottom:'1rem', padding:'1rem 1.25rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.85rem', color:'#a0a0c0', marginBottom:'0.5rem' }}>
            <span>Daily screen time</span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="progress-bar">
            <div className={`progress-fill ${pct >= 80 ? 'danger' : ''}`} style={{ width:`${Math.min(pct, 100)}%` }} />
          </div>
        </div>

        {/* Earn more time CTA */}
        <Link to={`/child/${childId}/chores`} style={{ textDecoration:'none' }}>
          <div style={{
            background:'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.2))',
            border:'1px solid rgba(124,58,237,0.3)',
            borderRadius:16,
            padding:'1.25rem 1.5rem',
            display:'flex',
            alignItems:'center',
            gap:'1rem',
            cursor:'pointer',
            transition:'all 0.2s',
            marginBottom:'1rem',
          }}>
            <span style={{ fontSize:'2.5rem' }}>🧹</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:'1.1rem' }}>Do chores, earn time!</div>
              <div style={{ color:'#a0a0c0', fontSize:'0.85rem' }}>Complete chores to get more screen time</div>
            </div>
            {status.pending_chores > 0 && (
              <div style={{ background:'#f59e0b', color:'#000', borderRadius:999, width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:900 }}>
                {status.pending_chores}
              </div>
            )}
            <span style={{ color:'#7c3aed', fontSize:'1.3rem' }}>→</span>
          </div>
        </Link>

        {/* Recent changes */}
        {status.recent?.length > 0 && (
          <div className="card" style={{ marginBottom:'1rem', padding:'1rem 1.25rem' }}>
            <div style={{ fontWeight:800, marginBottom:'0.75rem' }}>Recent changes</div>
            <div className="stack" style={{ gap:'0.6rem' }}>
              {status.recent.map(a => (
                <div key={a.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  <span style={{ fontSize:'1.3rem' }}>{a.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700 }}>{a.reason}</div>
                    <div style={{ color:'#a0a0c0', fontSize:'0.75rem' }}>
                      {a.date === status.date ? 'Today' : a.date} · {formatTime(a.created_at)}
                    </div>
                  </div>
                  <span className={`badge ${a.minutes > 0 ? 'badge-green' : 'badge-red'}`}>{formatAdjustment(a)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time up message */}
        {status.remaining_minutes <= 0 && (
          <div className="card" style={{ textAlign:'center', padding:'1.5rem', borderColor:'rgba(239,68,68,0.3)' }}>
            <div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>😔</div>
            <div style={{ fontWeight:800, marginBottom:'0.5rem' }}>Screen time is done for today</div>
            <div style={{ color:'#a0a0c0', fontSize:'0.9rem' }}>Do some chores to earn more time, or ask a parent!</div>
          </div>
        )}
      </div>
    </div>
  );
}
