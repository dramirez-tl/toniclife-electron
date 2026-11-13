// "Puntos de la compra" del ticket (13-nov-2026, Buen Fin): manda el servidor,
// también cuando dice 0; el respaldo son los puntos del carrito YA con las
// promociones de temporada, nunca los puntos de lista.

import { beforeEach, describe, expect, it } from 'vitest';
import type { QuickProduct } from '@/types/pos';
import { nowLocalIso } from '@/lib/date';
import { usePosCartStore, type SeasonalContext } from '@/stores/pos-cart.store';
import type { SeasonalPromotionDef } from './seasonalPromotions';
import { receiptSalePoints } from './seasonalReceipt';

const TZ = 'America/Mexico_City';

const product = (id: string, price: number, points: number): QuickProduct =>
  ({
    id,
    sku: id.toUpperCase(),
    name: `Producto ${id}`,
    basePrice: price,
    points,
    businessVolume: 0,
    taxRate: 0.16,
    isIncludedInPrice: true,
    stock: 50,
  }) as QuickProduct;

/** Ventana que SIEMPRE incluye el "ahora" local (el motor compara texto). */
function window(): { startsAt: string; endsAt: string } {
  const y = Number(nowLocalIso(TZ).slice(0, 4));
  return { startsAt: `${y - 1}-01-01T00:00:00`, endsAt: `${y + 1}-12-31T23:59:59` };
}

const def = (over: Partial<SeasonalPromotionDef>): SeasonalPromotionDef => ({
  id: 'promo',
  code: 'PROMO',
  name: 'Promo',
  type: 'nxm',
  config: { buy: 3, pay: 2, sameProductOnly: true },
  seasonId: 'season',
  seasonCode: 'BUENFIN2026',
  seasonName: 'Buen Fin 2026',
  channels: ['pos'],
  countryCodes: ['MX'],
  ...window(),
  priority: 0,
  maxPerSale: null,
  pointsMode: 'keep',
  excludesKitBonus: false,
  eligibleProductIds: ['te'],
  gifts: [],
  ...over,
});

const ctx = (defs: SeasonalPromotionDef[]): SeasonalContext => ({
  defs,
  countryCode: 'MX',
  timezone: TZ,
  giftProducts: {},
});

/** Lo que imprimía el respaldo anterior: puntos de lista × cantidad. */
const listPoints = () =>
  usePosCartStore.getState().cart.items.reduce((s, it) => s + it.points * it.quantity, 0);

describe('receiptSalePoints', () => {
  it('manda el servidor, también cuando dice 0', () => {
    const cart = { customerId: 'c1', totalPoints: 3300 };
    expect(receiptSalePoints(0, cart)).toBe(0);
    expect(receiptSalePoints(1513, cart)).toBe(1513);
  });

  it('sin dato del servidor: los puntos del carrito si hay cliente; nada si no lo hay', () => {
    expect(receiptSalePoints(undefined, { customerId: 'c1', totalPoints: 240 })).toBe(240);
    expect(receiptSalePoints(null, { customerId: 'c1', totalPoints: 0 })).toBe(0);
    expect(receiptSalePoints(undefined, { customerId: undefined, totalPoints: 240 })).toBeUndefined();
  });

  describe('con el carrito real', () => {
    beforeEach(() => {
      usePosCartStore.getState().setSeasonalContext(null);
      usePosCartStore.getState().clearCart();
    });

    it('kit a precio especial "sin puntos": el respaldo imprime 0, no los 3,300 de lista', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(
        ctx([
          def({
            type: 'fixed_price',
            config: { prices: { MX: 2000 } },
            eligibleProductIds: ['kit'],
            pointsMode: 'none',
            excludesKitBonus: true,
          }),
        ]),
      );
      store.setCustomer('c1', 'Distribuidor');
      store.addItem({ ...product('kit', 2789, 3300), isEnrollmentKit: true } as QuickProduct, 1);
      const cart = usePosCartStore.getState().cart;
      expect(cart.total).toBe(2000);
      expect(listPoints()).toBe(3300);
      expect(cart.totalPoints).toBe(0);
      expect(receiptSalePoints(undefined, cart)).toBe(0);
    });

    it('3x2: el respaldo cuenta solo las piezas cobradas (la gratis no da puntos)', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([def({})]));
      store.setCustomer('c1', 'Distribuidor');
      store.addItem(product('te', 120, 10), 3);
      const cart = usePosCartStore.getState().cart;
      expect(listPoints()).toBe(30);
      expect(receiptSalePoints(undefined, cart)).toBe(20);
    });

    it('sin promociones el respaldo es la suma de siempre', () => {
      const store = usePosCartStore.getState();
      store.setCustomer('c1', 'Distribuidor');
      store.addItem(product('te', 120, 10), 2);
      const cart = usePosCartStore.getState().cart;
      expect(receiptSalePoints(undefined, cart)).toBe(20);
      expect(receiptSalePoints(undefined, cart)).toBe(listPoints());
    });
  });
});
