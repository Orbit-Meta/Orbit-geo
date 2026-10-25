let loading = null;

/** Loads the Maps JavaScript API once. Resolves with `google.maps`. */
export function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__orbitMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => window.dispatchEvent(new CustomEvent('orbit:maps-auth-failure'));
    const params = new URLSearchParams({
      key,
      v: 'weekly',
      loading: 'async',
      libraries: 'marker,places',
      callback: '__orbitMapsReady',
    });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google Maps'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
