import { driftTone, fmtDrift } from '../lib/format.js';
import { Check } from './icons.jsx';

export function DriftBadge({ drift, state, settings }) {
  if (state === 'completed') {
    return (
      <span className="badge tone-neutral">
        <Check width={12} height={12} /> Done
      </span>
    );
  }
  const tone = driftTone(drift, settings);
  return <span className={`badge tone-${tone}`}>{drift == null ? 'Waiting' : fmtDrift(drift)}</span>;
}
