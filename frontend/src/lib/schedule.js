export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

function ruleLabel(rule) {
  if (rule.date !== undefined) return ordinal(rule.date);
  const nth = rule.nth === 'last' ? 'Last' : ordinal(rule.nth);
  return `${nth} ${DAY_SHORT[rule.weekday]}`;
}

export function scheduleLabel(schedule) {
  if (!schedule || schedule.type === 'daily') return 'Every day';
  if (schedule.type === 'weekly') {
    const days = [...new Set(schedule.days)].sort((a, b) => a - b);
    if (days.join(',') === '1,2,3,4,5') return 'Weekdays';
    if (days.join(',') === '0,6') return 'Weekends';
    return days.map(d => DAY_SHORT[d]).join(', ');
  }
  if (schedule.type === 'monthly') {
    return `Monthly: ${(schedule.rules || []).map(ruleLabel).join(' & ')}`;
  }
  return 'Every day';
}

// "20:30" -> "8:30 PM"
export function formatTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
