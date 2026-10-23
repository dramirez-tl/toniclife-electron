// outboxSync.ts - Sincronizador de la cola local de ventas (POS 2.0.81).
//
// Recorre los registros pendientes en orden (del más viejo al más nuevo) y
// completa en el servidor lo que falte: crear la venta (idempotente por
// clientRequestId, con soldAt = hora real de la caja y queuedOffline para que
// el API la acepte aunque ya no haya existencia) y cobrarla (el API devuelve
// el cobro original si ya estaba cobrada). Un error de red detiene la vuelta
// (no tiene caso martillar); un rechazo definitivo del servidor marca el
// registro "requiere atención" y sigue con el siguiente.
//
// Se dispara al arrancar el POS, cada 30 s, al recuperar red (evento online)
// y después de cada cobro exitoso.

import axios from 'axios';
import { toast } from 'sonner';
import { posApi } from '@/lib/posApi';
import { isTransientApiError } from '@/lib/api';
import { PosSaleStatus } from '@/types/pos';
import {
  useSalesOutboxStore,
  type QueuedSale,
} from '@/stores/sales-outbox.store';

const SYNC_INTERVAL_MS = 30_000;

type SyncedListener = (queued: QueuedSale, saleNumber: string) => void;
const listeners = new Set<SyncedListener>();

/** Avisa cuando una venta de la cola quedó cobrada en el servidor. */
export function onOutboxSynced(cb: SyncedListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function httpStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/** Vale la pena volver a intentar más tarde (red, servidor caído o cobro en curso). */
export function isQueueRetryableError(err: unknown): boolean {
  if (isTransientApiError(err)) return true;
  const status = httpStatus(err);
  if (status === undefined) return false;
  return status >= 500 || status === 409 || status === 429 || status === 408;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: unknown } | undefined;
    const msg = data?.message;
    if (Array.isArray(msg)) return msg.join(' · ');
    if (typeof msg === 'string' && msg) return msg;
    if (!err.response) return 'Sin conexión con el servidor';
    return `Error del servidor (HTTP ${err.response.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

let running = false;
let started = false;
let timer: number | null = null;

function emitSynced(q: QueuedSale, saleNumber: string): void {
  listeners.forEach((cb) => {
    try {
      cb(q, saleNumber);
    } catch (err) {
      console.error('[outbox] listener', err);
    }
  });
}

/** Devuelve false si hay que detener la vuelta (red caída). */
async function syncOne(q: QueuedSale): Promise<boolean> {
  const store = useSalesOutboxStore.getState();
  const now = () => new Date().toISOString();
  const mark = (changes: Partial<QueuedSale>) =>
    store.patch(q.id, { ...changes, lastTriedAt: now() });

  try {
    let saleId = q.saleId;
    let saleNumber = q.saleNumber;
    if (q.stage === 'create' || !saleId) {
      const sale = await posApi.createSale({
        ...q.createInput,
        clientRequestId: q.clientRequestId,
        soldAt: q.soldAt,
        queuedOffline: true,
      });
      saleId = sale.id;
      saleNumber = sale.saleNumber;
      mark({
        saleId,
        saleNumber,
        stage: 'pay',
        attempts: q.attempts + 1,
        lastError: null,
      });
    }
    const result = await posApi.processPayment({ saleId, payments: q.payments });
    store.remove(q.id);
    const finalNumber = result.saleNumber ?? saleNumber ?? q.provisionalNumber;
    toast.success(
      `Venta sincronizada: ${finalNumber}${q.customerLabel ? ` · ${q.customerLabel}` : ''} (ticket provisional ${q.provisionalNumber}).`,
      { duration: 8000 },
    );
    if (q.invoice) {
      toast.info(
        `La venta ${finalNumber} pidió factura: tímbrala desde Ventas recientes.`,
        { duration: 10000 },
      );
    }
    emitSynced(q, finalNumber);
    return true;
  } catch (err) {
    if (isQueueRetryableError(err)) {
      mark({ attempts: q.attempts + 1, lastError: errorMessage(err) });
      return false;
    }

    const status = httpStatus(err);
    const msg = errorMessage(err);

    // La venta ya existía y cambió de estado en el servidor (p. ej. la
    // canceló el cron de pendientes o la cobró otra terminal): decidir con
    // su estado real en vez de rendirse.
    if (
      q.stage === 'pay' &&
      q.saleId &&
      (status === 404 || /no est[aá] pendiente/i.test(msg))
    ) {
      try {
        const sale = await posApi.getSaleById(q.saleId);
        if (sale.status === PosSaleStatus.COMPLETED) {
          store.remove(q.id);
          toast.success(`La venta ${sale.saleNumber} ya estaba cobrada en el servidor.`);
          emitSynced(q, sale.saleNumber);
          return true;
        }
        if (sale.status === PosSaleStatus.CANCELLED) {
          mark({
            stage: 'create',
            saleId: null,
            saleNumber: null,
            clientRequestId: crypto.randomUUID(),
            attempts: q.attempts + 1,
            lastError:
              'La venta pendiente se canceló en el servidor; se vuelve a crear en el siguiente intento.',
          });
          return true;
        }
      } catch (lookupErr) {
        if (isQueueRetryableError(lookupErr)) {
          mark({ attempts: q.attempts + 1, lastError: errorMessage(lookupErr) });
          return false;
        }
      }
    }

    mark({ attempts: q.attempts + 1, lastError: msg, needsAttention: true });
    toast.error(
      `La venta guardada ${q.provisionalNumber} no se pudo sincronizar: ${msg}. Revísala en "Ventas por sincronizar".`,
      { duration: 12000 },
    );
    return true;
  }
}

/** Una vuelta completa por la cola. Reentrante: si ya corre, no hace nada. */
export async function syncOutbox(): Promise<void> {
  if (running) return;
  const store = useSalesOutboxStore.getState();
  if (!store.hydrated) return;
  running = true;
  store.setSyncing(true);
  try {
    const pending = [...useSalesOutboxStore.getState().items]
      .filter((i) => !i.needsAttention)
      .sort((a, b) => a.soldAt.localeCompare(b.soldAt));
    for (const q of pending) {
      const keepGoing = await syncOne(q);
      if (!keepGoing) break;
    }
  } finally {
    useSalesOutboxStore.getState().setSyncing(false);
    running = false;
  }
}

export function syncNow(): void {
  void syncOutbox();
}

/** Arranca el ciclo (una sola vez por sesión del POS). Devuelve el stop. */
export function startOutboxSync(): () => void {
  if (started) return () => {};
  started = true;
  const run = () => void syncOutbox();
  void useSalesOutboxStore.getState().hydrate().then(run);
  timer = window.setInterval(run, SYNC_INTERVAL_MS);
  window.addEventListener('online', run);
  return () => {
    started = false;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    window.removeEventListener('online', run);
  };
}
