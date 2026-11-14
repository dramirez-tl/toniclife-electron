// Cola local de ventas y promociones de temporada (14-nov-2026): cada venta
// guardada recuerda con qué nivel del motor se calculó, y al sincronizar se le
// dice al servidor para que la valúe con esas mismas reglas. Una venta que dejó
// en la cola un POS anterior (sin ese dato) se manda sin nivel: el servidor la
// valúa con las reglas de antes, que son con las que se cobró.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSale: vi.fn(),
  processPayment: vi.fn(),
}));

vi.mock('@/lib/posApi', () => ({
  posApi: {
    createSale: mocks.createSale,
    processPayment: mocks.processPayment,
    getSaleById: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ isTransientApiError: () => false }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// El store guarda la cola en disco por el puente de Electron; aquí no hay.
vi.stubGlobal('window', {
  toniclife: {
    outbox: { save: () => Promise.resolve(), load: () => Promise.resolve([]) },
  },
});

import { syncOutbox } from './outboxSync';
import { SEASONAL_ENGINE_LEVEL } from './seasonalPromotions';
import {
  isQueuedSale,
  makeQueuedSale,
  useSalesOutboxStore,
  type QueuedSale,
} from '@/stores/sales-outbox.store';
import type { CreateSaleInput } from '@/types/pos';
import type { SaleReceiptPayload } from '@/types';

const INPUT = {
  sessionId: 'session-1',
  items: [{ productId: 'van', quantity: 3 }],
} as unknown as CreateSaleInput;

function queued(clientRequestId: string): QueuedSale {
  return makeQueuedSale({
    clientRequestId,
    createInput: INPUT,
    payments: [],
    invoice: null,
    saleId: null,
    saleNumber: null,
    branchCode: '164',
    customerLabel: null,
    receipt: { total: 100 } as unknown as Omit<
      SaleReceiptPayload,
      'saleNumber' | 'pendingSync'
    >,
  });
}

describe('cola local: nivel del motor de promociones con el que se cobró', () => {
  beforeEach(() => {
    mocks.createSale.mockReset();
    mocks.processPayment.mockReset();
    mocks.createSale.mockImplementation(() =>
      Promise.resolve({ id: 'sale-1', saleNumber: 'V-1' }),
    );
    mocks.processPayment.mockImplementation(() =>
      Promise.resolve({ saleNumber: 'V-1' }),
    );
    useSalesOutboxStore.setState({ items: [], hydrated: true, syncing: false });
  });

  it('la venta que se guarda ahora recuerda el nivel del motor de esta versión', () => {
    const q = queued('11111111-1111-4111-8111-111111111111');
    expect(q.seasonalEngine).toBe(SEASONAL_ENGINE_LEVEL);
    expect(isQueuedSale(q)).toBe(true);
  });

  it('un registro que dejó un POS anterior (sin nivel) sigue siendo válido', () => {
    const old = { ...queued('22222222-2222-4222-8222-222222222222') };
    delete old.seasonalEngine;
    expect(isQueuedSale(old)).toBe(true);
  });

  it('al sincronizar manda el nivel guardado; la venta de un POS anterior va sin nivel', async () => {
    const fresh = queued('11111111-1111-4111-8111-111111111111');
    const old = { ...queued('22222222-2222-4222-8222-222222222222') };
    delete old.seasonalEngine;
    // El más viejo primero (la cola se recorre por hora de venta).
    old.soldAt = '2026-11-14T09:00:00.000Z';
    fresh.soldAt = '2026-11-14T10:00:00.000Z';
    useSalesOutboxStore.setState({ items: [fresh, old] });

    await syncOutbox();

    expect(mocks.createSale).toHaveBeenCalledTimes(2);
    const [oldCall, freshCall] = mocks.createSale.mock.calls;
    expect(oldCall[0]).toMatchObject({
      sessionId: 'session-1',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      soldAt: '2026-11-14T09:00:00.000Z',
      queuedOffline: true,
    });
    expect(oldCall[1]).toBeNull();
    expect(freshCall[0]).toMatchObject({
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      queuedOffline: true,
    });
    expect(freshCall[1]).toBe(SEASONAL_ENGINE_LEVEL);
    // El nivel NO viaja en el cuerpo: un API anterior rechaza campos nuevos.
    expect(oldCall[0]).not.toHaveProperty('seasonalEngine');
    expect(freshCall[0]).not.toHaveProperty('seasonalEngine');
    // Cobradas las dos, la cola queda vacía.
    expect(mocks.processPayment).toHaveBeenCalledTimes(2);
    expect(useSalesOutboxStore.getState().items).toEqual([]);
  });
});
