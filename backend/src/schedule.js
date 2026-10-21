// Checklist schedule rules. All math is on YYYY-MM-DD keys using UTC arithmetic.
import { HttpError } from './httpError.js';
import { addDays } from './clock.js';

const bad = msg => new HttpError(400, msg);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const onlyKeys = (obj, keys) => Object.keys(obj).every(k => keys.includes(k));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function validateSchedule(input) {
  if (!isObj(input)) throw bad('schedule must be an object');
  switch (input.type) {
    case 'daily':
      if (!onlyKeys(input, ['type'])) throw bad('daily schedule takes no other fields');
      return { type: 'daily' };
    case 'weekly': {
      if (!onlyKeys(input, ['type', 'days'])) throw bad('unknown weekly schedule field');
      const { days } = input;
      if (!Array.isArray(days) || !days.length || !days.every(d => isInt(d, 0, 6))) {
        throw bad('weekly days must be a non-empty list of integers 0-6');
      }
      return { type: 'weekly', days: [...new Set(days)].sort((a, b) => a - b) };
    }
    case 'monthly': {
      if (!onlyKeys(input, ['type', 'rules'])) throw bad('unknown monthly schedule field');
      const { rules } = input;
      if (!Array.isArray(rules) || !rules.length) throw bad('monthly rules must be a non-empty list');
      return { type: 'monthly', rules: rules.map(validateRule) };
    }
    default:
      throw bad('unknown schedule type');
  }
}

function validateRule(r) {
  if (!isObj(r)) throw bad('monthly rule must be an object');
  if ('date' in r) {
    if (!onlyKeys(r, ['date']) || !isInt(r.date, 1, 31)) throw bad('monthly date rule must be {date: 1-31}');
    return { date: r.date };
  }
  if (!onlyKeys(r, ['nth', 'weekday'])
    || !(isInt(r.nth, 1, 4) || r.nth === 'last') || !isInt(r.weekday, 0, 6)) {
    throw bad('monthly rule must be {date} or {nth: 1-4|"last", weekday: 0-6}');
  }
  return { nth: r.nth, weekday: r.weekday };
}

function ruleMatches(rule, day, weekday, daysInMonth) {
  if ('date' in rule) return day === Math.min(rule.date, daysInMonth);
  if (weekday !== rule.weekday) return false;
  return rule.nth === 'last' ? day + 7 > daysInMonth : Math.ceil(day / 7) === rule.nth;
}

export function isScheduled(schedule, dateKey) {
  if (schedule.type === 'daily') return true;
  const d = new Date(`${dateKey}T00:00:00Z`);
  const weekday = d.getUTCDay();
  if (schedule.type === 'weekly') return schedule.days.includes(weekday);
  const day = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return schedule.rules.some(r => ruleMatches(r, day, weekday, daysInMonth));
}

export function scheduledDatesBetween(schedule, fromKey, toKey) {
  const out = [];
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) {
    if (isScheduled(schedule, k)) out.push(k);
  }
  return out;
}
