const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Sun = () => (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const Moon = () => (
  <svg {...base}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const Check = (p) => (
  <svg {...base} {...p}><path d="M5 12.5l4.2 4.2L19 7" /></svg>
);
export const Close = () => (
  <svg {...base} width={14} height={14}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Grip = () => (
  <svg {...base} width={14} height={14} strokeWidth={0} fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
);
export const Overview = () => (
  <svg {...base}><path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" /><path d="M9 4v13.5M15 6.5V20" /></svg>
);
export const Pin = () => (
  <svg {...base}><path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const Clock = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const Calendar = () => (
  <svg {...base}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const Battery = ({ pct }) => (
  <svg {...base} width={20} height={14} viewBox="0 0 28 16">
    <rect x="1" y="2" width="22" height="12" rx="3" />
    <rect x="3.5" y="4.5" width={Math.max(1, (17 * (pct ?? 0)) / 100)} height="7" rx="1.5" fill="currentColor" stroke="none" />
    <path d="M26 6.5v3" />
  </svg>
);
export const OrbitMark = () => <img className="orbit-mark" src="/orbit-logo.png" width="40" height="40" alt="" aria-hidden="true" />;
