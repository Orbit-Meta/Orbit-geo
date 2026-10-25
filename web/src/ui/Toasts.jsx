import { Calendar, Clock, Pin } from './icons.jsx';

const ICONS = { arrival: Pin, late: Clock, shift: Calendar };

export function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast glass toast-${t.kind} ${t.leaving ? 'leaving' : ''}`}>
            <span className="toast-icon" style={t.color ? { '--c': t.color } : undefined}>
              {t.initial && t.kind !== 'shift' ? t.initial : Icon ? <Icon /> : '•'}
            </span>
            <span className="toast-text">{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
