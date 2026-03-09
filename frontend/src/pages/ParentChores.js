import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import '../styles.css';

const ICONS = ['✅','🛏️','🧹','🍽️','🗑️','🐾','📚','🌿','🧺','🚿','🐕','🐱','🛒','🧽','🍳','🪣'];

function ChoreModal({ chore, onSave, onClose }) {
  const [form, setForm] = useState(chore || {
    name:'', description:'', reward_minutes:15, icon:'✅', auto_approve:false, active:true
  });

  function set(k, v) { setForm(p => ({...p, [k]:v})); }

  async function handleSave(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem' }}>
      <div className="card" style={{ width:'100%',maxWidth:480 }}>
        <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'1.5rem' }}>
          {chore ? 'Edit Chore' : 'Add Chore'}
        </h3>
        <form onSubmit={handleSave} className="stack">
          <div>
            <label className="label">Icon</label>
            <div style={{ display:'flex',flexWrap:'wrap',gap:'0.5rem' }}>
              {ICONS.map(ic => (
                <button key={ic} type="button" onClick={() => set('icon', ic)}
                  style={{ fontSize:'1.5rem',background:form.icon===ic?'rgba(124,58,237,0.3)':'transparent',border:form.icon===ic?'1px solid #7c3aed':'1px solid transparent',borderRadius:8,padding:'0.3rem',cursor:'pointer' }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Chore Name</label>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} required />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} />
          </div>
          <div>
            <label className="label">Reward (minutes)</label>
            <input className="input" type="number" min="1" max="120" value={form.reward_minutes} onChange={e=>set('reward_minutes',parseInt(e.target.value))} required />
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:'0.75rem' }}>
            <input type="checkbox" id="auto" checked={!!form.auto_approve} onChange={e=>set('auto_approve',e.target.checked)} style={{ width:18,height:18,accentColor:'#7c3aed' }} />
            <label htmlFor="auto" style={{ fontWeight:700,cursor:'pointer' }}>
              Auto-approve (honor system) ⚡
            </label>
          </div>
          <p style={{ color:'#a0a0c0',fontSize:'0.8rem',marginTop:-8 }}>
            Auto-approved chores grant time instantly. Manual chores require your confirmation.
          </p>
          <div style={{ display:'flex',gap:'0.75rem',marginTop:'0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex:1 }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex:2 }}>Save Chore</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ParentChores() {
  const [templates, setTemplates] = useState([]);
  const [pending, setPending] = useState([]);
  const [modal, setModal] = useState(null); // null | 'add' | chore object
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      api.get('/chores/templates'),
      api.get('/chores/pending')
    ]);
    setTemplates(t.data);
    setPending(p.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveChore(form) {
    if (modal === 'add') {
      await api.post('/chores/templates', form);
    } else {
      await api.put(`/chores/templates/${modal.id}`, { ...form, active: modal.active });
    }
    setModal(null);
    load();
  }

  async function deleteChore(id) {
    if (!window.confirm('Remove this chore?')) return;
    await api.delete(`/chores/templates/${id}`);
    load();
  }

  async function review(id, action) {
    await api.post('/chores/review', { completionId: id, action });
    load();
  }

  return (
    <div className="page">
      <nav className="nav">
        <Link to="/parent" className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem',fontSize:'0.85rem' }}>← Dashboard</Link>
        <span className="nav-title" style={{ flex:1,textAlign:'center' }}>🧹 Chores</span>
        <button className="btn btn-primary" style={{ padding:'0.5rem 1rem',fontSize:'0.85rem' }} onClick={() => setModal('add')}>+ Add</button>
      </nav>

      <div style={{ padding:'1.5rem',maxWidth:700,margin:'0 auto' }}>
        {/* Pending approvals */}
        {pending.length > 0 && (
          <div style={{ marginBottom:'2rem' }}>
            <h3 style={{ fontWeight:800,marginBottom:'1rem',color:'#f59e0b' }}>⏳ Waiting for Approval</h3>
            <div className="stack">
              {pending.map(p => (
                <div key={p.id} className="card" style={{ borderColor:'rgba(245,158,11,0.3)',padding:'1rem 1.25rem' }}>
                  <div style={{ display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap' }}>
                    <span style={{ fontSize:'1.8rem' }}>{p.avatar_emoji}</span>
                    <div style={{ flex:1,minWidth:120 }}>
                      <div style={{ fontWeight:800 }}>{p.child_name}</div>
                      <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>{p.icon} {p.chore_name} · +{p.reward_minutes}m</div>
                    </div>
                    <div style={{ display:'flex',gap:'0.5rem' }}>
                      <button className="btn btn-green" style={{ padding:'0.5rem 1rem',fontSize:'0.85rem' }} onClick={() => review(p.id,'approve')}>✓ Approve</button>
                      <button className="btn btn-red" style={{ padding:'0.5rem 1rem',fontSize:'0.85rem' }} onClick={() => review(p.id,'reject')}>✗ Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chore templates */}
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem' }}>
          <h3 style={{ fontWeight:800 }}>Chore Library</h3>
        </div>
        <div className="stack">
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding:'1rem 1.25rem' }}>
              <div style={{ display:'flex',alignItems:'center',gap:'1rem' }}>
                <span style={{ fontSize:'2rem' }}>{t.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>{t.name}</div>
                  <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>{t.description || ''}</div>
                  <div style={{ display:'flex',gap:'0.5rem',marginTop:'0.35rem',flexWrap:'wrap' }}>
                    <span className="badge badge-green">+{t.reward_minutes}m</span>
                    {t.auto_approve ? <span className="badge badge-purple">⚡ auto</span> : <span className="badge" style={{background:'rgba(255,255,255,0.05)',color:'#a0a0c0'}}>👀 manual</span>}
                  </div>
                </div>
                <div style={{ display:'flex',gap:'0.5rem' }}>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem' }} onClick={() => setModal(t)}>Edit</button>
                  <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem',color:'#ef4444' }} onClick={() => deleteChore(t.id)}>✗</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal && <ChoreModal chore={modal==='add'?null:modal} onSave={saveChore} onClose={() => setModal(null)} />}
    </div>
  );
}
