import React, { useState } from 'react';
import api from '../lib/api';

const NOTE_MAX = 200;

function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLabel(date) {
  if (!date || date === localDay()) return null;
  if (date === localDay(-1)) return 'from yesterday';
  return `from ${date}`;
}

function RunCard({ run, busy, onReview }) {
  const [mode, setMode] = useState(null); // null | 'retry' | 'missed'
  const [note, setNote] = useState('');
  const label = dateLabel(run.date);

  function confirm() {
    onReview(run, mode, note.trim());
  }

  return (
    <div className="card" style={{ borderColor:'rgba(245,158,11,0.3)', padding:'1rem 1.25rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
        <span style={{ fontSize:'1.8rem' }}>{run.icon}</span>
        <div style={{ flex:1, minWidth:120 }}>
          <div style={{ fontWeight:800 }}>{run.child_name}</div>
          <div style={{ color:'#a0a0c0', fontSize:'0.85rem' }}>
            {run.name} · +{run.reward_minutes} min{label ? ` · ${label}` : ''}
          </div>
        </div>
      </div>
      <ul style={{ listStyle:'none', margin:'0.75rem 0', padding:0, fontSize:'0.9rem' }}>
        {(run.items || []).map(it => (
          <li key={it.id} style={{ padding:'0.15rem 0' }}>✓ {it.label}</li>
        ))}
      </ul>
      {run.review_note && (
        <div style={{ color:'#a0a0c0', fontSize:'0.8rem', marginBottom:'0.5rem' }}>{run.review_note}</div>
      )}
      {mode ? (
        <div className="stack">
          <textarea className="input" rows={2} maxLength={NOTE_MAX} value={note} disabled={busy}
            placeholder={mode === 'retry' ? 'Note for them (optional)' : 'Why was it missed? (optional)'}
            onChange={e => setNote(e.target.value)} />
          <div style={{ color:'#a0a0c0', fontSize:'0.75rem', textAlign:'right' }}>{note.length}/{NOTE_MAX}</div>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button className="btn btn-ghost" disabled={busy} style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}
              onClick={() => { setMode(null); setNote(''); }}>Cancel</button>
            <button className={`btn ${mode === 'retry' ? 'btn-primary' : 'btn-red'}`} disabled={busy}
              style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }} onClick={confirm}>
              {mode === 'retry' ? 'Confirm retry' : 'Confirm missed'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          <button className="btn btn-green" disabled={busy} style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}
            onClick={() => onReview(run, 'approve')}>✓ Approve</button>
          {run.can_retry && (
            <button className="btn btn-ghost" disabled={busy} style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}
              onClick={() => setMode('retry')}>↺ Let them retry</button>
          )}
          <button className="btn btn-red" disabled={busy} style={{ padding:'0.5rem 1rem', fontSize:'0.85rem' }}
            onClick={() => setMode('missed')}>✗ Missed</button>
        </div>
      )}
    </div>
  );
}

export default function PendingChecklists({ runs, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  if (!runs || runs.length === 0) return null;

  async function review(run, action, note) {
    setBusyId(run.id);
    setError('');
    try {
      await api.post(`/checklists/runs/${run.id}/review`, note ? { action, note } : { action });
      await onChange();
    } catch (err) {
      if (err.response?.status === 409) {
        await onChange();
      } else {
        setError(err.response?.data?.error || 'Could not save that review');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ marginBottom:'2rem' }}>
      <h3 style={{ fontWeight:800, marginBottom:'1rem', color:'#f59e0b' }}>📝 Checklists to Review</h3>
      {error && <div style={{ color:'#ef4444', fontSize:'0.85rem', marginBottom:'0.75rem' }}>{error}</div>}
      <div className="stack">
        {runs.map(run => (
          <RunCard key={run.id} run={run} busy={busyId !== null} onReview={review} />
        ))}
      </div>
    </div>
  );
}
