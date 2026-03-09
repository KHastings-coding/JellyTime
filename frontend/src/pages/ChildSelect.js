import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import '../styles.css';

export default function ChildSelect() {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Public endpoint - just get children list
    api.get('/children').then(r => {
      setChildren(r.data);
      setLoading(false);
    }).catch(() => {
      // Try public approach
      setLoading(false);
    });
  }, []);

  async function selectChild(child) {
    try {
      const r = await api.post('/auth/child-login', { childId: child.id });
      localStorage.setItem('jt_token', r.data.token);
      localStorage.setItem('jt_child_id', child.id);
      localStorage.setItem('jt_child_name', child.name);
      localStorage.setItem('jt_role', 'child');
      navigate(`/child/${child.id}`);
    } catch (e) {
      console.error('Child login failed', e);
    }
  }

  if (loading) return (
    <div className="page" style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>⏳</div>
  );

  return (
    <div className="page" style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem', minHeight:'100vh' }}>
      <div style={{ width:'100%', maxWidth:500 }}>
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <div style={{ fontSize:'3rem', marginBottom:'0.5rem' }}>👋</div>
          <h1 style={{ fontFamily:'Fredoka One, cursive', fontSize:'2rem', color:'#a855f7' }}>Who are you?</h1>
        </div>

        {children.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:'2rem' }}>
            <p style={{ color:'#a0a0c0' }}>No kids set up yet. Ask a parent to add you!</p>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns: children.length > 2 ? '1fr 1fr' : '1fr', gap:'1rem' }}>
            {children.map(child => (
              <button
                key={child.id}
                onClick={() => selectChild(child)}
                style={{
                  background:'linear-gradient(135deg, #1e1e35, #252540)',
                  border:'2px solid rgba(255,255,255,0.08)',
                  borderRadius:20,
                  padding:'2rem 1rem',
                  cursor:'pointer',
                  transition:'all 0.2s',
                  color:'white',
                  fontFamily:'Nunito, sans-serif',
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor='#7c3aed'; e.currentTarget.style.transform='scale(1.03)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'; e.currentTarget.style.transform='scale(1)'; }}
              >
                <div style={{ fontSize:'3.5rem', marginBottom:'0.75rem' }}>{child.avatar_emoji}</div>
                <div style={{ fontWeight:800, fontSize:'1.3rem' }}>{child.name}</div>
                <div style={{ color:'#a0a0c0', fontSize:'0.85rem', marginTop:'0.3rem' }}>
                  {child.remaining_minutes > 0 ? `⏱ ${child.remaining_minutes}m left today` : '🚫 Time used up'}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:'2rem' }}>
          <button className="btn btn-ghost" onClick={() => {
            localStorage.removeItem('jt_token');
            localStorage.removeItem('jt_role');
            localStorage.removeItem('jt_child_id');
            localStorage.removeItem('jt_child_name');
            navigate('/');
          }} style={{ fontSize:'0.85rem' }}>
            I'm a parent ↩
          </button>
        </div>
      </div>
    </div>
  );
}
