// useConnectionStatus - Estado de conectividad de la terminal POS.
//
// Combina dos señales, sin acoplarse a un endpoint de negocio:
//   1. navigator.onLine -> detecta "sin red" a nivel del sistema operativo
//      (cable desconectado / wifi apagado) de forma inmediata.
//   2. Sonda de latencia -> fetch en modo 'no-cors' contra el ORIGEN del API
//      (no el prefix /api/v1) midiendo el round-trip. Si la promesa falla o
//      expira, el servidor es inalcanzable aunque el SO crea que hay red;
//      si responde lento, marcamos la conexion como "lenta".
//
// El modo 'no-cors' evita falsos negativos por CORS: nos basta saber si el
// origen responde y en cuanto tiempo, no leer el cuerpo.

import { useEffect, useRef, useState } from 'react';

export type ConnectionQuality = 'online' | 'slow' | 'offline';

const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

const PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;
const SLOW_THRESHOLD_MS = 1_200;

export interface ConnectionStatus {
  status: ConnectionQuality;
  /** Ultima latencia medida en ms (null si offline o sin medir aun). */
  latency: number | null;
}

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionQuality>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );
  const [latency, setLatency] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    async function probe() {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!cancelled.current) {
          setStatus('offline');
          setLatency(null);
        }
        return;
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const start = performance.now();
      try {
        await fetch(API_ORIGIN, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        const elapsed = Math.round(performance.now() - start);
        if (!cancelled.current) {
          setLatency(elapsed);
          setStatus(elapsed > SLOW_THRESHOLD_MS ? 'slow' : 'online');
        }
      } catch {
        // AbortError (timeout) o error de red -> servidor inalcanzable.
        if (!cancelled.current) {
          setStatus('offline');
          setLatency(null);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    void probe();
    const interval = setInterval(() => void probe(), PROBE_INTERVAL_MS);

    const onOnline = () => void probe();
    const onOffline = () => {
      setStatus('offline');
      setLatency(null);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled.current = true;
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { status, latency };
}
