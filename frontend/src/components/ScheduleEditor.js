import React from 'react';
import { DAY_SHORT } from '../lib/schedule';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const NTH_OPTIONS = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], ['last', 'Last']];
const DATES = Array.from({ length: 31 }, (_, i) => i + 1);

const chip = on => ({
  background: on ? 'rgba(124,58,237,0.3)' : 'transparent',
  border: on ? '1px solid #7c3aed' : '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, padding: '0.35rem 0', cursor: 'pointer', color: 'inherit', fontWeight: 700,
});

// value: {type:'daily'} | {type:'weekly', days} | {type:'monthly', rules}
export default function ScheduleEditor({ value, onChange }) {
  const modes = [['daily', 'Every day'], ['weekly', 'Days of week'], ['monthly', 'Days of month']];

  function setMode(type) {
    if (type === value.type) return;
    if (type === 'daily') onChange({ type: 'daily' });
    else if (type === 'weekly') onChange({ type: 'weekly', days: [1, 2, 3, 4, 5] });
    else onChange({ type: 'monthly', rules: [{ date: 1 }] });
  }

  function toggleDay(d) {
    const days = value.days.includes(d) ? value.days.filter(x => x !== d) : [...value.days, d].sort((a, b) => a - b);
    onChange({ ...value, days });
  }

  const rules = value.rules || [];
  const dateRules = rules.filter(r => r.date !== undefined);
  const nthRules = rules.filter(r => r.date === undefined);

  function toggleDate(n) {
    const has = dateRules.some(r => r.date === n);
    const nextDates = has ? dateRules.filter(r => r.date !== n) : [...dateRules, { date: n }].sort((a, b) => a.date - b.date);
    onChange({ ...value, rules: [...nextDates, ...nthRules] });
  }

  function setNth(idx, patch) {
    onChange({ ...value, rules: [...dateRules, ...nthRules.map((r, i) => i === idx ? { ...r, ...patch } : r)] });
  }

  function removeNth(idx) {
    onChange({ ...value, rules: [...dateRules, ...nthRules.filter((_, i) => i !== idx)] });
  }

  function addNth() {
    onChange({ ...value, rules: [...dateRules, ...nthRules, { nth: 1, weekday: 0 }] });
  }

  return (
    <div>
      <label className="label">Schedule</label>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {modes.map(([type, text]) => (
          <button key={type} type="button" className={`btn ${value.type === type ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, padding: '0.4rem 0.3rem', fontSize: '0.8rem' }} onClick={() => setMode(type)}>{text}</button>
        ))}
      </div>

      {value.type === 'weekly' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem' }}>
          {DAY_INITIALS.map((ini, d) => (
            <button key={d} type="button" title={DAY_SHORT[d]} style={chip(value.days.includes(d))} onClick={() => toggleDay(d)}>{ini}</button>
          ))}
        </div>
      )}

      {value.type === 'monthly' && (
        <div className="stack" style={{ gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.3rem' }}>
              {DATES.map(n => (
                <button key={n} type="button" style={{ ...chip(dateRules.some(r => r.date === n)), fontSize: '0.8rem' }} onClick={() => toggleDate(n)}>{n}</button>
              ))}
            </div>
            <p style={{ color: '#a0a0c0', fontSize: '0.8rem', marginTop: '0.3rem' }}>Dates a month doesn't have use its last day.</p>
          </div>
          {nthRules.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select className="input" value={r.nth} onChange={e => setNth(i, { nth: e.target.value === 'last' ? 'last' : parseInt(e.target.value) })}>
                {NTH_OPTIONS.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
              </select>
              <select className="input" value={r.weekday} onChange={e => setNth(i, { weekday: parseInt(e.target.value) })}>
                {DAY_SHORT.map((text, d) => <option key={d} value={d}>{text}</option>)}
              </select>
              <button type="button" className="btn btn-ghost" style={{ padding: '0.4rem 0.7rem', color: '#ef4444' }} onClick={() => removeNth(i)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={addNth}>+ Add weekday rule</button>
        </div>
      )}
    </div>
  );
}
