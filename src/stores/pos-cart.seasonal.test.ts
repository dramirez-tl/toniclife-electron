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

  describe('sabores que se combinan: el grupo cuenta junto (14-nov-2026)', () => {
    // "Compra 5 y llévate 1": 24 Shake en 3 sabores (mismo precio) que se
    // combinan; el 12 Mix va en la misma promoción pero cuenta solo.
    const shakes = (over: Partial<SeasonalPromotionDef> = {}): SeasonalPromotionDef => ({
      ...base('c5', 'nxm'),
      config: {
        buy: 6,
        pay: 5,
        sameProductOnly: true,
        groups: [{ name: '24 Shake', productIds: ['van', 'choc', 'fresa'] }],
      },
      eligibleProductIds: ['van', 'choc', 'fresa', 'mix'],
      ...over,
    });
    const P = 363;
    const van = (extra: Partial<QuickProduct> = {}) => ({ ...product('van', P), ...extra }) as QuickProduct;
    const choc = (extra: Partial<QuickProduct> = {}) => ({ ...product('choc', P), ...extra }) as QuickProduct;
    const fresa = () => product('fresa', P);
    const cart = () => usePosCartStore.getState().cart;
    /** [producto, piezas, gratis según el motor, gratis "sin pasar"] por renglón. */
    const lines = () =>
      cart().items.map((i) => [i.productId, i.quantity, i.promo?.freeQuantity ?? 0, i.autoGiftPending ?? 0]);
    const qty = () => Object.fromEntries(cart().items.map((i) => [i.productId, i.quantity]));
    const notice = () => usePosCartStore.getState().autoGift;
    const start = (def = shakes()) => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([def]));
      return store;
    };

    it('3 de vainilla + 2 de chocolate: al llegar a 5 del grupo entra sola la sexta, del último sabor capturado', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 1);
      expect(qty()).toEqual({ van: 3, choc: 1 });
      expect(cart().seasonalDiscount ?? 0).toBe(0);
      store.addItem(choc(), 1);
      expect(qty()).toEqual({ van: 3, choc: 3 });
      expect(cart().items[1].autoGiftPending).toBe(1);
      // Se cobran 5 y la sexta va gratis; los dos renglones quedan en la promoción.
      expect(cart().total).toBe(5 * P);
      expect(cart().seasonalDiscount).toBe(P);
      expect(cart().items.every((i) => i.promo?.typeLabel === '6x5')).toBe(true);
      expect(cart().items.reduce((s, i) => s + (i.promo?.freeQuantity ?? 0), 0)).toBe(1);
      expect(cart().totalPoints).toBe(50);
      expect(notice()).toMatchObject({
        kind: 'added',
        text: '6x5: se agregó 1 pieza gratis de Producto choc',
      });
    });

    it('con el grupo en 4 no entra nada; capturar las 6 de golpe tampoco deja gratis "sin pasar"', () => {
      const store = start();
      store.addItem(van(), 2);
      store.addItem(choc(), 2);
      expect(qty()).toEqual({ van: 2, choc: 2 });
      expect(cart().total).toBe(4 * P);
      store.clearCart();
      store.addItem(van(), 3);
      store.addItem(choc(), 3);
      expect(qty()).toEqual({ van: 3, choc: 3 });
      expect(cart().items.every((i) => !i.autoGiftPending)).toBe(true);
      expect(cart().total).toBe(5 * P);
    });

    it('escáner: el cliente trae la sexta del MISMO sabor → al pasarla no deja 7', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 2); // entra sola la tercera de chocolate
      const seq = notice()!.seq;
      store.addItem(choc(), 1);
      expect(qty()).toEqual({ van: 3, choc: 3 });
      expect(cart().items[1].autoGiftPending).toBeUndefined();
      expect(notice()).toMatchObject({ kind: 'claimed' });
      expect(notice()!.seq).toBeGreaterThan(seq);
      expect(notice()!.text).toContain('es la gratis que ya estaba en el carrito');
      expect(cart().total).toBe(5 * P);
      // La siguiente pasada ya sí suma.
      store.addItem(choc(), 1);
      expect(qty()).toEqual({ van: 3, choc: 4 });
    });

    it('escáner: el cliente trae la sexta de OTRO sabor → toma el lugar de la que había entrado sola', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 2); // chocolate queda en 3 (1 entró sola)
      store.addItem(fresa(), 1);
      expect(lines().map((l) => [l[0], l[1], l[3]])).toEqual([
        ['van', 3, 0],
        ['choc', 2, 0],
        ['fresa', 1, 0],
      ]);
      expect(cart().total).toBe(5 * P);
      expect(notice()).toMatchObject({
        kind: 'claimed',
        text: '6x5: Producto fresa entra en lugar de la pieza gratis de Producto choc que se había agregado sola',
      });
    });

    it('un solo sabor del grupo se comporta como siempre: con 5 entra la sexta', () => {
      const store = start();
      store.addItem(van(), 5);
      expect(lines()).toEqual([['van', 6, 1, 1]]);
      expect(cart().total).toBe(5 * P);
    });

    it('botón −: la gratis que entró sola se va primero, esté en el sabor que esté', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 2); // van 3, choc 3 (1 sin pasar)
      store.updateItemQuantity('van', 2);
      // El cliente tiene 2 de vainilla y 2 de chocolate: la gratis ya no se gana.
      expect(lines()).toEqual([
        ['van', 2, 0, 0],
        ['choc', 2, 0, 0],
      ]);
      expect(cart().total).toBe(4 * P);
      expect(notice()).toMatchObject({
        kind: 'removed',
        text: '6x5: también se quitó la pieza gratis de Producto choc',
      });
    });

    it('botón − sin gratis "sin pasar" en el grupo: baja una más del renglón que se movió', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 3); // las 6 pasadas
      store.updateItemQuantity('choc', 2);
      expect(qty()).toEqual({ van: 3, choc: 1 });
      expect(cart().total).toBe(4 * P);
      expect(notice()).toMatchObject({ kind: 'removed' });
      // Y con + vuelve a completar el grupo.
      store.updateItemQuantity('choc', 2);
      expect(qty()).toEqual({ van: 3, choc: 3 });
      expect(cart().total).toBe(5 * P);
    });

    it('al QUITAR un renglón, si el grupo queda en 5, la gratis entra en otro sabor (no se pierde)', () => {
      const store = start();
      store.addItem(van(), 5); // 6: entra sola la sexta de vainilla
      store.updateItemQuantity('van', 5); // explícito: 6 → 4 (se va con su gratis)
      expect(qty()).toEqual({ van: 4 });
      store.addItem(choc(), 2); // 4 + 2 = 6 pasadas
      expect(qty()).toEqual({ van: 4, choc: 2 });
      store.updateItemQuantity('van', 5); // 7: nada que hacer
      store.removeItem('choc'); // quedan 5 de vainilla
      expect(lines()).toEqual([['van', 6, 1, 1]]);
      expect(cart().total).toBe(5 * P);
      expect(notice()).toMatchObject({
        kind: 'added',
        text: '6x5: se agregó 1 pieza gratis de Producto van',
      });
      // Bajar a 0 con el botón hace lo mismo que el bote de basura.
      store.clearCart();
      store.addItem(van(), 4);
      store.addItem(choc(), 2);
      store.addItem(fresa(), 1); // 7
      store.updateItemQuantity('choc', 0); // quedan 5
      expect(qty()).toEqual({ van: 4, fresa: 2 });
      expect(cart().total).toBe(5 * P);
    });

    it('quitar un renglón que no deja al grupo "pagando sin regalo" no agrega nada', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 3);
      const seq = notice()?.seq ?? 0;
      store.removeItem('choc');
      expect(qty()).toEqual({ van: 3 });
      expect(cart().total).toBe(3 * P);
      expect(notice()?.seq ?? 0).toBe(seq);
    });

    it('precios distintos en el grupo: la gratis es la más barata, así que entra del más barato y el cliente paga lo mismo', () => {
      const store = start();
      store.addItem(product('van', 300), 4);
      expect(cart().total).toBe(1200);
      store.addItem(product('choc', 400), 1);
      // Agregar otra de chocolate ($400) le costaría $100 más: entra una de vainilla.
      expect(qty()).toEqual({ van: 5, choc: 1 });
      expect(cart().total).toBe(1600);
      expect(notice()).toMatchObject({
        kind: 'added',
        text: '6x5: se agregó 1 pieza gratis de Producto van',
      });
    });

    it('sin existencia del último sabor, la gratis entra de otro sabor del grupo; si ninguno tiene, avisa', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc({ stock: 2 }), 2);
      expect(qty()).toEqual({ van: 4, choc: 2 });
      expect(cart().total).toBe(5 * P);
      store.clearCart();
      store.addItem(van({ stock: 3 }), 3);
      store.addItem(choc({ stock: 2 }), 2);
      expect(qty()).toEqual({ van: 3, choc: 2 });
      expect(cart().total).toBe(5 * P);
      expect(notice()).toMatchObject({ kind: 'missing' });
      expect(notice()!.text).toContain('no hay existencia para la pieza gratis de 24 Shake');
    });

    it('lo que está fuera del grupo cuenta solo: 5 del grupo + 1 del 12 Mix no completan; 5 del 12 Mix sí traen su sexta', () => {
      const store = start();
      store.addItem(van(), 2);
      store.addItem(product('mix', P), 1);
      store.addItem(choc(), 2);
      expect(qty()).toEqual({ van: 2, mix: 1, choc: 2 });
      expect(cart().total).toBe(5 * P);
      expect(cart().seasonalDiscount ?? 0).toBe(0);
      store.clearCart();
      store.addItem(product('mix', 471), 5);
      expect(lines()).toEqual([['mix', 6, 1, 1]]);
    });

    it('12 piezas del grupo: dos gratis; el tope por venta se respeta (no entra una pieza que se cobraría)', () => {
      const store = start();
      store.addItem(van(), 6);
      store.addItem(choc(), 5);
      expect(qty()).toEqual({ van: 6, choc: 6 });
      expect(cart().total).toBe(10 * P);
      store.clearCart();
      start(shakes({ maxPerSale: 1 }));
      usePosCartStore.getState().addItem(van(), 6);
      const seq = notice()?.seq ?? 0;
      usePosCartStore.getState().addItem(choc(), 5);
      expect(qty()).toEqual({ van: 6, choc: 5 });
      expect(cart().total).toBe(10 * P);
      // No es falta de existencia: la promoción ya dio su único grupo. Sin aviso.
      expect(notice()?.seq ?? 0).toBe(seq);
    });

    it('lo que viaja al API son las cantidades por producto; el servidor decide cuál sale gratis', () => {
      const store = start();
      store.addItem(van(), 3);
      store.addItem(choc(), 2);
      expect(cart().items.map((i) => [i.productId, i.quantity, i.unitPrice, i.discountAmount ?? 0])).toEqual([
        ['van', 3, P, 0],
        ['choc', 3, P, 0],
      ]);
    });

    it('una promoción sin grupos sigue igual: 3 + 2 de dos productos no completan', () => {
      const store = start({
        ...shakes(),
        config: { buy: 6, pay: 5, sameProductOnly: true },
      });
      store.addItem(van(), 3);
      store.addItem(choc(), 2);
      expect(qty()).toEqual({ van: 3, choc: 2 });
      expect(cart().total).toBe(5 * P);
      expect(cart().seasonalDiscount ?? 0).toBe(0);
    });
  });

  describe('sabores que se combinan: la gratis que entró sola nunca se queda para cobrarse', () => {
    const P = 363;
    const shakes: SeasonalPromotionDef = {
      ...base('c5', 'nxm'),
      config: {
        buy: 6,
        pay: 5,
        sameProductOnly: true,
        groups: [{ name: '24 Shake', productIds: ['van', 'choc', 'fresa'] }],
      },
      eligibleProductIds: ['van', 'choc', 'fresa'],
    };
    const cart = () => usePosCartStore.getState().cart;
    const lines = () => cart().items.map((i) => [i.productId, i.quantity, i.autoGiftPending ?? 0]);
    const notice = () => usePosCartStore.getState().autoGift;
    /** 3 de vainilla + 2 de chocolate pasadas: el chocolate queda en 3 (1 entró sola). */
    const fiveScanned = () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([shakes]));
      store.addItem(product('van', P), 3);
      store.addItem(product('choc', P), 2);
      expect(lines()).toEqual([
        ['van', 3, 0],
        ['choc', 3, 1],
      ]);
      return store;
    };

    it('al QUITAR el renglón de vainilla, la de chocolate que entró sola se va: quedan las 2 que trae el cliente', () => {
      const store = fiveScanned();
      store.removeItem('van');
      expect(lines()).toEqual([['choc', 2, 0]]);
      expect(cart().total).toBe(2 * P);
      expect(cart().seasonalDiscount ?? 0).toBe(0);
      expect(notice()).toMatchObject({
        kind: 'removed',
        text: '6x5: también se quitó la pieza gratis de Producto choc',
      });
    });

    it('al teclear 1 en vainilla (de 3), igual: el grupo ya no gana la gratis', () => {
      const store = fiveScanned();
      store.updateItemQuantity('van', 1);
      expect(lines()).toEqual([
        ['van', 1, 0],
        ['choc', 2, 0],
      ]);
      expect(cart().total).toBe(3 * P);
    });

    it('con 12 piezas (2 gratis) y una sin pasar: al bajar una, se va esa y quedan 10 con 1 gratis', () => {
      const store = usePosCartStore.getState();
      store.setSeasonalContext(ctx([shakes]));
      store.addItem(product('van', P), 6);
      store.addItem(product('choc', P), 5); // 11 → entra la doceava de chocolate
      expect(lines()).toEqual([
        ['van', 6, 0],
        ['choc', 6, 1],
      ]);
      store.updateItemQuantity('van', 5);
      expect(lines()).toEqual([
        ['van', 5, 0],
        ['choc', 5, 0],
      ]);
      expect(cart().total).toBe(9 * P);
    });

    it('si el cliente ya pasó la sexta, quitar el otro sabor deja las 3 pasadas (no hay nada que se haya agregado solo)', () => {
      const store = fiveScanned();
      store.addItem(product('choc', P), 1); // pasa la sexta: ya no hay gratis sin pasar
      store.removeItem('van');
      expect(lines()).toEqual([['choc', 3, 0]]);
      expect(cart().total).toBe(3 * P);
    });
  });

  it('el aviso "esa pieza es la gratis que ya estaba" solo sale si la cantidad no cambió', () => {
    const store = usePosCartStore.getState();
    store.setSeasonalContext(ctx([base('bf-3x2', 'nxm')]));
    store.addItem(product('te', 120), 2); // 3, con 1 gratis sin pasar
    const seq = usePosCartStore.getState().autoGift!.seq;
    store.addItem(product('te', 120), 2); // 1 era la gratis, la otra sí suma → 4
    expect(usePosCartStore.getState().cart.items[0].quantity).toBe(4);
    // Sin aviso nuevo: decir "la cantidad no cambia" sería falso.
    expect(usePosCartStore.getState().autoGift!.seq).toBe(seq);
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
