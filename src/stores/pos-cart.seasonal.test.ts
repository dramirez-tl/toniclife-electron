// Promociones de temporada (mig 186) en el carrito del POS: el motor local
// anota las líneas (3x2 → piezas gratis sin puntos; precio especial →
// descuento de línea) y lista los regalos; sin definiciones vigentes el
// carrito queda como siempre.

import { beforeEach, describe, expect, it } from 'vitest';
import type { QuickProduct } from '@/types/pos';
import type { SeasonalPromotionDef } from '@/lib/seasonalPromotions';
import { nowLocalIso } from '@/lib/date';
import {
  EMPTY_SEASONAL,
  calculateCartTotals,
  cartGrossTotal,
  usePosCartStore,
  type SeasonalContext,
} from './pos-cart.store';

const TZ = 'America/Mexico_City';

const product = (id: string, price: number, points = 10): QuickProduct =>
  ({
    id,
    sku: id.toUpperCase(),
    name: `Producto ${id}`,
    basePrice: price,
    points,
    businessVolume: price,
    taxRate: 0.16,
    isIncludedInPrice: true,
    stock: 50,
  }) as QuickProduct;

/** Ventana que SIEMPRE incluye el "ahora" local (el motor compara texto). */
function window(): { startsAt: string; endsAt: string } {
  const now = nowLocalIso(TZ);
  const y = Number(now.slice(0, 4));
  return { startsAt: `${y - 1}-01-01T00:00:00`, endsAt: `${y + 1}-12-31T23:59:59` };
}

function ctx(defs: SeasonalPromotionDef[]): SeasonalContext {
  return {
    defs,
    countryCode: 'MX',
    timezone: TZ,
    giftProducts: { shaker: { sku: 'SHK', name: 'Shaker' } },
  };
}

const base = (id: string, type: SeasonalPromotionDef['type']): SeasonalPromotionDef => ({
  id,
  code: id.toUpperCase(),
  name: `Promo ${id}`,
  type,
  config: { buy: 3, pay: 2, sameProductOnly: true },
  seasonId: 'season',
  seasonCode: 'BF',
  seasonName: 'Buen Fin',
  channels: ['pos'],
  countryCodes: ['MX'],
  ...window(),
  priority: 0,
  maxPerSale: null,
  pointsMode: 'keep',
  excludesKitBonus: false,
  eligibleProductIds: ['te'],
  gifts: [],
});

describe('carrito del POS con promociones de temporada', () => {
  beforeEach(() => {
    usePosCartStore.getState().setSeasonalContext(null);
    usePosCartStore.getState().clearCart();
  });

  it('3x2: la tercera pieza sale gratis, sin puntos, y el total baja; lo que viaja al API no cambia', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
    store.addItem(product('te', 120), 3);
    const cart = usePosCartStore.getState().cart;
    const line = cart.items[0];
    expect(line.quantity).toBe(3);
    expect(line.promo).toMatchObject({ code: 'BF-3X2', typeLabel: '3x2', freeQuantity: 1, discountAmount: 120 });
    expect(line.total).toBe(240);
    expect(line.discountAmount ?? 0).toBe(0);
    expect(cart.total).toBe(240);
    expect(cart.totalPoints).toBe(20);
    expect(cart.seasonalDiscount).toBe(120);
    expect(cart.seasonalApplied?.[0]).toMatchObject({ code: 'BF-3X2', times: 1, freeUnits: 1 });
    // Base del cupón = total con la promo ya aplicada.
    expect(cartGrossTotal(cart.items)).toBe(240);
  });

  it('precio especial: descuento de línea y "sin bono" solo para kits de inscripción', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(
      ctx([
        {
          ...base('kit-2000', 'fixed_price'),
          config: { prices: { MX: 2000 } },
          eligibleProductIds: ['kit'],
          excludesKitBonus: true,
        },
      ]),
    );
    store.addItem({ ...product('kit', 2789, 0), isEnrollmentKit: true } as QuickProduct, 1);
    const line = usePosCartStore.getState().cart.items[0];
    expect(line.promo).toMatchObject({ typeLabel: 'Precio especial', discountAmount: 789, kitBonusExcluded: true });
    expect(line.total).toBe(2000);
  });

  it('regalo por compra: el regalo se lista aparte con su nombre y no viaja como línea', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(
      ctx([
        {
          ...base('regalo', 'gift_with_purchase'),
          config: { minQuantity: 2, minAmount: null, repeat: false },
          gifts: [{ productId: 'shaker', quantity: 1 }],
        },
      ]),
    );
    store.addItem(product('te', 120), 2);
    const cart = usePosCartStore.getState().cart;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].promo).toBeUndefined();
    expect(cart.seasonalGifts).toEqual([
      expect.objectContaining({ productId: 'shaker', name: 'Shaker', sku: 'SHK', quantity: 1, promoCode: 'REGALO' }),
    ]);
  });

  it('al quitar el contexto (o fuera de vigencia) la promo desaparece y la línea vuelve a su precio', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
    store.addItem(product('te', 120), 3);
    expect(usePosCartStore.getState().cart.total).toBe(240);
    store.setSeasonalContext(null);
    const cart = usePosCartStore.getState().cart;
    expect(cart.items[0].promo).toBeUndefined();
    expect(cart.total).toBe(360);
    expect(cart.totalPoints).toBe(30);
    expect(cart.seasonalDiscount).toBe(0);
  });

  it('calculateCartTotals sin contexto deja las líneas tal cual (misma referencia)', () => {
    const cart = calculateCartTotals(
      {
        ...usePosCartStore.getState().cart,
        items: [
          {
            productId: 'te',
            productSku: 'TE',
            productName: 'Té',
            quantity: 3,
            unitPrice: 120,
            taxRate: 0.16,
            taxAmount: 0,
            isIncludedInPrice: true,
            subtotal: 0,
            total: 360,
            points: 10,
            businessVolume: 120,
          },
        ],
      },
      EMPTY_SEASONAL,
    );
    expect(cart.total).toBe(360);
    expect(cart.seasonalApplied).toEqual([]);
  });
});
