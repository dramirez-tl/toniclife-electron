// "Puntos de la compra" del ticket (13-nov-2026, Buen Fin): manda el servidor,
// también cuando dice 0; el respaldo son los puntos del carrito YA con las
// promociones de temporada, nunca los puntos de lista.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PosCartItemPromo, QuickProduct } from '@/types/pos';
import { nowLocalIso } from '@/lib/date';
import { usePosCartStore, type SeasonalContext } from '@/stores/pos-cart.store';
import type { SeasonalPromotionDef } from './seasonalPromotions';
import { localSeasonalGiftLines, receiptSalePoints, seasonalLineLabel } from './seasonalReceipt';

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

describe('renglones con sabores que se combinan (14-nov-2026)', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const promo = (over: Partial<PosCartItemPromo> = {}): PosCartItemPromo => ({
    promotionId: 'promo',
    code: 'PROMO',
    name: 'Compra 5 y llévate 1',
    type: 'nxm',
    typeLabel: '6x5',
    freeQuantity: 0,
    discountAmount: 0,
    points: 0,
    businessValue: 0,
    kitBonusExcluded: false,
    ...over,
  });

  it('la etiqueta del renglón dice el grupo: se entiende por qué dos sabores van juntos', () => {
    expect(seasonalLineLabel(promo({ groupName: '24 Shake' }), fmt)).toBe('6x5 · 24 Shake');
    expect(seasonalLineLabel(promo({ groupName: '24 Shake', freeQuantity: 1, discountAmount: 363 }), fmt)).toBe(
      '6x5 · 24 Shake: 1 pieza gratis',
    );
    expect(seasonalLineLabel(promo({ groupName: '24 Shake', freeQuantity: 2 }), fmt)).toBe(
      '6x5 · 24 Shake: 2 piezas gratis',
    );
  });

  it('sin grupo la etiqueta es la de siempre', () => {
    expect(seasonalLineLabel(promo(), fmt)).toBe('6x5');
    expect(seasonalLineLabel(promo({ typeLabel: '3x2', freeQuantity: 1 }), fmt)).toBe('3x2: 1 pieza gratis');
    expect(
      seasonalLineLabel(promo({ type: 'percent_off', typeLabel: '20% de descuento', discountAmount: 40 }), fmt),
    ).toBe('20% de descuento: -$40.00');
  });

  it('el carrito anota el grupo en cada renglón, y el renglón que sale gratis completo va como regalo en el ticket', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(null);
    store.clearCart();
    store.setSeasonalContext(
      ctx([
        def({
          config: {
            buy: 6,
            pay: 5,
            sameProductOnly: true,
            groups: [{ name: '24 Shake', productIds: ['van', 'choc'] }],
          },
          eligibleProductIds: ['van', 'choc', 'mix'],
        }),
      ]),
    );
    // 1 de chocolate ($300) + 5 de vainilla ($363): el grupo completa las 6 y
    // la gratis es la más barata, que es la ÚNICA pieza de su renglón.
    store.addItem(product('choc', 300, 10), 1);
    store.addItem(product('van', 363, 10), 5);
    const cart = usePosCartStore.getState().cart;
    expect(cart.items.map((i) => [i.productId, i.quantity, i.promo?.freeQuantity])).toEqual([
      ['choc', 1, 1],
      ['van', 5, 0],
    ]);
    expect(cart.total).toBe(5 * 363);
    expect(cart.items.every((i) => i.promo?.groupName === '24 Shake')).toBe(true);
    const gifts = localSeasonalGiftLines(cart);
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ quantity: 1, unitPrice: 0, total: 0, gift: true, promoLabel: 'Regalo 6x5' });
    // La gratis es la más barata del grupo.
    expect(gifts[0].name).toBe('Producto choc');
    store.setSeasonalContext(null);
    store.clearCart();
  });

  it('un producto fuera de grupo no lleva nombre de grupo', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(null);
    store.clearCart();
    store.setSeasonalContext(
      ctx([
        def({
          config: {
            buy: 6,
            pay: 5,
            sameProductOnly: true,
            groups: [{ name: '24 Shake', productIds: ['van', 'choc'] }],
          },
          eligibleProductIds: ['van', 'choc', 'mix'],
        }),
      ]),
    );
    store.addItem(product('mix', 471, 10), 6);
    const [line] = usePosCartStore.getState().cart.items;
    expect(line.promo?.freeQuantity).toBe(1);
    expect(line.promo?.groupName).toBeUndefined();
    store.setSeasonalContext(null);
    store.clearCart();
  });
});
