import { Overview } from './icons.jsx';

export function CameraControls({ camera, people, onOverview, onFollow }) {
  const located = people.filter((p) => p.location);
  return (
    <div className="camera-controls glass" role="toolbar" aria-label="Camera">
      <button type="button" className={`cc-btn ${camera.mode === 'overview' ? 'active' : ''}`} onClick={onOverview}>
        <Overview /> Overview
      </button>
      {located.length > 0 && <span className="cc-sep" />}
      {located.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`cc-avatar ${camera.mode === 'follow' && camera.followId === p.id ? 'active' : ''}`}
          style={{ '--c': p.color }}
          onClick={() => onFollow(p.id)}
          title={`Follow ${p.display_name}`}
          aria-label={`Follow ${p.display_name}`}
        >
          {p.initial}
        </button>
      ))}
    </div>
  );
}
