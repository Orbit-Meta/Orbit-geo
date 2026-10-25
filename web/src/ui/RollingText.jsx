import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/motion.js';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Odometer-style text: digits roll to their new value and the change briefly glows. */
export function RollingText({ text, className = '' }) {
  const reduced = useReducedMotion();
  const [flash, setFlash] = useState(false);
  const prev = useRef(text);

  useEffect(() => {
    if (prev.current === text) return undefined;
    const hadValue = prev.current && prev.current !== '—';
    prev.current = text;
    if (!hadValue) return undefined;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [text]);

  const chars = [...(text ?? '—')];
  return (
    <span className={`roll ${flash ? 'flash' : ''} ${reduced ? 'static' : ''} ${className}`} aria-label={text}>
      {chars.map((ch, i) => {
        const key = chars.length - i; // align from the right so "9:59" → "10:00" rolls in place
        if (!/\d/.test(ch)) return <span key={`c${key}`} className="roll-char" aria-hidden="true">{ch}</span>;
        return (
          <span key={`d${key}`} className="roll-digit" aria-hidden="true">
            <span className="roll-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {DIGITS.map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
