/* global google */
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/maps.js';

/** Google Places Autocomplete (new PlaceAutocompleteElement) → onPick({name, address, lat, lng}). */
export function StopSearch({ mapsKey, bias, onPick }) {
  const hostRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const biasRef = useRef(bias);
  biasRef.current = bias;
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mapsKey) return undefined;
    let el = null;
    let cancelled = false;
    (async () => {
      try {
        await loadGoogleMaps(mapsKey);
        const places = await google.maps.importLibrary('places');
        if (cancelled) return;
        if (!places.PlaceAutocompleteElement) throw new Error('Places Autocomplete is unavailable — enable "Places API (New)"');
        el = new places.PlaceAutocompleteElement();
        el.className = 'place-input';
        el.setAttribute('placeholder', 'Add a stop…');
        if (biasRef.current) el.locationBias = { center: biasRef.current, radius: 25_000 };

        const handle = async (place) => {
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
          pickRef.current({
            name: place.displayName,
            address: place.formattedAddress ?? '',
            lat: place.location.lat(),
            lng: place.location.lng(),
            place_id: place.id,
          });
          setError(null);
        };
        // Newer API versions fire gmp-select; older ones gmp-placeselect.
        el.addEventListener('gmp-select', (e) => handle(e.placePrediction.toPlace()).catch((x) => setError(x.message)));
        el.addEventListener('gmp-placeselect', (e) => handle(e.place).catch((x) => setError(x.message)));
        hostRef.current.appendChild(el);
      } catch (err) {
        setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [mapsKey]);

  return (
    <div className="stop-search">
      <div ref={hostRef} className="stop-search-host" />
      {error && <div className="hint error">{error}</div>}
    </div>
  );
}
