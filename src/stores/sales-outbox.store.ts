// sales-outbox.store.ts - Cola local de ventas ("primero se guarda, luego se
// envía"), POS 2.0.81.
//
// Al confirmar un cobro, el intento completo (carrito, pagos, factura pedida,
// clave de idempotencia y hora real) se escribe en disco ANTES de llamar al
// servidor (electron/outbox.ts, archivo atómico en userData). Cada paso que el
// servidor confirma actualiza el registro y al cobrar se borra. Si la red
// falla en cualquier punto, el registro se queda y `lib/outboxSync.ts` lo
// reintenta solo (al recuperar red, al arrancar y cada 30 s).
//
// Cada venta reintenta siempre con la MISMA clave de idempotencia: crear
// venta es idempotente por clientRequestId y cobrar devuelve el cobro original
// si la venta ya estaba cobrada, así que repetir nunca duplica.

import { create } from 'zustand';
import type {
  CreatePaymentInput,
  CreateSaleInput,
  InvoiceRequest,
} from '@/types/pos';
import type { SaleReceiptPayload } from '@/types';

/** Qué falta por hacer en el servidor. */
export type QueuedSaleStage = 'create' | 'pay';

export interface QueuedSale {
  /** Id local del registro. */
  id: string;
  /** Clave de idempotencia de "crear venta" (misma en todos los reintentos). */
  clientRequestId: string;
  stage: QueuedSaleStage;
  /** Lo que se manda a POST /pos/sales (sin clientRequestId/soldAt: se agregan al enviar). */
  createInput: CreateSaleInput;
  payments: CreatePaymentInput[];
  /** Factura solicitada al cobrar: se avisa al sincronizar (se timbra desde Ventas recientes). */
  invoice: InvoiceRequest | null;
  /** Hora real de la venta en la caja (ISO). */
  soldAt: string;
  /** Venta ya creada en el servidor (etapa 'pay'). */
  saleId: string | null;
  saleNumber: string | null;
  /** Folio que se imprimió en el ticket mientras no hay conexión. */
  provisionalNumber: string;
  customerLabel: string | null;
  total: number;
  attempts: number;
  lastError: string | null;
  lastTriedAt: string | null;
  /** El servidor la rechazó por algo que no se arregla reintentando: el cajero decide. */
  needsAttention: boolean;
  /** Ticket tal como se imprimió (para reimprimir). */
  receipt: SaleReceiptPayload;
}

interface SalesOutboxState {
  items: QueuedSale[];
  hydrated: boolean;
  syncing: boolean;
  hydrate: () => Promise<void>;
  upsert: (item: QueuedSale) => void;
  patch: (id: string, changes: Partial<QueuedSale>) => void;
  remove: (id: string) => void;
  setSyncing: (syncing: boolean) => void;
}

/** Forma mínima para aceptar un registro leído del disco. */
export function isQueuedSale(x: unknown): x is QueuedSale {
  if (!x || typeof x !== 'object') return false;
  const q = x as Record<string, unknown>;
  return (
    typeof q.id === 'string' &&
    typeof q.clientRequestId === 'string' &&
    (q.stage === 'create' || q.stage === 'pay') &&
    !!q.createInput &&
    Array.isArray(q.payments) &&
    typeof q.soldAt === 'string' &&
    typeof q.provisionalNumber === 'string' &&
    !!q.receipt
  );
}

function persist(items: QueuedSale[]): void {
  const api = window.toniclife?.outbox;
  if (!api) return;
  api.save(items).catch((err: unknown) => {
    console.error('[outbox] no se pudo guardar la cola local', err);
  });
}

export const useSalesOutboxStore = create<SalesOutboxState>()((set) => ({
  items: [],
  hydrated: false,
  syncing: false,

  hydrate: async () => {
    try {
      const raw = await window.toniclife.outbox.load();
      const items = raw.filter(isQueuedSale);
      set({ items, hydrated: true });
    } catch (err) {
      console.error('[outbox] no se pudo leer la cola local', err);
      set({ hydrated: true });
    }
  },

  upsert: (item) =>
    set((s) => {
      const exists = s.items.some((i) => i.id === item.id);
      const items = exists
        ? s.items.map((i) => (i.id === item.id ? item : i))
        : [...s.items, item];
      persist(items);
      return { items };
    }),

  patch: (id, changes) =>
    set((s) => {
      const items = s.items.map((i) => (i.id === id ? { ...i, ...changes } : i));
      persist(items);
      return { items };
    }),

  remove: (id) =>
    set((s) => {
      const items = s.items.filter((i) => i.id !== id);
      persist(items);
      return { items };
    }),

  setSyncing: (syncing) => set({ syncing }),
}));

/** Folio provisional del ticket mientras el servidor no asigna el real. */
export function provisionalSaleNumber(branchCode: string, at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const ss = String(at.getSeconds()).padStart(2, '0');
  return `PROV-${branchCode}-${hh}${mm}${ss}`;
}

/** Registro nuevo para un intento de cobro (se guarda antes de llamar al API). */
export function makeQueuedSale(args: {
  clientRequestId: string;
  createInput: CreateSaleInput;
  payments: CreatePaymentInput[];
  invoice: InvoiceRequest | null;
  saleId: string | null;
  saleNumber: string | null;
  branchCode: string;
  customerLabel: string | null;
  receipt: Omit<SaleReceiptPayload, 'saleNumber' | 'pendingSync'>;
}): QueuedSale {
  const now = new Date();
  const provisionalNumber = provisionalSaleNumber(args.branchCode, now);
  return {
    id: crypto.randomUUID(),
    clientRequestId: args.clientRequestId,
    stage: args.saleId ? 'pay' : 'create',
    createInput: args.createInput,
    payments: args.payments,
    invoice: args.invoice,
    soldAt: now.toISOString(),
    saleId: args.saleId,
    saleNumber: args.saleNumber,
    provisionalNumber,
    customerLabel: args.customerLabel,
    total: args.receipt.total,
    attempts: 0,
    lastError: null,
    lastTriedAt: null,
    needsAttention: false,
    receipt: {
      ...args.receipt,
      saleNumber: args.saleNumber ?? provisionalNumber,
      pendingSync: true,
    },
  };
}
