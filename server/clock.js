// A virtual clock so replay and simulate run through the exact same time math
// as live mode. Live: virtual time === wall time, rate 1.
let anchorReal = Date.now();
let anchorVirtual = anchorReal;
let rate = 1;

export const clock = {
  now: () => anchorVirtual + (Date.now() - anchorReal) * rate,
  get rate() {
    return rate;
  },
  set(virtualMs, newRate = rate) {
    anchorVirtual = virtualMs;
    anchorReal = Date.now();
    rate = newRate;
  },
  setRate(newRate) {
    clock.set(clock.now(), newRate);
  },
  reset() {
    clock.set(Date.now(), 1);
  },
  snapshot: () => ({ now: clock.now(), rate }),
};

/** setTimeout measured in virtual milliseconds. */
export function setVirtualTimeout(fn, virtualMs) {
  return setTimeout(fn, Math.max(0, virtualMs / rate));
}
