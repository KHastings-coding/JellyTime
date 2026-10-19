import React, { useState } from 'react';
import api from '../lib/api';
import AssignmentPicker from './AssignmentPicker';
import { allKidsAssignment, assignmentLabel } from '../lib/assignments';

const REMOVAL_ICONS = ['⚠️','🚪','🛏️','👊','🗣️','📱','🍬','🙅','😤','🧸'];

function RemovalModal({ template, kids, onSave, onClose }) {
  const [form, setForm] = useState(template || { name:'', icon:'⚠️', minutes:10, assignments: allKidsAssignment(kids) });
  const [error, setError] = useState('');
  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    try { await onSave(form); } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem' }}>
      <div className="card" style={{ width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto' }}>
        <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'1.5rem' }}>{template ? 'Edit Removal' : 'Add Removal'}</h3>
        <form onSubmit={handleSave} className="stack">
          <div>
            <label className="label">Icon</label>
            <div style={{ display:'flex',flexWrap:'wrap',gap:'0.5rem' }}>
              {REMOVAL_ICONS.map(ic => (
                <button key={ic} type="button" onClick={() => set('icon', ic)}
                  style={{ fontSize:'1.5rem',background:form.icon===ic?'rgba(124,58,237,0.3)':'transparent',border:form.icon===ic?'1px solid #7c3aed':'1px solid transparent',borderRadius:8,padding:'0.3rem',cursor:'pointer' }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Reason shown to the kid</label>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Left room at night" required />
          </div>
          <div>
            <label className="label">Minutes removed (default)</label>
            <input className="input" type="number" min="1" max="1440" value={form.minutes} onChange={e=>set('minutes',parseInt(e.target.value))} required />
          </div>
          <AssignmentPicker kids={kids} value={form.assignments} onChange={v=>set('assignments', v)} defaultMinutes={form.minutes} />
          {error && <div style={{ color:'#ef4444',fontSize:'0.85rem' }}>{error}</div>}
          <div style={{ display:'flex',gap:'0.75rem',marginTop:'0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex:1 }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex:2 }}>Save Removal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RemovalLibrary({ templates, kids, reload }) {
  const [modal, setModal] = useState(null); // null | 'add' | template

  async function save(form) {
    if (modal === 'add') await api.post('/removals/templates', form);
    else await api.put(`/removals/templates/${modal.id}`, form);
    setModal(null);
    reload();
  }

  async function remove(id) {
    if (!window.confirm('Remove this template? Past removals stay in the history.')) return;
    await api.delete(`/removals/templates/${id}`);
    reload();
  }

  return (
    <div>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem' }}>
        <h3 style={{ fontWeight:800 }}>Removal Library</h3>
        <button className="btn btn-primary" style={{ padding:'0.4rem 0.9rem',fontSize:'0.85rem' }} onClick={() => setModal('add')}>+ Add removal</button>
      </div>
      {templates.length === 0 ? (
        <div className="card" style={{ textAlign:'center',padding:'2rem',color:'#a0a0c0' }}>
          No removals yet. Add one for things that happen often, like leaving their room at night.
        </div>
      ) : (
        <div className="stack">
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding:'1rem 1.25rem' }}>
              <div style={{ display:'flex',alignItems:'center',gap:'1rem' }}>
                <span style={{ fontSize:'2rem' }}>{t.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>{t.name}</div>
                  <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>{assignmentLabel(t.assignments, kids)}</div>
                  <div style={{ marginTop:'0.35rem' }}><span className="badge badge-red">−{t.minutes}m</span></div>
                </div>
                <div style={{ display:'flex',gap:'0.5rem' }}>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem' }} onClick={() => setModal(t)}>Edit</button>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem',color:'#ef4444' }} onClick={() => remove(t.id)}>✗</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && <RemovalModal template={modal === 'add' ? null : modal} kids={kids} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}
