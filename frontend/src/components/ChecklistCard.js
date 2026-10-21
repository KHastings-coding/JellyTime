import React from 'react';

export function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `Done by ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

const pill = { padding:'0.15rem 0.6rem', borderRadius:999, fontSize:'0.8rem', fontWeight:800 };

export default function ChecklistCard({ run, busy, error, onTick, onSubmit }) {
  const items = run.items || [];
  const doneCount = items.filter(i => i.done).length;
  const open = run.status === 'open';
  const deadline = formatDeadline(run.deadline_at);

  return (
    <div className="card" style={{ padding:'1.25rem', opacity: run.status === 'missed' ? 0.6 : 1 }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'0.75rem' }}>
        <span style={{ fontSize:'2.2rem' }}>{run.icon || '📝'}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:'1.1rem' }}>{run.name}</div>
          <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:'0.5rem', marginTop:'0.4rem' }}>
            <span style={{ ...pill, background:'rgba(16,185,129,0.15)', color:'#10b981' }}>+{run.reward_minutes} min</span>
            <span style={{ color:'#a0a0c0', fontSize:'0.85rem', fontWeight:700 }}>{doneCount} of {items.length}</span>
            {run.streak >= 2 && <span style={{ ...pill, background:'rgba(245,158,11,0.15)', color:'#f59e0b' }}>🔥 {run.streak} in a row</span>}
          </div>
          {deadline && <div style={{ color:'#a0a0c0', fontSize:'0.85rem', marginTop:'0.3rem' }}>{deadline}</div>}
        </div>
      </div>

      {run.review_note && (run.status === 'open' || run.status === 'missed') && (
        <div style={{ color:'#f59e0b', fontSize:'0.9rem', fontWeight:700, marginBottom:'0.75rem' }}>
          {run.status === 'open' ? `Grown-up says: ${run.review_note}` : run.review_note}
        </div>
      )}

      {run.status !== 'missed' && (
        <div className="stack" style={{ gap:'0.5rem' }}>
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={item.done}
              disabled={!open || busy}
              onClick={() => onTick(run, item)}
              style={{
                display:'flex', alignItems:'center', gap:'1rem', width:'100%', minHeight:64,
                padding:'0.75rem 1rem', borderRadius:14, textAlign:'left', color:'white',
                fontSize:'1.15rem', fontWeight:700, fontFamily:'inherit',
                cursor: open ? 'pointer' : 'default',
                background: item.done ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)',
                border: `2px solid ${item.done ? '#10b981' : 'rgba(255,255,255,0.15)'}`,
              }}
            >
              <span style={{
                width:40, height:40, borderRadius:10, flexShrink:0, display:'flex',
                alignItems:'center', justifyContent:'center', fontSize:'1.6rem',
                background: item.done ? '#10b981' : 'transparent',
                border: `3px solid ${item.done ? '#10b981' : '#a0a0c0'}`,
              }}>{item.done ? '✓' : ''}</span>
              <span style={{ flex:1, textDecoration: item.done && !open ? 'none' : undefined }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ color:'#ef4444', fontWeight:700, marginTop:'0.75rem' }}>{error}</div>}

      {open && (
        <button
          className="btn btn-primary"
          style={{ width:'100%', marginTop:'1rem', minHeight:56, fontSize:'1.2rem' }}
          disabled={!run.can_submit || busy}
          onClick={() => onSubmit(run)}
        >
          Submit
        </button>
      )}
      {run.status === 'submitted' && (
        <div style={{ marginTop:'1rem', textAlign:'center', color:'#06b6d4', fontWeight:800 }}>Waiting for a grown-up 👀</div>
      )}
      {run.status === 'approved' && (
        <div style={{ marginTop:'1rem', textAlign:'center', color:'#10b981', fontWeight:800, fontSize:'1.1rem' }}>Done! +{run.reward_minutes} min 🎉</div>
      )}
      {run.status === 'missed' && (
        <div style={{ textAlign:'center', color:'#a0a0c0', fontWeight:800 }}>Missed today</div>
      )}
    </div>
  );
}
