// JellyTime's notion of "today": the date in the configured timezone, with the
// day starting at the configured reset time rather than midnight.

export const DEFAULT_TIMEZONE = 'America/Denver';
export const DEFAULT_RESET_TIME = '00:00';
const RESET_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidResetTime(value) {
  return typeof value === 'string' && RESET_TIME_RE.test(value);
}

export function isValidTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayKeyFor(now, timezone, resetTime) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const [rh, rm] = resetTime.split(':').map(Number);
  const minutesNow = Number(parts.hour) * 60 + Number(parts.minute);
  return minutesNow < rh * 60 + rm ? addDays(date, -1) : date;
}

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function getClockSettings(db) {
  const get = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  let timezone = get('timezone') ?? DEFAULT_TIMEZONE;
  let resetTime = get('reset_time') ?? DEFAULT_RESET_TIME;
  if (!isValidTimezone(timezone)) {
    warnOnce(`tz:${timezone}`, `[JellyTime] Invalid stored timezone "${timezone}", using ${DEFAULT_TIMEZONE}`);
    timezone = DEFAULT_TIMEZONE;
  }
  if (!isValidResetTime(resetTime)) {
    warnOnce(`reset:${resetTime}`, `[JellyTime] Invalid stored reset_time "${resetTime}", using ${DEFAULT_RESET_TIME}`);
    resetTime = DEFAULT_RESET_TIME;
  }
  return { timezone, resetTime };
}

export function today(db, now = new Date()) {
  const { timezone, resetTime } = getClockSettings(db);
  return dayKeyFor(now, timezone, resetTime);
}

// Offset (ms) of `timezone` from UTC at instant `t` (ms): wall-clock of t in tz, read as UTC, minus t.
function tzOffsetMs(t, timezone) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const p of fmt.formatToParts(new Date(t))) parts[p.type] = p.value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(t / 1000) * 1000;
}

// The instant at which the wall clock in `timezone` reads dateKey hh:mm.
export function localTimeToInstant(dateKey, hhmm, timezone) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess, timezone);
  t = guess - tzOffsetMs(t, timezone); // second pass settles DST edges
  return new Date(t);
}

// Deadline for a run dated dateKey. A deadline at or before the reset time belongs to the next
// calendar date (the "day" runs past midnight); one equal to the reset time is the end of the day.
export function deadlineInstant(dateKey, deadline, timezone, resetTime) {
  if (deadline == null) return null;
  const day = deadline > resetTime ? dateKey : addDays(dateKey, 1);
  return localTimeToInstant(day, deadline, timezone);
}
