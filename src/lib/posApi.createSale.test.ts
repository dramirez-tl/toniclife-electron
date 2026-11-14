// POST /pos/sales: la caja le dice al servidor con qué nivel del motor de
// promociones de temporada calculó la venta (14-nov-2026). Viaja en la QUERY:
// un API anterior la ignora; en el cuerpo la rechazaría su validación.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('./api', () => ({ api: { post: mocks.post, get: vi.fn() } }));

import { posApi } from './posApi';
import type { CreateSaleInput } from '@/types/pos';

const INPUT = {
  sessionId: 'session-1',
  items: [{ productId: 'van', quantity: 3 }],
} as unknown as CreateSaleInput;

describe('posApi.createSale: nivel del motor de temporada', () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.post.mockImplementation(() =>
      Promise.resolve({ data: { id: 'sale-1' } }),
    );
  });

  it('con nivel: va en la query y el cuerpo queda intacto', async () => {
    const sale = await posApi.createSale(INPUT, 2);
    expect(sale).toEqual({ id: 'sale-1' });
    const [url, body, config] = mocks.post.mock.calls[0];
    expect(url).toBe('/pos/sales');
    expect(body).toBe(INPUT);
    expect(config.params).toEqual({ seasonalEngine: 2 });
    expect(config.timeout).toBeGreaterThan(0);
  });

  it('sin nivel (venta que un POS anterior dejó en la cola): no se manda nada', async () => {
    await posApi.createSale(INPUT, null);
    await posApi.createSale(INPUT);
    for (const call of mocks.post.mock.calls) {
      expect(call[0]).toBe('/pos/sales');
      expect(call[2]).not.toHaveProperty('params');
    }
  });
});
