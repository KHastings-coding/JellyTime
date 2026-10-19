// "30m daily + 15m banked" / "30m daily − 10m owed"
export function balanceBreakdown(s) {
  let text = `${s.daily_left}m daily`;
  if (s.banked > 0) text += ` + ${s.banked}m banked`;
  if (s.owed > 0) text += ` − ${s.owed}m owed`;
  return text;
}

export function formatAdjustment(a) {
  return `${a.minutes > 0 ? '+' : '−'}${Math.abs(Math.round(a.minutes))}m`;
}

export function formatTime(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
