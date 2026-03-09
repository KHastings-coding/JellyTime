import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import '../styles.css';

const AVATARS = ['🧒','👧','👦','🧑','👶','🦊','🐼','🦁','🐸','🐧','🦄','🐙'];

function ChildModal({ child, jellyfinUsers, onSave, onClose }) {
  const [form, setForm] = useState(child || {
    jellyfin_user_id:'', name:'', avatar_emoji:'🧒', daily_limit_minutes:60
  });
  function set(k,v) { setForm(p=>({...p,[k]:v})); }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem' }}>
      <div className="card" style={{ width:'100%',maxWidth:460 }}>
        <h3 style={{ fontWeight:800,fontSize:'1.2rem',marginBottom:'1.5rem' }}>
          {child ? 'Edit Child' : 'Add Child'}
        </h3>
        <form onSubmit={e=>{e.preventDefault();onSave(form);}} className="stack">
          {!child && (
            <div>
              <label className="label">Jellyfin Account</label>
              <select className="input" value={form.jellyfin_user_id} onChange={e=>set('jellyfin_user_id',e.target.value)} required>
                <option value="">Select user…</option>
                {jellyfinUsers.filter(u=>!u.isManaged).map(u=>(
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Display Name</label>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} required />
          </div>
          <div>
            <label className="label">Avatar</label>
            <div style={{ display:'flex',flexWrap:'wrap',gap:'0.5rem' }}>
              {AVATARS.map(a=>(
                <button key={a} type="button" onClick={()=>set('avatar_emoji',a)}
                  style={{ fontSize:'1.8rem',background:form.avatar_emoji===a?'rgba(124,58,237,0.3)':'transparent',border:form.avatar_emoji===a?'1px solid #7c3aed':'1px solid transparent',borderRadius:8,padding:'0.3rem',cursor:'pointer' }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Daily Screen Time Limit (minutes)</label>
            <input className="input" type="number" min="10" max="480" value={form.daily_limit_minutes} onChange={e=>set('daily_limit_minutes',parseInt(e.target.value))} required />
            <p style={{ color:'#a0a0c0',fontSize:'0.8rem',marginTop:'0.3rem' }}>{Math.floor(form.daily_limit_minutes/60)}h {form.daily_limit_minutes%60}m per day</p>
          </div>
          <div style={{ display:'flex',gap:'0.75rem',marginTop:'0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex:1 }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex:2 }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChildrenPage() {
  const [children, setChildren] = useState([]);
  const [jfUsers, setJfUsers] = useState([]);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    const [c, u] = await Promise.all([
      api.get('/children'),
      api.get('/children/jellyfin-users').catch(()=>({data:[]}))
    ]);
    setChildren(c.data);
    setJfUsers(u.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveChild(form) {
    if (modal === 'add') {
      await api.post('/children', form);
    } else {
      await api.put(`/children/${modal.id}`, form);
    }
    setModal(null);
    load();
  }

  async function deleteChild(id, name) {
    if (!window.confirm(`Remove ${name} from JellyTime? Their Jellyfin account won't be deleted.`)) return;
    await api.delete(`/children/${id}`);
    load();
  }

  return (
    <div className="page">
      <nav className="nav">
        <Link to="/parent" className="btn btn-ghost" style={{ padding:'0.4rem 0.75rem',fontSize:'0.85rem' }}>← Dashboard</Link>
        <span className="nav-title" style={{ flex:1,textAlign:'center' }}>👥 Kids</span>
        <button className="btn btn-primary" style={{ padding:'0.5rem 1rem',fontSize:'0.85rem' }} onClick={()=>setModal('add')}>+ Add</button>
      </nav>

      <div style={{ padding:'1.5rem',maxWidth:700,margin:'0 auto' }}>
        {children.length === 0 ? (
          <div className="card" style={{ textAlign:'center',padding:'3rem' }}>
            <div style={{ fontSize:'3rem',marginBottom:'1rem' }}>👧🧒</div>
            <p style={{ color:'#a0a0c0',marginBottom:'1.5rem' }}>Add your kids to get started!</p>
            <button className="btn btn-primary" onClick={()=>setModal('add')}>Add first child</button>
          </div>
        ) : (
          <div className="stack">
            {children.map(c=>(
              <div key={c.id} className="card" style={{ padding:'1.25rem' }}>
                <div style={{ display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap' }}>
                  <span style={{ fontSize:'2.5rem' }}>{c.avatar_emoji}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800,fontSize:'1.1rem' }}>{c.name}</div>
                    <div style={{ color:'#a0a0c0',fontSize:'0.85rem' }}>
                      {c.daily_limit_minutes}m/day · {c.remaining_minutes}m left today
                    </div>
                  </div>
                  <div style={{ display:'flex',gap:'0.5rem' }}>
                    <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem' }} onClick={()=>setModal(c)}>Edit</button>
                    <button className="btn btn-ghost" style={{ padding:'0.4rem 0.7rem',fontSize:'0.8rem',color:'#ef4444' }} onClick={()=>deleteChild(c.id,c.name)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && <ChildModal child={modal==='add'?null:modal} jellyfinUsers={jfUsers} onSave={saveChild} onClose={()=>setModal(null)} />}
    </div>
  );
}
