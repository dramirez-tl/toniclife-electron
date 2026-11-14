// La pieza gratis de un "lleva N, paga M" entra sola al carrito (12-nov-2026).

import { describe, expect, it } from 'vitest';
import {
  applySeasonalPromotions,
  type SeasonalEngineContext,
  type SeasonalPromotionDef,
} from './seasonalPromotions';
import {
  autoGiftMessage,
  autoGiftTarget,
  claimGroupPending,
  claimPendingGift,
  claimedGiftText,
  governingNxm,
  groupGiftMessage,
  movedGiftText,
  planGroupGift,
  resolveAutoGift,
  type AutoGiftPromo,
  type GroupGiftLine,
  type GroupGiftPlan,
} from './seasonalAutoGift';

const X3X2 = { buy: 3, pay: 2 };
const X6X5 = { buy: 6, pay: 5 };
const X2X1 = { buy: 2, pay: 1 };
const X4X2 = { buy: 4, pay: 2 };

const NOW = '2026-11-14T10:00:00';
const CTX: SeasonalEngineContext = { channel: 'pos', countryCode: 'MX', nowLocal: NOW };

function def(code: string, over: Partial<SeasonalPromotionDef> = {}): SeasonalPromotionDef {
  return {
    id: `id-${code}`,
    code,
    name: `Promo ${code}`,
    type: 'nxm',
    config: { buy: 3, pay: 2, sameProductOnly: true },
    seasonId: 's',
    seasonCode: 'BUENFIN2026',
    seasonName: 'Buen Fin 2026',
    channels: ['pos', 'online'],
    countryCodes: ['MX', 'FN'],
    startsAt: '2026-11-14T00:00:00',
    endsAt: '2026-11-14T23:59:00',
    priority: 100,
    maxPerSale: null,
    pointsMode: 'keep',
    excludesKitBonus: false,
    eligibleProductIds: ['oximagic'],
    gifts: [],
    ...over,
  };
}

describe('autoGiftTarget (a qué cantidad queda el renglón)', () => {
  it('3x2 al subir: con 2 entra la tercera; con 5, la sexta', () => {
    const up = (q: number) => autoGiftTarget(q, q - 1, X3X2);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(up)).toEqual([1, 3, 3, 4, 6, 6, 7, 9, 9]);
  });

  it('3x2 al bajar: la gratis se va con la pieza que la ganaba (de 3 a 1, de 6 a 4)', () => {
    expect(autoGiftTarget(2, 3, X3X2)).toBe(1);
    expect(autoGiftTarget(5, 6, X3X2)).toBe(4);
    expect(autoGiftTarget(8, 9, X3X2)).toBe(7);
    // Bajar a una cantidad que no deja "pagadas sin regalo" no cambia nada.
    expect(autoGiftTarget(3, 4, X3X2)).toBe(3);
    expect(autoGiftTarget(1, 3, X3X2)).toBe(1);
    expect(autoGiftTarget(0, 1, X3X2)).toBe(0);
  });

  it('compra 5 y llévate 1 (6x5): con 5 entra la sexta; de 6 baja a 4', () => {
    const up = (q: number) => autoGiftTarget(q, q - 1, X6X5);
    expect([1, 4, 5, 6, 7, 10, 11, 12].map(up)).toEqual([1, 4, 6, 6, 7, 10, 12, 12]);
    expect(autoGiftTarget(5, 6, X6X5)).toBe(4);
    expect(autoGiftTarget(11, 12, X6X5)).toBe(10);
  });

  it('2x1: la primera ya trae la segunda; al bajar de 2 se quita el renglón', () => {
    expect(autoGiftTarget(1, 0, X2X1)).toBe(2);
    expect(autoGiftTarget(3, 2, X2X1)).toBe(4);
    expect(autoGiftTarget(1, 2, X2X1)).toBe(0);
  });

  it('lleva 4, paga 2: con 2 o con 3 se completa a 4 (paga 2 de todos modos)', () => {
    expect(autoGiftTarget(2, 1, X4X2)).toBe(4);
    expect(autoGiftTarget(3, 0, X4X2)).toBe(4);
    expect(autoGiftTarget(1, 0, X4X2)).toBe(1);
    expect(autoGiftTarget(3, 4, X4X2)).toBe(1);
  });

  it('una cantidad tecleada igual a la que había cuenta como subir', () => {
    expect(autoGiftTarget(2, 2, X3X2)).toBe(3);
  });
});

describe('claimPendingGift (la pieza que se pasa después era la gratis)', () => {
  it('sin gratis pendientes, lo agregado suma tal cual', () => {
    expect(claimPendingGift(1, 0)).toEqual({ add: 1, pending: 0, claimed: 0 });
    expect(claimPendingGift(5, 0)).toEqual({ add: 5, pending: 0, claimed: 0 });
  });

  it('las primeras piezas agregadas son las gratis que ya estaban', () => {
    expect(claimPendingGift(1, 1)).toEqual({ add: 0, pending: 0, claimed: 1 });
    expect(claimPendingGift(3, 1)).toEqual({ add: 2, pending: 0, claimed: 1 });
    expect(claimPendingGift(1, 2)).toEqual({ add: 0, pending: 1, claimed: 1 });
  });

  it('valores raros no rompen nada', () => {
    expect(claimPendingGift(-1, 1)).toEqual({ add: 0, pending: 1, claimed: 0 });
    expect(claimPendingGift(Number.NaN, Number.NaN)).toEqual({ add: 0, pending: 0, claimed: 0 });
    expect(claimPendingGift(2.9, 1.9)).toEqual({ add: 1, pending: 0, claimed: 1 });
  });

  it('el aviso nombra el producto', () => {
    expect(claimedGiftText('Oximagic 250 ml.')).toBe(
      'Esa pieza de Oximagic 250 ml. es la gratis que ya estaba en el carrito: la cantidad no cambia',
    );
  });
});

describe('governingNxm (qué promoción manda sobre el producto)', () => {
  it('la promoción de piezas idénticas vigente para el producto', () => {
    expect(governingNxm('oximagic', [def('SABADO')], CTX)).toEqual({
      id: 'id-SABADO',
      code: 'SABADO',
      name: 'Promo SABADO',
      buy: 3,
      pay: 2,
      label: '3x2',
    });
    expect(
      governingNxm('gubi', [def('C5', { config: { buy: 6, pay: 5, sameProductOnly: true }, eligibleProductIds: ['gubi'] })], CTX)?.label,
    ).toBe('6x5');
  });

  it('nada si el producto no participa, o la promoción no corre ahora, aquí o en caja', () => {
    expect(governingNxm('otro', [def('SABADO')], CTX)).toBeNull();
    expect(governingNxm('oximagic', [def('SABADO')], { ...CTX, nowLocal: '2026-11-13T23:59:59' })).toBeNull();
    expect(governingNxm('oximagic', [def('SABADO')], { ...CTX, countryCode: 'US' })).toBeNull();
    expect(governingNxm('oximagic', [def('SOLO-LINEA', { channels: ['online'] })], CTX)).toBeNull();
    expect(governingNxm('oximagic', [], CTX)).toBeNull();
  });

  it('manda la primera que el motor le aplicaría (prioridad y luego código)', () => {
    const defs = [
      def('B-3X2'),
      def('A-6X5', { config: { buy: 6, pay: 5, sameProductOnly: true } }),
      def('Z-2X1', { priority: 1, config: { buy: 2, pay: 1, sameProductOnly: true } }),
    ];
    expect(governingNxm('oximagic', defs, CTX)?.code).toBe('Z-2X1');
    expect(governingNxm('oximagic', defs.slice(0, 2), CTX)?.code).toBe('A-6X5');
  });

  it('si antes le toca un precio especial o un porcentaje, no hay pieza gratis que agregar', () => {
    const fixed = def('PRECIO', { type: 'fixed_price', config: { prices: { MX: 100 } }, priority: 1 });
    expect(governingNxm('oximagic', [def('SABADO'), fixed], CTX)).toBeNull();
    const percent = def('PORC', { type: 'percent_off', config: { percent: 20 }, priority: 1 });
    expect(governingNxm('oximagic', [def('SABADO'), percent], CTX)).toBeNull();
  });

  it('el regalo por compra no estorba; un "mezcla y lleva" no se adivina; una promoción mal armada tampoco', () => {
    const gift = def('REGALO', {
      type: 'gift_with_purchase',
      config: { minQuantity: 1, minAmount: null, repeat: false },
      priority: 1,
      gifts: [{ productId: 'shaker', quantity: 1 }],
    });
    expect(governingNxm('oximagic', [def('SABADO'), gift], CTX)?.code).toBe('SABADO');
    expect(governingNxm('oximagic', [def('MEZCLA', { config: { buy: 3, pay: 2, sameProductOnly: false } })], CTX)).toBeNull();
    expect(governingNxm('oximagic', [def('MAL', { config: { buy: 2, pay: 2, sameProductOnly: true } })], CTX)).toBeNull();
  });
});

describe('resolveAutoGift (cantidad final con existencia y candado del motor)', () => {
  const PROMO: AutoGiftPromo = { id: 'p', code: 'SABADO', name: '3x2 Buen Fin sábado 14', buy: 3, pay: 2, label: '3x2' };
  /** Piezas gratis que da el motor real a un renglón del producto con esa cantidad. */
  const engineFree = (defs: SeasonalPromotionDef[]) => (quantity: number) =>
    applySeasonalPromotions(
      [{ key: 'l', productId: 'oximagic', quantity, unitPrice: 563, unitPoints: 242, unitBusinessValue: 242 }],
      defs,
      CTX,
    ).lines[0].freeQuantity;
  const free3x2 = engineFree([def('SABADO')]);

  it('con 2 entra la tercera y el cliente paga las mismas 2', () => {
    const out = resolveAutoGift({ wanted: 2, previous: 1, promo: PROMO, max: 50, freeAt: free3x2 });
    expect(out).toMatchObject({ quantity: 3, added: 1, removed: 0, missing: 0 });
    expect(3 - free3x2(3)).toBe(2);
  });

  it('con 1, con 3 o con 4 no cambia nada', () => {
    for (const [wanted, previous] of [[1, 0], [3, 2], [4, 3]]) {
      expect(resolveAutoGift({ wanted, previous, promo: PROMO, max: 50, freeAt: free3x2 })).toMatchObject({
        quantity: wanted,
        added: 0,
        removed: 0,
        missing: 0,
      });
    }
  });

  it('sin existencia para la gratis se queda en lo pedido y lo dice', () => {
    expect(resolveAutoGift({ wanted: 2, previous: 1, promo: PROMO, max: 2, freeAt: free3x2 })).toMatchObject({
      quantity: 2,
      added: 0,
      missing: 1,
    });
    // Con 5 piezas en existencia: el primer grupo sí, el segundo regalo no cabe.
    expect(resolveAutoGift({ wanted: 5, previous: 4, promo: PROMO, max: 5, freeAt: free3x2 })).toMatchObject({
      quantity: 5,
      missing: 1,
    });
    // Sin tope (kit que se arma, sin control de existencia) sí entra.
    expect(resolveAutoGift({ wanted: 2, previous: 1, promo: PROMO, max: null, freeAt: free3x2 }).quantity).toBe(3);
  });

  it('al bajar de 3 queda en 1 y avisa que se fue la gratis', () => {
    expect(resolveAutoGift({ wanted: 2, previous: 3, promo: PROMO, max: 50, freeAt: free3x2 })).toMatchObject({
      quantity: 1,
      removed: 1,
      added: 0,
    });
  });

  it('candado: si el motor NO regala la pieza (tope de usos agotado), no se agrega nada', () => {
    // Tope de 1 grupo por venta: la sexta pieza ya no saldría gratis.
    const capped = engineFree([def('SABADO', { maxPerSale: 1 })]);
    expect(capped(3)).toBe(1);
    expect(capped(6)).toBe(1);
    expect(resolveAutoGift({ wanted: 5, previous: 4, promo: PROMO, max: 50, freeAt: capped })).toMatchObject({
      quantity: 5,
      added: 0,
      missing: 0,
    });
    // El primer grupo sí.
    expect(resolveAutoGift({ wanted: 2, previous: 1, promo: PROMO, max: 50, freeAt: capped }).quantity).toBe(3);
  });

  it('sin promoción no toca la cantidad', () => {
    expect(resolveAutoGift({ wanted: 2, previous: 1, promo: null, max: 50, freeAt: () => 0 })).toEqual({
      quantity: 2,
      added: 0,
      removed: 0,
      missing: 0,
      promo: null,
    });
  });

  it('avisos al cajero', () => {
    const name = 'Oximagic 250 ml.';
    const out = (over: Partial<ReturnType<typeof resolveAutoGift>>) => ({
      quantity: 3,
      added: 0,
      removed: 0,
      missing: 0,
      promo: PROMO,
      ...over,
    });
    expect(autoGiftMessage(out({ added: 1 }), name)).toEqual({
      kind: 'added',
      text: '3x2: se agregó 1 pieza gratis de Oximagic 250 ml.',
    });
    expect(autoGiftMessage(out({ added: 2 }), name)?.text).toBe('3x2: se agregó 2 piezas gratis de Oximagic 250 ml.');
    expect(autoGiftMessage(out({ missing: 1 }), name)).toEqual({
      kind: 'missing',
      text: '3x2: no hay existencia para la pieza gratis de Oximagic 250 ml.; se cobra sin promoción',
    });
    expect(autoGiftMessage(out({ removed: 1 }), name)?.kind).toBe('removed');
    expect(autoGiftMessage(out({}), name)).toBeNull();
    expect(autoGiftMessage(out({ added: 1, promo: null }), name)).toBeNull();
  });
});

describe('grupos de productos que se combinan (14-nov-2026)', () => {
  const GROUP_DEF = def('C5', {
    config: {
      buy: 6,
      pay: 5,
      sameProductOnly: true,
      groups: [{ name: '24 Shake', productIds: ['van', 'choc', 'fresa', 'descontinuado'] }],
    },
    eligibleProductIds: ['van', 'choc', 'fresa', 'mix'],
  });
  const PROMO: AutoGiftPromo = {
    id: 'id-C5',
    code: 'C5',
    name: 'Promo C5',
    buy: 6,
    pay: 5,
    label: '6x5',
    group: { name: '24 Shake', productIds: ['van', 'choc', 'fresa'] },
  };

  const gl = (productId: string, quantity: number, over: Partial<GroupGiftLine> = {}): GroupGiftLine => ({
    productId,
    name: `24 Shake ${productId}`,
    quantity,
    unitPrice: 363,
    max: 50,
    pending: 0,
    ...over,
  });

  /** Lo que paga el cliente por esas piezas según el MOTOR real. */
  const payableOf =
    (lines: readonly GroupGiftLine[], defs: SeasonalPromotionDef[] = [GROUP_DEF]) =>
    (quantities: ReadonlyMap<string, number>) => {
      const cart = lines
        .map((l) => ({
          key: l.productId,
          productId: l.productId,
          quantity: quantities.get(l.productId) ?? l.quantity,
          unitPrice: l.unitPrice,
          unitPoints: 10,
          unitBusinessValue: 100,
        }))
        .filter((l) => l.quantity > 0);
      const r = applySeasonalPromotions(cart, defs, CTX);
      return cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0) - r.totalDiscount;
    };
  const plan = (
    lines: GroupGiftLine[],
    touched: string | null,
    previousTotal: number,
    defs: SeasonalPromotionDef[] = [GROUP_DEF],
  ) => planGroupGift({ lines, touched, previousTotal, promo: PROMO, payable: payableOf(lines, defs) });
  const shape = (p: GroupGiftPlan) => ({
    quantities: Object.fromEntries(p.quantities),
    pending: Object.fromEntries(p.pending),
    added: p.added?.productId ?? null,
    removed: p.removed.map((r) => [r.productId, r.pieces]),
    missing: p.missing,
  });
  const NOTHING = { quantities: {}, pending: {}, added: null, removed: [], missing: 0 };

  it('governingNxm trae el grupo del producto, solo con los productos que la promoción vende hoy', () => {
    expect(governingNxm('choc', [GROUP_DEF], CTX)).toEqual(PROMO);
    // Fuera de grupo, el producto cuenta solo: sin la llave `group`.
    expect(governingNxm('mix', [GROUP_DEF], CTX)).toEqual({
      id: 'id-C5',
      code: 'C5',
      name: 'Promo C5',
      buy: 6,
      pay: 5,
      label: '6x5',
    });
    // Un grupo que hoy solo tiene un producto vendible no combina nada.
    const solo = def('SOLO', {
      config: { buy: 6, pay: 5, sameProductOnly: true, groups: [{ name: 'G', productIds: ['van', 'baja'] }] },
      eligibleProductIds: ['van'],
    });
    expect(governingNxm('van', [solo], CTX)?.group).toBeUndefined();
  });

  it('sube: con el grupo en 5 entra la sexta en el último sabor capturado', () => {
    const lines = [gl('van', 3), gl('choc', 2)];
    expect(shape(plan(lines, 'choc', 4))).toEqual({
      quantities: { choc: 3 },
      pending: { choc: 1 },
      added: 'choc',
      removed: [],
      missing: 0,
    });
    // 11 piezas → la doceava.
    expect(shape(plan([gl('van', 6), gl('fresa', 5)], 'fresa', 10)).quantities).toEqual({ fresa: 6 });
  });

  it('con 4, con 6 o con 7 no hay nada que hacer', () => {
    for (const [a, b] of [
      [2, 2],
      [3, 3],
      [4, 3],
    ]) {
      expect(shape(plan([gl('van', a), gl('choc', b)], 'choc', a + b - 1))).toEqual(NOTHING);
    }
    expect(plan([], 'van', 0).quantities.size).toBe(0);
  });

  it('precios distintos: si en el último sabor le costaría más al cliente, entra del más barato', () => {
    const lines = [gl('van', 4, { unitPrice: 300 }), gl('choc', 1, { unitPrice: 400 })];
    expect(shape(plan(lines, 'choc', 4))).toMatchObject({ quantities: { van: 5 }, added: 'van' });
    const pay = payableOf(lines);
    // Con la pieza que entró sola el cliente paga lo mismo que sin ella.
    expect(pay(new Map([['van', 5]]))).toBe(pay(new Map()));
    expect(pay(new Map([['choc', 2]]))).toBeGreaterThan(pay(new Map()));
  });

  it('sin existencia en el último sabor entra de otro; sin existencia en ninguno, avisa', () => {
    expect(shape(plan([gl('van', 3), gl('choc', 2, { max: 2 })], 'choc', 4))).toMatchObject({
      quantities: { van: 4 },
      added: 'van',
      missing: 0,
    });
    expect(shape(plan([gl('van', 3, { max: 3 }), gl('choc', 2, { max: 2 })], 'choc', 4))).toEqual({
      ...NOTHING,
      missing: 1,
    });
  });

  it('candado: si la promoción ya no regala más (tope por venta), no entra nada y no se avisa', () => {
    const capped = [{ ...GROUP_DEF, maxPerSale: 1 }];
    expect(shape(plan([gl('van', 6), gl('choc', 5)], 'choc', 10, capped))).toEqual(NOTHING);
  });

  it('baja: primero se va la gratis que entró sola y nadie pasó, esté en el sabor que esté', () => {
    const lines = [gl('van', 2), gl('choc', 3, { pending: 1 })];
    expect(shape(plan(lines, 'van', 6))).toEqual({
      quantities: { choc: 2 },
      pending: { choc: 0 },
      added: null,
      removed: [['choc', 1]],
      missing: 0,
    });
  });

  it('baja sin gratis pendientes: una más del renglón que se movió', () => {
    expect(shape(plan([gl('van', 3), gl('choc', 2)], 'choc', 6))).toEqual({
      quantities: { choc: 1 },
      pending: { choc: 0 },
      added: null,
      removed: [['choc', 1]],
      missing: 0,
    });
    // El renglón movido se queda sin piezas: se quita.
    expect(shape(plan([gl('van', 4), gl('choc', 1)], 'choc', 6)).quantities).toEqual({ choc: 0 });
  });

  it('se quitó el renglón completo y el grupo queda en 5: la gratis entra en otro (el más barato; a igual precio, el último del carrito)', () => {
    expect(shape(plan([gl('van', 4), gl('fresa', 1)], null, 7))).toMatchObject({
      quantities: { fresa: 2 },
      pending: { fresa: 1 },
      added: 'fresa',
    });
    expect(shape(plan([gl('van', 5)], null, 6))).toMatchObject({ quantities: { van: 6 }, added: 'van' });
  });

  it('claimGroupPending: la pieza que se pasa toma el lugar de la gratis que entró sola en otro sabor', () => {
    const others = [gl('van', 3), gl('choc', 3, { pending: 1 })];
    expect(claimGroupPending(1, others)).toEqual([{ productId: 'choc', name: '24 Shake choc', pieces: 1 }]);
    expect(claimGroupPending(3, others)).toEqual([{ productId: 'choc', name: '24 Shake choc', pieces: 1 }]);
    expect(claimGroupPending(1, [gl('van', 3)])).toEqual([]);
    expect(claimGroupPending(0, others)).toEqual([]);
    expect(claimGroupPending(Number.NaN, others)).toEqual([]);
    // Dos sabores con gratis sin pasar: se toman en orden.
    expect(
      claimGroupPending(2, [gl('van', 6, { pending: 1 }), gl('choc', 6, { pending: 1 })]).map((m) => m.productId),
    ).toEqual(['van', 'choc']);
  });

  it('avisos al cajero', () => {
    expect(groupGiftMessage(plan([gl('van', 3), gl('choc', 2)], 'choc', 4), PROMO)).toEqual({
      kind: 'added',
      text: '6x5: se agregó 1 pieza gratis de 24 Shake choc',
    });
    expect(groupGiftMessage(plan([gl('van', 3), gl('choc', 2)], 'choc', 6), PROMO)).toEqual({
      kind: 'removed',
      text: '6x5: también se quitó la pieza gratis de 24 Shake choc',
    });
    expect(
      groupGiftMessage(plan([gl('van', 3, { max: 3 }), gl('choc', 2, { max: 2 })], 'choc', 4), PROMO),
    ).toEqual({
      kind: 'missing',
      text: '6x5: no hay existencia para la pieza gratis de 24 Shake. Agrega otra pieza del grupo y sale gratis',
    });
    expect(groupGiftMessage(plan([gl('van', 2), gl('choc', 2)], 'choc', 3), PROMO)).toBeNull();
    expect(movedGiftText(PROMO, '24 Shake Fresa', ['24 Shake Chocolate'])).toBe(
      '6x5: 24 Shake Fresa entra en lugar de la pieza gratis de 24 Shake Chocolate que se había agregado sola',
    );
  });
});

describe('grupos: al bajar, la gratis que entró sola y ya no se gana se va siempre', () => {
  const PROMO = { buy: 6, pay: 5 };
  const gl = (productId: string, quantity: number, pending = 0): GroupGiftLine => ({
    productId,
    name: `24 Shake ${productId}`,
    quantity,
    unitPrice: 363,
    max: 50,
    pending,
  });
  // Mismo precio en todo el grupo: paga las piezas menos las gratis del 6x5.
  const payable = (lines: readonly GroupGiftLine[]) => (q: ReadonlyMap<string, number>) => {
    const total = lines.reduce((s, l) => s + (q.get(l.productId) ?? l.quantity), 0);
    return (total - Math.floor(total / 6)) * 363;
  };
  const run = (lines: GroupGiftLine[], touched: string | null, previousTotal: number) => {
    const p = planGroupGift({ lines, touched, previousTotal, promo: PROMO, payable: payable(lines) });
    return {
      quantities: Object.fromEntries(p.quantities),
      pending: Object.fromEntries(p.pending),
      added: p.added?.productId ?? null,
      removed: p.removed.map((r) => [r.productId, r.pieces]),
    };
  };

  it('se quitó el renglón de otro sabor y el grupo ya no llega a 6: la que entró sola se va (si no, se cobraría)', () => {
    expect(run([gl('choc', 3, 1)], null, 6)).toEqual({
      quantities: { choc: 2 },
      pending: { choc: 0 },
      added: null,
      removed: [['choc', 1]],
    });
  });

  it('se tecleó una cantidad menor en otro sabor: igual', () => {
    expect(run([gl('van', 1), gl('choc', 3, 1)], 'van', 6)).toEqual({
      quantities: { choc: 2 },
      pending: { choc: 0 },
      added: null,
      removed: [['choc', 1]],
    });
  });

  it('con 12 piezas y una sin pasar: al bajar una se va la que entró sola y el grupo queda en 10', () => {
    expect(run([gl('van', 5), gl('choc', 6, 1)], 'van', 12)).toEqual({
      quantities: { choc: 5 },
      pending: { choc: 0 },
      added: null,
      removed: [['choc', 1]],
    });
  });

  it('si el grupo sigue ganando sus gratis, las que entraron solas se quedan', () => {
    // 13 → 12: siguen siendo 2 gratis; nada cambia.
    expect(run([gl('van', 6), gl('choc', 6, 1)], 'van', 13)).toEqual({
      quantities: {},
      pending: {},
      added: null,
      removed: [],
    });
  });

  it('al SUBIR nunca se quita nada', () => {
    expect(run([gl('van', 4), gl('choc', 3, 1)], 'van', 6)).toEqual({
      quantities: {},
      pending: {},
      added: null,
      removed: [],
    });
  });
});
