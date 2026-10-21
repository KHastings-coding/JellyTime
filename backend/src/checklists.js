// Parent-defined checklists (routines): templates here; runs and review are added alongside.
import { randomUUID } from 'node:crypto';
import { HttpError } from './httpError.js';
import { validateSchedule } from './schedule.js';
import { parseMinutes, validateAssignments, setAssignments, getAssignments } from './templates.js';
import { currentDay } from './accounting.js';

export const RANGE = { min: 0, max: 600 };
const DEADLINE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function trimmed(value, field, max) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > max) throw new HttpError(400, `${field} must be 1 to ${max} characters`);
  return s;
}

function validateBody(db, body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid checklist');
  const name = trimmed(body.name, 'Name', 60);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    throw new HttpError(400, 'A checklist needs 1 to 20 items');
  }
  const items = body.items.map(label => trimmed(label, 'Item', 100));
  const rewardMinutes = parseMinutes(body.reward_minutes, 'reward_minutes', RANGE);
  const deadline = body.deadline ?? null;
  if (deadline !== null && !(typeof deadline === 'string' && DEADLINE_RE.test(deadline))) {
    throw new HttpError(400, 'deadline must be HH:MM (24-hour)');
  }
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : '📝';
  const schedule = validateSchedule(body.schedule);
  const assignments = validateAssignments(db, body.assignments ?? [], RANGE);
  return {
    name, icon, items, rewardMinutes, deadline, schedule, assignments,
    autoApprove: body.auto_approve ? 1 : 0,
    active: body.active === undefined ? 1 : (body.active ? 1 : 0),
  };
}

function replaceItems(db, id, items) {
  db.prepare('DELETE FROM checklist_items WHERE checklist_id=?').run(id);
  const insert = db.prepare('INSERT INTO checklist_items (id, checklist_id, position, label) VALUES (?,?,?,?)');
  items.forEach((label, i) => insert.run(randomUUID(), id, i, label));
}

export function createChecklist(db, body) {
  const v = validateBody(db, body);
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO checklist_templates (id, name, icon, reward_minutes, auto_approve, deadline, schedule, active)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, v.name, v.icon, v.rewardMinutes, v.autoApprove, v.deadline, JSON.stringify(v.schedule), v.active);
    replaceItems(db, id, v.items);
    setAssignments(db, 'checklist', id, v.assignments);
  })();
  return { id };
}

function requireLive(db, id) {
  const row = db.prepare('SELECT id FROM checklist_templates WHERE id=? AND archived=0').get(id);
  if (!row) throw new HttpError(404, 'Checklist not found');
}

export function updateChecklist(db, id, body) {
  requireLive(db, id);
  const v = validateBody(db, body);
  db.transaction(() => {
    db.prepare(`UPDATE checklist_templates SET name=?, icon=?, reward_minutes=?, auto_approve=?, deadline=?,
      schedule=?, active=? WHERE id=?`)
      .run(v.name, v.icon, v.rewardMinutes, v.autoApprove, v.deadline, JSON.stringify(v.schedule), v.active, id);
    replaceItems(db, id, v.items);
    setAssignments(db, 'checklist', id, v.assignments);
  })();
}

export function archiveChecklist(db, id) {
  const row = db.prepare('SELECT id FROM checklist_templates WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Checklist not found');
  db.transaction(() => {
    db.prepare('UPDATE checklist_templates SET archived=1 WHERE id=?').run(id);
    const open = db.prepare("SELECT id, child_id, date FROM checklist_runs WHERE checklist_id=? AND status='open'").all(id);
    const del = db.prepare('DELETE FROM checklist_runs WHERE id=?');
    const dayByChild = new Map();
    for (const run of open) {
      if (!dayByChild.has(run.child_id)) {
        const child = db.prepare('SELECT * FROM children WHERE id=?').get(run.child_id);
        dayByChild.set(run.child_id, child ? currentDay(db, child) : null);
      }
      const day = dayByChild.get(run.child_id);
      if (day && run.date >= day) del.run(run.id);
    }
  })();
}

function shape(db, row) {
  return {
    id: row.id, name: row.name, icon: row.icon, reward_minutes: row.reward_minutes,
    auto_approve: !!row.auto_approve, deadline: row.deadline,
    schedule: JSON.parse(row.schedule), active: !!row.active,
    items: db.prepare('SELECT id, label FROM checklist_items WHERE checklist_id=? ORDER BY position').all(row.id),
    assignments: getAssignments(db, 'checklist', row.id),
  };
}

export function getChecklist(db, id) {
  const row = db.prepare('SELECT * FROM checklist_templates WHERE id=? AND archived=0').get(id);
  if (!row) throw new HttpError(404, 'Checklist not found');
  return shape(db, row);
}

export function listChecklists(db) {
  return db.prepare('SELECT * FROM checklist_templates WHERE archived=0 ORDER BY name').all().map(r => shape(db, r));
}
