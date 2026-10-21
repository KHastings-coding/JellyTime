// Which kids a chore or removal template applies to, and how many minutes each kid gets.
import { HttpError } from './httpError.js';

export function parseMinutes(value, field, { min = 1, max = 1440 } = {}) {
  const n = Number(value);
  if (value === '' || value === null || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

export function validateAssignments(db, assignments, range) {
  if (!Array.isArray(assignments)) throw new HttpError(400, 'assignments must be a list');
  const known = new Set(db.prepare('SELECT id FROM children').all().map(r => r.id));
  const seen = new Set();
  return assignments.map(a => {
    if (seen.has(a?.childId)) throw new HttpError(400, `Duplicate child: ${a.childId}`);
    seen.add(a?.childId);
    if (!known.has(a?.childId)) throw new HttpError(400, `Unknown child: ${a?.childId}`);
    const o = a.minutesOverride;
    const minutesOverride = o === null || o === undefined || o === '' ? null : parseMinutes(o, 'Minutes for a kid', range);
    return { childId: a.childId, minutesOverride };
  });
}

export function setAssignments(db, type, templateId, assignments) {
  db.transaction(() => {
    db.prepare('DELETE FROM template_assignments WHERE template_type=? AND template_id=?').run(type, templateId);
    const insert = db.prepare(`INSERT INTO template_assignments (template_type, template_id, child_id, minutes_override)
      VALUES (?,?,?,?)`);
    for (const a of assignments) insert.run(type, templateId, a.childId, a.minutesOverride);
  })();
}

export function assignToAllChildren(db, type, templateId) {
  db.prepare(`INSERT OR IGNORE INTO template_assignments (template_type, template_id, child_id)
    SELECT ?, ?, id FROM children`).run(type, templateId);
}

export function assignAllTemplatesToChild(db, childId) {
  db.prepare(`INSERT OR IGNORE INTO template_assignments (template_type, template_id, child_id)
    SELECT 'chore', id, ? FROM chore_templates WHERE active=1`).run(childId);
  db.prepare(`INSERT OR IGNORE INTO template_assignments (template_type, template_id, child_id)
    SELECT 'removal', id, ? FROM removal_templates WHERE active=1`).run(childId);
}

export function getAssignments(db, type, templateId) {
  return db.prepare(`SELECT child_id AS childId, minutes_override AS minutesOverride
    FROM template_assignments WHERE template_type=? AND template_id=?`).all(type, templateId);
}

// Minutes this kid gets from the template, or null if it isn't assigned to them.
export function effectiveMinutes(db, type, templateId, childId, defaultMinutes) {
  const row = db.prepare(`SELECT minutes_override FROM template_assignments
    WHERE template_type=? AND template_id=? AND child_id=?`).get(type, templateId, childId);
  if (!row) return null;
  return row.minutes_override ?? defaultMinutes;
}
