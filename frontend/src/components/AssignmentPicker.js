import React from 'react';

// Which kids a template applies to, with optional per-kid minutes.
// value: [{ childId, minutesOverride }]; minutesOverride null means "use the default".
export default function AssignmentPicker({ kids, value, onChange, defaultMinutes, range = { min: 1, max: 1440 } }) {
  if (kids.length === 0) return null;
  const byId = Object.fromEntries(value.map(a => [a.childId, a]));

  function toggle(childId, on) {
    onChange(on ? [...value, { childId, minutesOverride: null }] : value.filter(a => a.childId !== childId));
  }

  function setOverride(childId, raw) {
    const minutesOverride = raw === '' ? null : parseInt(raw);
    onChange(value.map(a => a.childId === childId ? { ...a, minutesOverride } : a));
  }

  return (
    <div>
      <label className="label">Who it's for</label>
      <div className="stack" style={{ gap:'0.5rem' }}>
        {kids.map(k => {
          const a = byId[k.id];
          return (
            <div key={k.id} style={{ display:'flex',alignItems:'center',gap:'0.75rem' }}>
              <input type="checkbox" id={`kid-${k.id}`} checked={!!a} onChange={e=>toggle(k.id, e.target.checked)}
                style={{ width:18,height:18,accentColor:'#7c3aed' }} />
              <label htmlFor={`kid-${k.id}`} style={{ flex:1,fontWeight:700,cursor:'pointer' }}>{k.avatar_emoji} {k.name}</label>
              <input className="input" type="number" min={range.min} max={range.max} style={{ width:110 }} disabled={!a}
                placeholder={defaultMinutes ? `${defaultMinutes}m` : 'Minutes'}
                value={a?.minutesOverride ?? ''} onChange={e=>setOverride(k.id, e.target.value)} />
            </div>
          );
        })}
      </div>
      <p style={{ color:'#a0a0c0',fontSize:'0.8rem',marginTop:'0.3rem' }}>Leave minutes blank to use the default.</p>
    </div>
  );
}
