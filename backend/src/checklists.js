// Parent-defined checklists (routines): templates here; runs and review are added alongside.
import { randomUUID } from 'node:crypto';
import { HttpError } from './httpError.js';
import { validateSchedule, isScheduled, scheduledDatesBetween } from './schedule.js';
import { parseMinutes, validateAssignments, setAssignments, getAssignments, effectiveMinutes } from './templates.js';
import { currentDay, getChild, applyAdjustment } from './accounting.js';
import { getClockSettings, addDays, deadlineInstant } from './clock.js';

export const RANGE = { min: 0, max: 600 };
const BACKFILL_DAYS = 60;
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

export function updateChecklist(db, id, body, now = new Date()) {
  requireLive(db, id);
  const v = validateBody(db, body);
  db.transaction(() => {
    db.prepare(`UPDATE checklist_templates SET name=?, icon=?, reward_minutes=?, auto_approve=?, deadline=?,
      schedule=?, active=? WHERE id=?`)
      .run(v.name, v.icon, v.rewardMinutes, v.autoApprove, v.deadline, JSON.stringify(v.schedule), v.active, id);
    replaceItems(db, id, v.items);
    const kept = new Set(v.assignments.map(a => a.childId));
    const removed = getAssignments(db, 'checklist', id).map(a => a.childId).filter(c => !kept.has(c));
    setAssignments(db, 'checklist', id, v.assignments);
    // An unassigned kid loses today's run only while it is still open; a submitted one stays reviewable.
    const del = db.prepare("DELETE FROM checklist_runs WHERE checklist_id=? AND child_id=? AND status='open' AND date>=?");
    for (const childId of removed) del.run(id, childId, currentDay(db, { id: childId }, now));
  })();
}

export function archiveChecklist(db, id, now = new Date()) {
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
        dayByChild.set(run.child_id, child ? currentDay(db, child, now) : null);
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

// ---- Runs: one per kid x checklist x scheduled day ----

function runDeadline(db, run) {
  const { timezone, resetTime } = getClockSettings(db);
  return deadlineInstant(run.date, run.deadline, timezone, resetTime);
}

function deadlinePassed(db, run, now) {
  const at = runDeadline(db, run);
  return at !== null && at <= now;
}

export function runExpired(db, run, now = new Date()) {
  return currentDay(db, { id: run.child_id }, now) > run.date || deadlinePassed(db, run, now);
}

export function syncRuns(db, child, now = new Date()) {
  db.transaction(() => {
    const day = currentDay(db, child, now);
    const { timezone, resetTime } = getClockSettings(db);
    const miss = db.prepare("UPDATE checklist_runs SET status='missed' WHERE id=? AND status='open'");
    for (const run of db.prepare("SELECT * FROM checklist_runs WHERE child_id=? AND status='open'").all(child.id)) {
      if (runExpired(db, run, now)) miss.run(run.id);
    }

    const checklists = db.prepare(`SELECT t.* FROM checklist_templates t
      JOIN template_assignments a ON a.template_type='checklist' AND a.template_id=t.id AND a.child_id=?
      WHERE t.active=1 AND t.archived=0`).all(child.id);
    const insert = db.prepare(`INSERT OR IGNORE INTO checklist_runs
      (checklist_id, child_id, date, status, items, reward_minutes, name, icon, deadline) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const c of checklists) {
      const items = JSON.stringify(db.prepare('SELECT id, label FROM checklist_items WHERE checklist_id=? ORDER BY position')
        .all(c.id).map(i => ({ id: i.id, label: i.label, done: false })));
      const reward = effectiveMinutes(db, 'checklist', c.id, child.id, c.reward_minutes);
      const add = (date, status) => insert.run(c.id, child.id, date, status, items, reward, c.name, c.icon, c.deadline);
      const schedule = JSON.parse(c.schedule);

      const newest = db.prepare('SELECT MAX(date) AS d FROM checklist_runs WHERE checklist_id=? AND child_id=?')
        .get(c.id, child.id)?.d;
      if (newest) {
        const after = addDays(newest, 1);
        const floor = addDays(day, -BACKFILL_DAYS);
        const from = after > floor ? after : floor;
        const to = addDays(day, -1);
        if (from <= to) for (const date of scheduledDatesBetween(schedule, from, to)) add(date, 'missed');
      }
      // A run that would already be past its deadline is not created; if a later run exists, backfill records it.
      const lateAt = deadlineInstant(day, c.deadline, timezone, resetTime);
      if (isScheduled(schedule, day) && !(lateAt && lateAt <= now)) add(day, 'open');
    }
  })();
}

export function runView(db, run, now = new Date()) {
  const items = JSON.parse(run.items);
  const deadline = runDeadline(db, run);
  const day = currentDay(db, { id: run.child_id }, now);
  return {
    id: run.id, checklist_id: run.checklist_id, child_id: run.child_id, date: run.date,
    name: run.name, icon: run.icon, items, status: run.status, reward_minutes: run.reward_minutes,
    deadline_at: deadline ? deadline.toISOString() : null,
    can_submit: run.status === 'open' && items.every(i => i.done) && !runExpired(db, run, now),
    can_retry: run.status === 'submitted' && run.date === day && !(deadline && deadline <= now),
    review_note: run.review_note, submitted_at: run.submitted_at,
  };
}

export function childRuns(db, childId, now = new Date()) {
  const child = getChild(db, childId);
  if (!child) throw new HttpError(404, 'Child not found');
  syncRuns(db, child, now);
  return db.prepare('SELECT * FROM checklist_runs WHERE child_id=? AND date=? ORDER BY name, id')
    .all(child.id, currentDay(db, child, now)).map(r => runView(db, r, now));
}

const getRun = (db, runId) => db.prepare('SELECT * FROM checklist_runs WHERE id=?').get(runId);

// A kid acting on a run: it must be theirs, today's, open and not expired. Expiry is applied first.
function openRunForKid(db, runId, childId, now) {
  const found = getRun(db, runId);
  if (!found || found.child_id !== childId) throw new HttpError(404, 'Run not found');
  const child = getChild(db, childId);
  if (!child) throw new HttpError(404, 'Run not found');
  syncRuns(db, child, now);
  const run = getRun(db, runId);
  if (run.date !== currentDay(db, child, now)) throw new HttpError(400, "Only today's checklists can be changed");
  if (run.status !== 'open') throw new HttpError(400, 'This checklist is not open');
  if (runExpired(db, run, now)) throw new HttpError(400, 'Time is up for this checklist');
  return { run, child };
}

export function tickItem(db, runId, { childId, itemId, done } = {}, now = new Date()) {
  const { run } = openRunForKid(db, runId, childId, now);
  const items = JSON.parse(run.items);
  const item = items.find(i => i.id === itemId);
  if (!item) throw new HttpError(400, 'Unknown item');
  item.done = !!done;
  const info = db.prepare("UPDATE checklist_runs SET items=? WHERE id=? AND status='open'").run(JSON.stringify(items), run.id);
  if (info.changes === 0) throw new HttpError(409, 'This checklist changed; refresh and try again');
  return runView(db, getRun(db, run.id), now);
}

export function submitRun(db, runId, { childId } = {}, now = new Date()) {
  const { run, child } = openRunForKid(db, runId, childId, now);
  if (!JSON.parse(run.items).every(i => i.done)) throw new HttpError(400, 'Tick every item first');
  const auto = !!db.prepare('SELECT auto_approve FROM checklist_templates WHERE id=?').get(run.checklist_id)?.auto_approve;
  const stamp = Math.floor(now.getTime() / 1000);
  db.transaction(() => {
    const info = auto
      ? db.prepare("UPDATE checklist_runs SET status='approved', submitted_at=?, reviewed_at=? WHERE id=? AND status='open'")
        .run(stamp, stamp, run.id)
      : db.prepare("UPDATE checklist_runs SET status='submitted', submitted_at=? WHERE id=? AND status='open'")
        .run(stamp, run.id);
    if (info.changes === 0) throw new HttpError(409, 'This checklist was already submitted');
    if (auto && run.reward_minutes > 0) {
      applyAdjustment(db, {
        childId: child.id, minutes: run.reward_minutes, kind: 'checklist', reason: run.name,
        icon: run.icon || '📝', templateId: run.checklist_id, date: currentDay(db, child, now),
      });
    }
  })();
  return { view: runView(db, getRun(db, run.id), now), notify: !auto };
}
