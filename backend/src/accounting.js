import { today, addDays } from './clock.js';
import { HttpError } from './httpError.js';

// Screen-time balance math and ledger operations. Minutes may be fractional
// because playback is tracked in fractions of a minute.

// What the kid can still watch today. Negative after a large removal.
export function availableMinutes({ daily, carryIn, net, used }) {
  return daily + carryIn + net - used;
}

// Earned balance carried out of a finished day. The allotment is spent first and
// whatever is left of it expires; leftover earned time carries (up to the cap);
// a negative total carries as debt.
export function settleCarry({ daily, carryIn, net, used, bankCap = null }) {
  const end = availableMinutes({ daily, carryIn, net, used });
  const unusedAllotment = Math.max(0, daily - used);
  let carry = end >= 0 ? Math.max(0, end - unusedAllotment) : end;
  if (bankCap !== null && bankCap !== undefined && carry > bankCap) carry = bankCap;
  return carry;
}

// Carry-in for the next day. 'forgive' wipes any debt beyond one day's allotment.
export function applyDebtMode(carry, debtMode, nextDaily) {
  return debtMode === 'forgive' ? Math.max(carry, -nextDaily) : carry;
}

export function getChild(db, childId) {
  return db.prepare('SELECT * FROM children WHERE id=?').get(childId);
}

function getRow(db, childId, date) {
  return db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(childId, date);
}

function settleRow(db, child, row) {
  if (row.settled) return row.carry_out_minutes ?? 0;
  const carry = settleCarry({
    daily: row.daily_limit_minutes ?? child.daily_limit_minutes,
    carryIn: row.carry_in_minutes ?? 0,
    net: row.bonus_minutes,
    used: row.minutes_used,
    bankCap: child.bank_cap_minutes,
  });
  db.prepare('UPDATE time_ledger SET settled=1, carry_out_minutes=? WHERE id=?').run(carry, row.id);
  return carry;
}

// The kid's current day: today, unless a later row already exists (the timezone or
// reset time moved "today" backwards). A kid's day never moves back onto a settled day.
export function currentDay(db, child, now = new Date()) {
  const t = today(db, now);
  const latest = db.prepare('SELECT MAX(date) AS d FROM time_ledger WHERE child_id=?').get(child.id)?.d;
  return latest && latest > t ? latest : t;
}

// The kid's ledger row for `date`, creating it — and settling every earlier day — if needed.
export function ensureDay(db, child, date = currentDay(db, child)) {
  const existing = getRow(db, child.id, date);
  if (existing) return existing;
  return db.transaction(() => {
    const prev = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date<? ORDER BY date DESC LIMIT 1')
      .get(child.id, date);
    let carry = 0;
    if (prev) {
      carry = settleRow(db, child, prev);
      // Days without a row (nothing watched or earned) still settle: the allotment pays down debt.
      for (let d = addDays(prev.date, 1); d < date; d = addDays(d, 1)) {
        const daily = child.daily_limit_minutes;
        carry = settleCarry({
          daily, carryIn: applyDebtMode(carry, child.debt_mode, daily), net: 0, used: 0, bankCap: child.bank_cap_minutes,
        });
      }
    }
    const daily = child.daily_limit_minutes;
    db.prepare(`INSERT OR IGNORE INTO time_ledger
      (child_id, date, minutes_used, bonus_minutes, carry_in_minutes, daily_limit_minutes, settled)
      VALUES (?,?,0,0,?,?,0)`).run(child.id, date, applyDebtMode(carry, child.debt_mode, daily), daily);
    return getRow(db, child.id, date);
  })();
}

export function addUsage(db, child, minutes, date = currentDay(db, child)) {
  const row = ensureDay(db, child, date);
  db.prepare('UPDATE time_ledger SET minutes_used = minutes_used + ?, last_updated = unixepoch() WHERE id=?')
    .run(minutes, row.id);
}

export function resetUsage(db, child, date = currentDay(db, child)) {
  const row = ensureDay(db, child, date);
  db.prepare('UPDATE time_ledger SET minutes_used = 0, last_updated = unixepoch() WHERE id=?').run(row.id);
}

export function applyAdjustment(db, {
  childId, minutes, kind, reason = null, icon = null, templateId = null, completionId = null, date,
}) {
  const child = getChild(db, childId);
  if (!child) throw new HttpError(404, 'Child not found');
  return db.transaction(() => {
    if (date === undefined) date = currentDay(db, child);
    const existing = getRow(db, child.id, date);
    const later = db.prepare('SELECT 1 FROM time_ledger WHERE child_id=? AND date>? LIMIT 1').get(child.id, date);
    if (existing?.settled || later) throw new HttpError(400, "Can't change a day that has already ended");
    const row = ensureDay(db, child, date);
    const info = db.prepare(`INSERT INTO time_adjustments
      (child_id, date, minutes, kind, reason, icon, template_id, completion_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(child.id, date, minutes, kind, reason, icon, templateId, completionId);
    db.prepare('UPDATE time_ledger SET bonus_minutes = bonus_minutes + ?, last_updated = unixepoch() WHERE id=?')
      .run(minutes, row.id);
    return { id: Number(info.lastInsertRowid), summary: childSummary(db, child, date) };
  })();
}

export const UNDOABLE_KINDS = ['grant', 'removal'];

export function undoAdjustment(db, adjustmentId) {
  const adj = db.prepare('SELECT * FROM time_adjustments WHERE id=?').get(adjustmentId);
  if (!adj) throw new HttpError(404, 'Change not found');
  if (!UNDOABLE_KINDS.includes(adj.kind)) throw new HttpError(400, 'Chore rewards cannot be undone here');
  if (adj.date !== currentDay(db, { id: adj.child_id })) throw new HttpError(400, "Only today's changes can be undone");
  db.transaction(() => {
    db.prepare('DELETE FROM time_adjustments WHERE id=?').run(adj.id);
    db.prepare('UPDATE time_ledger SET bonus_minutes = bonus_minutes - ? WHERE child_id=? AND date=?')
      .run(adj.minutes, adj.child_id, adj.date);
  })();
  return adj;
}

export function childSummary(db, child, date = currentDay(db, child)) {
  const row = ensureDay(db, child, date);
  const daily = row.daily_limit_minutes ?? child.daily_limit_minutes;
  const carryIn = row.carry_in_minutes ?? 0;
  const net = row.bonus_minutes;
  const used = row.minutes_used;
  const available = availableMinutes({ daily, carryIn, net, used });
  const earned = carryIn + net;
  const dailyLeft = Math.max(0, daily - used);
  const totalAllowed = Math.max(0, daily + earned);
  return {
    date: row.date,
    daily_limit_minutes: daily,
    daily_left: Math.round(dailyLeft),
    carry_in: Math.round(carryIn),
    earned_today: Math.round(net),
    banked: earned >= 0 ? Math.max(0, Math.round(available) - Math.round(dailyLeft)) : 0,
    owed: earned < 0 ? Math.round(-earned) : 0,
    available: Math.round(available),
    minutes_used: Math.round(used),
    remaining_minutes: Math.max(0, Math.round(available)),
    total_allowed: Math.round(totalAllowed),
    bonus_minutes: Math.round(net),
    pct_used: totalAllowed > 0 ? Math.min(100, Math.round((used / totalAllowed) * 100)) : 100,
  };
}

export function listAdjustments(db, childId, { days = 7, limit = 100 } = {}) {
  const since = addDays(currentDay(db, { id: childId }), -(Math.max(1, days) - 1));
  return db.prepare(`SELECT * FROM time_adjustments WHERE child_id=? AND date >= ?
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(childId, since, limit);
}
