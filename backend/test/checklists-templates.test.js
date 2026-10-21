import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, addChild } from './helpers.js';

const { createChecklist, updateChecklist, archiveChecklist, getChecklist, listChecklists } =
  await import('../src/checklists.js');

const db = getDb();
const base = (over = {}) => ({
  name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' },
  items: ['Brush teeth', 'Get dressed', 'Make bed'], ...over,
});
const status = fn => { try { fn(); } catch (e) { return e.status; } return null; };

test('create and read back a checklist with items and an assignment', () => {
  const kid = addChild(db);
  const { id } = createChecklist(db, base({ assignments: [{ childId: kid.id, minutesOverride: 20 }] }));
  const c = getChecklist(db, id);
  assert.equal(c.name, 'Morning');
  assert.equal(c.icon, '📝');
  assert.equal(c.auto_approve, false);
  assert.equal(c.active, true);
  assert.equal(c.deadline, null);
  assert.deepEqual(c.schedule, { type: 'daily' });
  assert.deepEqual(c.items.map(i => i.label), ['Brush teeth', 'Get dressed', 'Make bed']);
  assert.deepEqual(c.assignments, [{ childId: kid.id, minutesOverride: 20 }]);
});

test('invalid bodies are rejected with 400', () => {
  const kid = addChild(db);
  const bad = [
    { name: '  ' }, { name: 'x'.repeat(61) }, { items: [] },
    { items: Array.from({ length: 21 }, (_, i) => `i${i}`) },
    { items: ['x'.repeat(101)] }, { items: ['  '] },
    { reward_minutes: 601 }, { reward_minutes: -1 },
    { deadline: '25:00' }, { deadline: '8:30' },
    { schedule: { type: 'weekly', days: [] } },
    { assignments: [{ childId: 'nope', minutesOverride: null }] },
  ];
  for (const over of bad) assert.equal(status(() => createChecklist(db, base(over))), 400, JSON.stringify(over));
  assert.equal(status(() => createChecklist(db, base({ assignments: [{ childId: kid.id, minutesOverride: 601 }] }))), 400);
});

test('reward_minutes 0 and a valid deadline are accepted', () => {
  const { id } = createChecklist(db, base({ reward_minutes: 0, deadline: '08:30', auto_approve: true, active: false }));
  const c = getChecklist(db, id);
  assert.equal(c.reward_minutes, 0);
  assert.equal(c.deadline, '08:30');
  assert.equal(c.auto_approve, true);
  assert.equal(c.active, false);
});

test('update replaces items, keeps the id, and 404s for missing or archived', () => {
  const kid = addChild(db);
  const { id } = createChecklist(db, base({ assignments: [{ childId: kid.id, minutesOverride: null }] }));
  const before = getChecklist(db, id);
  updateChecklist(db, id, base({ name: 'Evening', items: ['Pajamas'] }));
  const after = getChecklist(db, id);
  assert.equal(after.id, id);
  assert.equal(after.name, 'Evening');
  assert.deepEqual(after.items.map(i => i.label), ['Pajamas']);
  assert.ok(!before.items.some(i => i.id === after.items[0].id));
  assert.deepEqual(after.assignments, [{ childId: kid.id, minutesOverride: null }]); // omitted assignments are kept (R9)
  assert.equal(status(() => updateChecklist(db, 'missing', base())), 404);
  archiveChecklist(db, id);
  assert.equal(status(() => updateChecklist(db, id, base())), 404);
});

test('archive hides the checklist, removes future open runs, keeps submitted runs', () => {
  const kid = addChild(db);
  const { id } = createChecklist(db, base());
  const ins = db.prepare(`INSERT INTO checklist_runs (checklist_id, child_id, date, status, items, reward_minutes, name)
    VALUES (?,?,?,?,?,?,?)`);
  ins.run(id, kid.id, '2099-01-01', 'open', '[]', 5, 'Morning');
  ins.run(id, kid.id, '2099-01-02', 'submitted', '[]', 5, 'Morning');
  ins.run(id, kid.id, '2000-01-01', 'open', '[]', 5, 'Morning');
  archiveChecklist(db, id);
  assert.ok(!listChecklists(db).some(c => c.id === id));
  const rows = db.prepare('SELECT date, status FROM checklist_runs WHERE checklist_id=? ORDER BY date').all(id);
  assert.deepEqual(rows, [{ date: '2000-01-01', status: 'open' }, { date: '2099-01-02', status: 'submitted' }]);
  assert.equal(status(() => archiveChecklist(db, 'missing')), 404);
});
