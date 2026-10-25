import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const TOAST_MS = 4800;
const TOAST_EXIT_MS = 380;

/** Live server state + toasts over Socket.IO. */
export function useOrbit() {
  const [snap, setSnap] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (state) => {
      state._recv = Date.now();
      setSnap(state);
    });
    socket.on('toast', (toast) => {
      setToasts((ts) => [...ts.filter((t) => !t.leaving).slice(-3), toast]);
      setTimeout(() => setToasts((ts) => ts.map((t) => (t.id === toast.id ? { ...t, leaving: true } : t))), TOAST_MS);
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), TOAST_MS + TOAST_EXIT_MS);
    });
    return () => socket.close();
  }, []);

  return { snap, toasts, connected };
}

/** The server's virtual "now" (replay/simulate run faster than wall time). */
export function virtualNow(snap) {
  if (!snap) return Date.now();
  return snap.clock.now + (Date.now() - snap._recv) * snap.clock.rate;
}

/** Re-renders the caller every `ms`. */
export function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Phones count as stale after 2 minutes (of wall time, even at 10x). */
export function staleAfterMs(snap) {
  return (snap?.settings?.stale_after_s ?? 120) * 1000 * Math.max(1, snap?.clock?.rate ?? 1);
}
