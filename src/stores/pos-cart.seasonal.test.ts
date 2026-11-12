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

  describe('la pieza gratis entra sola (12-nov-2026)', () => {
    const line = () => usePosCartStore.getState().cart.items[0];
    const notice = () => usePosCartStore.getState().autoGift;

    it('3x2: al llegar a 2 piezas el renglón queda en 3, se cobran 2 y el cajero ve el aviso', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 1);
      expect(line().quantity).toBe(1);
      expect(line().promo).toBeUndefined();
      const before = notice()?.seq ?? 0;
      store.addItem(product('te', 120), 1);
      expect(line().quantity).toBe(3);
      expect(line().promo).toMatchObject({ typeLabel: '3x2', freeQuantity: 1, discountAmount: 120 });
      const cart = usePosCartStore.getState().cart;
      expect(cart.total).toBe(240);
      expect(cart.totalPoints).toBe(20);
      expect(notice()).toMatchObject({ kind: 'added', text: '3x2: se agregó 1 pieza gratis de Producto te' });
      expect(notice()!.seq).toBeGreaterThan(before);
    });

    it('agregar 2 de golpe (clave,cantidad o lote) también trae la tercera; 5 de golpe trae la sexta', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 2);
      expect(line().quantity).toBe(3);
      expect(line().autoGiftPending).toBe(1);
      store.clearCart();
      store.addItem(product('te', 120), 5);
      expect(line().quantity).toBe(6);
      expect(line().promo?.freeQuantity).toBe(2);
      expect(usePosCartStore.getState().cart.total).toBe(480);
      // Capturar las 3 de golpe no agrega nada ni deja gratis "sin pasar".
      store.clearCart();
      store.addItem(product('te', 120), 3);
      expect(line().quantity).toBe(3);
      expect(line().autoGiftPending).toBeUndefined();
    });

    it('escáner: pasar la tercera pieza NO deja 4 (es la gratis que ya había entrado); la cantidad sigue a las piezas pasadas', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      const scan = () => {
        usePosCartStore.getState().addItem(product('te', 120), 1);
        return line().quantity;
      };
      // Piezas pasadas 1..9 → cantidad en el carrito.
      expect([scan(), scan(), scan(), scan(), scan(), scan(), scan(), scan(), scan()]).toEqual([
        1, 3, 3, 4, 6, 6, 7, 9, 9,
      ]);
      expect(line().promo?.freeQuantity).toBe(3);
      expect(usePosCartStore.getState().cart.total).toBe(720); // 6 pagadas
    });

    it('escáner: al pasar la pieza gratis el cajero ve que ya estaba contada', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 1);
      store.addItem(product('te', 120), 1);
      expect(notice()).toMatchObject({ kind: 'added' });
      const seq = notice()!.seq;
      store.addItem(product('te', 120), 1);
      expect(line().quantity).toBe(3);
      expect(line().autoGiftPending).toBeUndefined();
      expect(notice()).toMatchObject({ kind: 'claimed' });
      expect(notice()!.seq).toBeGreaterThan(seq);
      expect(notice()!.text).toContain('es la gratis que ya estaba en el carrito');
      expect(usePosCartStore.getState().cart.total).toBe(240);
    });

    it('clave con cantidad después de la gratis automática: lo ya contado no se duplica', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 2); // 3, con 1 gratis sin pasar
      store.addItem(product('te', 120), 2); // 1 era la gratis → 4
      expect(line().quantity).toBe(4);
      expect(line().autoGiftPending).toBeUndefined();
      store.addItem(product('te', 120), 1); // 5 → entra la sexta
      expect(line().quantity).toBe(6);
      expect(line().autoGiftPending).toBe(1);
    });

    it('los botones + y − son explícitos: + sobre 3 da 4 aunque la gratis no se haya pasado', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 2);
      expect(line().autoGiftPending).toBe(1);
      store.updateItemQuantity('te', 4);
      expect(line().quantity).toBe(4);
      expect(line().autoGiftPending).toBeUndefined();
      // Con + de 1 a 3 la gratis entra sola y, si luego la pasan, no se duplica.
      store.clearCart();
      store.addItem(product('te', 120), 1);
      store.updateItemQuantity('te', 2);
      expect(line().quantity).toBe(3);
      expect(line().autoGiftPending).toBe(1);
      store.addItem(product('te', 120), 1);
      expect(line().quantity).toBe(3);
    });

    it('con el botón +: 1 → 3 → 4 → 6; con −: 6 → 4 → 3 → 1 → se quita', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 1);
      const step = (delta: number) => {
        usePosCartStore.getState().updateItemQuantity('te', line().quantity + delta);
        return usePosCartStore.getState().cart.items[0]?.quantity ?? 0;
      };
      expect(step(+1)).toBe(3);
      expect(step(+1)).toBe(4);
      expect(step(+1)).toBe(6);
      expect(usePosCartStore.getState().cart.total).toBe(480); // 4 pagadas
      expect(step(-1)).toBe(4);
      expect(notice()).toMatchObject({ kind: 'removed' });
      expect(usePosCartStore.getState().cart.total).toBe(360); // 3 pagadas + 1 gratis
      expect(step(-1)).toBe(3);
      expect(step(-1)).toBe(1);
      expect(line().promo).toBeUndefined();
      expect(usePosCartStore.getState().cart.total).toBe(120);
      expect(step(-1)).toBe(0);
      expect(usePosCartStore.getState().cart.items).toHaveLength(0);
    });

    it('compra 5 y llévate 1: con 5 entra la sexta gratis', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(
        ctx([{ ...base('c5', 'nxm'), config: { buy: 6, pay: 5, sameProductOnly: true } }]),
      );
      store.addItem(product('te', 100), 4);
      expect(line().quantity).toBe(4);
      store.addItem(product('te', 100), 1);
      expect(line().quantity).toBe(6);
      expect(line().promo).toMatchObject({ typeLabel: '6x5', freeQuantity: 1 });
      expect(usePosCartStore.getState().cart.total).toBe(500);
    });

    it('sin existencia para la gratis: se queda en 2, sin promoción, y avisa', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem({ ...product('te', 120), stock: 2 } as QuickProduct, 2);
      expect(line().quantity).toBe(2);
      expect(line().promo).toBeUndefined();
      expect(usePosCartStore.getState().cart.total).toBe(240);
      expect(notice()).toMatchObject({ kind: 'missing' });
      expect(notice()!.text).toContain('no hay existencia para la pieza gratis');
    });

    it('con existencia justa (3) la tercera sí entra', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem({ ...product('te', 120), stock: 3 } as QuickProduct, 2);
      expect(line().quantity).toBe(3);
      expect(line().promo?.freeQuantity).toBe(1);
    });

    it('un producto que no está en la promoción, o sin promociones vigentes, no cambia', () => {
      const store = usePosCartStore.getState();
      const seqBefore = notice()?.seq ?? 0;
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('cafe', 300), 2);
      expect(line().quantity).toBe(2);
      store.clearCart();
      store.setSeasonalContext(null);
      store.addItem(product('te', 120), 2);
      expect(line().quantity).toBe(2);
      // Fuera de vigencia (la promoción es de otro día).
      store.clearCart();
      store.setSeasonalContext(
        ctx([{ ...base('bf-3x2', 'nxm'), startsAt: '2000-01-01T00:00:00', endsAt: '2000-01-01T23:59:59' }]),
      );
      store.addItem(product('te', 120), 2);
      expect(line().quantity).toBe(2);
      expect(notice()?.seq ?? 0).toBe(seqBefore);
    });

    it('precio especial, regalo por compra y canjeables no agregan piezas', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(
        ctx([{ ...base('precio', 'fixed_price'), config: { prices: { MX: 100 } } }]),
      );
      store.addItem(product('te', 120), 2);
      expect(line().quantity).toBe(2);
      expect(line().promo).toMatchObject({ typeLabel: 'Precio especial' });
      store.clearCart();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem({ ...product('te', 120), productType: 'promotional', maxQuantity: 5 } as QuickProduct, 2);
      expect(line().quantity).toBe(2);
    });

    it('dos productos de la misma promoción: cada uno trae su pieza gratis', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([{ ...base('bf-3x2', 'nxm'), eligibleProductIds: ['te', 'avena'] }]));
      store.addItem(product('te', 120), 2);
      store.addItem(product('avena', 80), 2);
      const items = usePosCartStore.getState().cart.items;
      expect(items.map((i) => [i.productId, i.quantity, i.promo?.freeQuantity])).toEqual([
        ['te', 3, 1],
        ['avena', 3, 1],
      ]);
      expect(usePosCartStore.getState().cart.total).toBe(400);
    });

    it('candado: si la promoción ya no regala más (tope por venta), no se agrega una pieza que se cobraría', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(
        ctx([{ ...base('bf-3x2', 'nxm'), eligibleProductIds: ['te', 'avena'], maxPerSale: 1 }]),
      );
      store.addItem(product('te', 120), 2);
      expect(line().quantity).toBe(3); // el único grupo de la venta
      store.addItem(product('avena', 80), 2);
      const avena = usePosCartStore.getState().cart.items[1];
      expect(avena.quantity).toBe(2);
      expect(avena.promo).toBeUndefined();
      expect(usePosCartStore.getState().cart.total).toBe(400); // 240 + 160
    });

    it('lo que viaja al API es la cantidad total del renglón (el servidor separa la gratis)', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
      store.addItem(product('te', 120), 2);
      const item = line();
      expect(item.quantity).toBe(3);
      expect(item.unitPrice).toBe(120);
      expect(item.discountAmount ?? 0).toBe(0);
    });
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
