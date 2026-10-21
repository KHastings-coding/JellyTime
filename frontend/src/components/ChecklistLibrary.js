import React, { useState } from 'react';
import api from '../lib/api';
import AssignmentPicker from './AssignmentPicker';
import ScheduleEditor from './ScheduleEditor';
import { assignmentLabel } from '../lib/assignments';
import { scheduleLabel, formatTime12 } from '../lib/schedule';

const CHECKLIST_ICONS = ['📝','🌅','🌙','🪥','🎒','🧸','🛁','🍽️','📚','🧹','🐕','✅'];
const MAX_ITEMS = 20;

function ChecklistModal({ template, kids, onSave, onClose }) {
  const [form, setForm] = useState(() => template ? {
    name: template.name, icon: template.icon, reward_minutes: template.reward_minutes,
    auto_approve: !!template.auto_approve, deadline: template.deadline, schedule: template.schedule,
    active: template.active, items: template.items.map(i => i.label), assignments: template.assignments,
  } : {
    name: '', icon: '📝', reward_minutes: 15, auto_approve: false, deadline: null,
    schedule: { type: 'daily' }, active: true, items: [''], assignments: [],
  });
  const [error, setError] = useState('');
  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function setItem(i, v) { set('items', form.items.map((x, idx) => idx === i ? v : x)); }
  function moveItem(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= form.items.length) return;
    const items = [...form.items];
    [items[i], items[j]] = [items[j], items[i]];
    set('items', items);
  }

  async function handleSave(e) {
    e.preventDefault();
    try { await onSave(form); } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }

  const small = { padding: '0.4rem 0.6rem', fontSize: '0.8rem' };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem' }}>
      <div className="card" style={{ width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto' }}>
        <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'1.5rem' }}>{template ? 'Edit Checklist' : 'Add Checklist'}</h3>
        <form onSubmit={handleSave} className="stack">
          <div>
            <label className="label">Icon</label>
            <div style={{ display:'flex',flexWrap:'wrap',gap:'0.5rem' }}>
              {CHECKLIST_ICONS.map(ic => (
                <button key={ic} type="button" onClick={() => set('icon', ic)}
                  style={{ fontSize:'1.5rem',background:form.icon===ic?'rgba(124,58,237,0.3)':'transparent',border:form.icon===ic?'1px solid #7c3aed':'1px solid transparent',borderRadius:8,padding:'0.3rem',cursor:'pointer' }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} maxLength={60} onChange={e=>set('name',e.target.value)} placeholder="Morning routine" required />
          </div>
          <div>
            <label className="label">Bonus minutes</label>
            <input className="input" type="number" min="0" max="600" value={Number.isNaN(form.reward_minutes) ? '' : form.reward_minutes}
              onChange={e=>set('reward_minutes', parseInt(e.target.value))} required />
          </div>
          <div>
            <label className="label">Items</label>
            <div className="stack" style={{ gap:'0.5rem' }}>
              {form.items.map((label, i) => (
                <div key={i} style={{ display:'flex',gap:'0.35rem',alignItems:'center' }}>
                  <input className="input" value={label} maxLength={100} onChange={e=>setItem(i, e.target.value)} placeholder="Brush teeth" required />
                  <button type="button" className="btn btn-ghost" style={small} disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</button>
                  <button type="button" className="btn btn-ghost" style={small} disabled={i === form.items.length - 1} onClick={() => moveItem(i, 1)}>↓</button>
                  <button type="button" className="btn btn-ghost" style={{ ...small, color:'#ef4444' }} disabled={form.items.length <= 1}
                    onClick={() => set('items', form.items.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" style={{ marginTop:'0.5rem',fontSize:'0.85rem' }}
              disabled={form.items.length >= MAX_ITEMS} onClick={() => set('items', [...form.items, ''])}>+ Add item</button>
          </div>
          <ScheduleEditor value={form.schedule} onChange={v => set('schedule', v)} />
          <div>
            <label style={{ display:'flex',alignItems:'center',gap:'0.75rem',cursor:'pointer' }}>
              <input type="checkbox" checked={form.deadline !== null} style={{ width:18,height:18,accentColor:'#7c3aed' }}
                onChange={e => set('deadline', e.target.checked ? '20:00' : null)} />
              <span style={{ fontWeight:700 }}>Must be done by</span>
            </label>
            {form.deadline !== null && (
              <input className="input" type="time" style={{ marginTop:'0.5rem' }} value={form.deadline}
                onChange={e => set('deadline', e.target.value || null)} required />
            )}
          </div>
          <label style={{ display:'flex',alignItems:'center',gap:'0.75rem',cursor:'pointer' }}>
            <input type="checkbox" checked={form.auto_approve} style={{ width:18,height:18,accentColor:'#7c3aed' }}
              onChange={e => set('auto_approve', e.target.checked)} />
            <span style={{ fontWeight:700 }}>⚡ Auto-approve when finished</span>
          </label>
          <AssignmentPicker kids={kids} value={form.assignments} onChange={v=>set('assignments', v)} defaultMinutes={form.reward_minutes} range={{ min: 0, max: 600 }} />
          {error && <div style={{ color:'#ef4444',fontSize:'0.85rem' }}>{error}</div>}
          <div style={{ display:'flex',gap:'0.75rem',marginTop:'0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex:1 }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex:2 }}>Save Checklist</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChecklistLibrary({ templates, kids, reload }) {
  const [modal, setModal] = useState(null); // null | 'add' | template
  const [error, setError] = useState('');

  async function save(form) {
    if (modal === 'add') await api.post('/checklists/templates', form);
    else await api.put(`/checklists/templates/${modal.id}`, form);
    setModal(null);
    reload();
  }

  async function remove(t) {
    if (!window.confirm(`Delete ${t.name}? Past results are kept.`)) return;
    setError('');
    try {
      await api.delete(`/checklists/templates/${t.id}`);
      reload();
    } catch (err) { setError(err.response?.data?.error || 'Could not delete'); }
  }

  return (
    <div>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem' }}>
        <h3 style={{ fontWeight:800 }}>Checklists</h3>
        <button className="btn btn-primary" style={{ padding:'0.4rem 0.9rem',fontSize:'0.85rem' }} onClick={() => setModal('add')}>+ Add checklist</button>
      </div>
      {error && <div style={{ color:'#ef4444',fontSize:'0.85rem',marginBottom:'0.75rem' }}>{error}</div>}
      {templates.length === 0 ? (
        <div className="card" style={{ textAlign:'center',padding:'2rem',color:'#a0a0c0' }}>
          No checklists yet. Add one for routines like getting ready in the morning.
        </div>
      ) : (
        <div className="stack">
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding:'1rem 1.25rem' }}>
              <div style={{ display:'flex',alignItems:'center',gap:'1rem' }}>
                <span style={{ fontSize:'2rem' }}>{t.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>{t.name}</div>
                  <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>
                    {scheduleLabel(t.schedule)}{t.deadline ? ` · by ${formatTime12(t.deadline)}` : ''}
                  </div>
                  <div style={{ color:'#a0a0c0',fontSize:'0.8rem' }}>{assignmentLabel(t.assignments, kids)}</div>
                  <div style={{ display:'flex',gap:'0.5rem',marginTop:'0.35rem',flexWrap:'wrap' }}>
                    <span className="badge badge-green">+{t.reward_minutes} min</span>
                    {t.auto_approve && <span className="badge badge-purple">⚡ auto</span>}
                  </div>
                  {t.assignments.length > 0 && (
                    <div style={{ color:'#a0a0c0',fontSize:'0.8rem',marginTop:'0.35rem' }}>
                      {t.assignments.map(a => {
                        const kid = kids.find(k => k.id === a.childId);
                        const s = t.streaks?.[a.childId] || { streak: 0, best: 0 };
                        return <div key={a.childId}>{kid ? kid.name : 'Removed kid'}: 🔥 {s.streak} · best {s.best}</div>;
                      })}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex',gap:'0.5rem' }}>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem' }} onClick={() => setModal(t)}>Edit</button>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem',color:'#ef4444' }} onClick={() => remove(t)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && <ChecklistModal template={modal === 'add' ? null : modal} kids={kids} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}
