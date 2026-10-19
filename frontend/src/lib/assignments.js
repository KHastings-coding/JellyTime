export function allKidsAssignment(kids) {
  return kids.map(k => ({ childId: k.id, minutesOverride: null }));
}

// "All kids" / "Sam, Alex (10m)" / "Not assigned to anyone"
export function assignmentLabel(assignments = [], kids) {
  if (assignments.length === 0) return 'Not assigned to anyone';
  const everyone = kids.length > 1 && assignments.length === kids.length && assignments.every(a => a.minutesOverride === null);
  if (everyone) return 'All kids';
  return assignments.map(a => {
    const kid = kids.find(k => k.id === a.childId);
    const name = kid ? kid.name : 'Removed kid';
    return a.minutesOverride === null ? name : `${name} (${a.minutesOverride}m)`;
  }).join(', ');
}
