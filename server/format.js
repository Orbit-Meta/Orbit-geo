export const fmtClock = (ms) =>
  ms == null ? '—' : new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
