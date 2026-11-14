import { describe, expect, it } from 'vitest';
import {
  applySeasonalPromotions,
  isPromotionActive,
  normalizeLocalStamp,
  normalizeSeasonalPromoConfig,
  nxmGroupOf,
  nxmGroups,
  seasonalPromoTypeLabel,
  type NxmConfig,
  type SeasonalEngineLine,
  type SeasonalPromotionDef,
} from './seasonalPromotions';

const BASE: Omit<SeasonalPromotionDef, 'id' | 'code' | 'type' | 'config'> = {
  name: 'Promo',
  seasonId: 'season-1',
  seasonCode: 'BUENFIN2026',
  seasonName: 'Buen Fin 2026',
  channels: ['pos', 'online'],
  countryCodes: ['MX', 'FN'],
  startsAt: '2026-11-13T00:00:00',
  endsAt: '2026-11-17T23:59:59',
  priority: 0,
  maxPerSale: null,
  pointsMode: 'keep',
  excludesKitBonus: false,
  eligibleProductIds: [],
  gifts: [],
};

function promo(
  p: Partial<SeasonalPromotionDef> &
    Pick<SeasonalPromotionDef, 'id' | 'type' | 'config'>,
): SeasonalPromotionDef {
  return { ...BASE, code: p.id.toUpperCase(), ...p };
}

function line(
  productId: string,
  quantity: number,
  unitPrice: number,
  extra: Partial<SeasonalEngineLine> = {},
): SeasonalEngineLine {
  return {
    key: productId,
    productId,
    quantity,
    unitPrice,
    unitPoints: 10,
    unitBusinessValue: 100,
    ...extra,
  };
}

const CTX = {
  channel: 'pos' as const,
  countryCode: 'MX',
  nowLocal: '2026-11-14T10:30:00',
};

describe('normalizeLocalStamp / isPromotionActive', () => {
  it('normaliza fecha sola, sin segundos y recorta', () => {
    expect(normalizeLocalStamp('2026-11-13')).toBe('2026-11-13T00:00:00');
    expect(normalizeLocalStamp('2026-11-13T09:05')).toBe('2026-11-13T09:05:00');
    expect(normalizeLocalStamp('2026-11-13 09:05:07.123')).toBe(
      '2026-11-13T09:05:07',
    );
    expect(normalizeLocalStamp(undefined)).toBe('');
  });

  it('vigente solo dentro de la ventana, canal y país', () => {
    const p = promo({ id: 'p1', type: 'percent_off', config: { percent: 10 } });
    expect(isPromotionActive(p, CTX)).toBe(true);
    expect(
      isPromotionActive(p, { ...CTX, nowLocal: '2026-11-12T23:59:59' }),
    ).toBe(false);
    expect(
      isPromotionActive(p, { ...CTX, nowLocal: '2026-11-17T23:59:59' }),
    ).toBe(true);
    expect(
      isPromotionActive(p, { ...CTX, nowLocal: '2026-11-18T00:00:00' }),
    ).toBe(false);
    expect(isPromotionActive(p, { ...CTX, countryCode: 'US' })).toBe(false);
    expect(isPromotionActive({ ...p, channels: ['online'] }, CTX)).toBe(false);
    expect(isPromotionActive(p, { ...CTX, countryCode: 'FN' })).toBe(true);
  });
});

describe('nxm (3x2) en productos idénticos', () => {
  const p3x2 = promo({
    id: 'bf-3x2',
    type: 'nxm',
    config: { buy: 3, pay: 2, sameProductOnly: true },
    eligibleProductIds: ['te-legline', 'te-pp'],
  });

  it('3 piezas → 1 gratis, 4 → 1, 6 → 2, 2 → ninguna; puntos solo de las cobradas', () => {
    const r = applySeasonalPromotions(
      [line('te-legline', 3, 120), line('te-pp', 4, 100), line('otro', 6, 50)],
      [p3x2],
      CTX,
    );
    const [a, b, c] = r.lines;
    expect([
      a.paidQuantity,
      a.freeQuantity,
      a.discountAmount,
      a.points,
    ]).toEqual([2, 1, 120, 20]);
    expect([
      b.paidQuantity,
      b.freeQuantity,
      b.discountAmount,
      b.points,
    ]).toEqual([3, 1, 100, 30]);
    expect([
      c.paidQuantity,
      c.freeQuantity,
      c.discountAmount,
      c.points,
      c.promotionId,
    ]).toEqual([6, 0, 0, 60, null]);
    expect(a.promoCode).toBe('BF-3X2');
    expect(r.totalDiscount).toBe(220);
    expect(r.applied).toEqual([
      expect.objectContaining({
        promotionId: 'bf-3x2',
        times: 2,
        freeUnits: 2,
        discountAmount: 220,
      }),
    ]);
    expect(r.gifts).toEqual([]);
  });

  it('no mezcla productos cuando sameProductOnly: 2 + 1 piezas no forman grupo', () => {
    const r = applySeasonalPromotions(
      [line('te-legline', 2, 120), line('te-pp', 1, 100)],
      [p3x2],
      CTX,
    );
    expect(r.totalDiscount).toBe(0);
    expect(r.applied).toEqual([]);
  });

  it('maxPerSale acota los grupos', () => {
    const r = applySeasonalPromotions(
      [line('te-legline', 9, 120)],
      [{ ...p3x2, maxPerSale: 1 }],
      CTX,
    );
    expect(r.lines[0].freeQuantity).toBe(1);
    expect(r.applied[0].times).toBe(1);
  });

  it('mezcla permitida: las piezas gratis son las más baratas del conjunto', () => {
    const mix = { ...p3x2, config: { buy: 3, pay: 2, sameProductOnly: false } };
    const r = applySeasonalPromotions(
      [line('te-legline', 2, 120), line('te-pp', 1, 100)],
      [mix],
      CTX,
    );
    const cheap = r.lines.find((l) => l.productId === 'te-pp')!;
    const dear = r.lines.find((l) => l.productId === 'te-legline')!;
    expect([cheap.freeQuantity, cheap.discountAmount]).toEqual([1, 100]);
    expect([dear.freeQuantity, dear.discountAmount, dear.promotionId]).toEqual([
      0,
      0,
      'bf-3x2',
    ]);
    expect(r.totalDiscount).toBe(100);
  });
});

describe('nxm con grupos: sabores del mismo producto cuentan juntos', () => {
  // "Compra 5 y llévate 1" del 14-nov-2026: 24 Shake en 3 sabores (mismo
  // precio), Gubi Shake en 2 y el 12 Mix solo.
  const p6x5 = promo({
    id: 'bf-6x5',
    type: 'nxm',
    config: {
      buy: 6,
      pay: 5,
      sameProductOnly: true,
      groups: [
        { name: '24 Shake', productIds: ['sh-van', 'sh-choc', 'sh-fresa'] },
        { name: 'Gubi Shake', productIds: ['gubi-a', 'gubi-b'] },
      ],
    },
    eligibleProductIds: [
      'sh-van',
      'sh-choc',
      'sh-fresa',
      'gubi-a',
      'gubi-b',
      'mix-12',
    ],
  });
  const free = (r: ReturnType<typeof applySeasonalPromotions>) =>
    Object.fromEntries(r.lines.map((l) => [l.productId, l.freeQuantity]));

  it('3 + 2 + 1 de tres sabores completan el grupo: 1 gratis y los tres renglones quedan en la promoción', () => {
    const r = applySeasonalPromotions(
      [
        line('sh-van', 3, 363),
        line('sh-choc', 2, 363),
        line('sh-fresa', 1, 363),
      ],
      [p6x5],
      CTX,
    );
    expect(r.totalDiscount).toBe(363);
    expect(r.lines.reduce((s, l) => s + l.freeQuantity, 0)).toBe(1);
    expect(r.lines.every((l) => l.promotionId === 'bf-6x5')).toBe(true);
    // A igual precio, la gratis es del producto con el id menor (determinista).
    expect(free(r)).toEqual({ 'sh-van': 0, 'sh-choc': 1, 'sh-fresa': 0 });
    expect(r.applied).toEqual([
      expect.objectContaining({ times: 1, freeUnits: 1, discountAmount: 363 }),
    ]);
    // Puntos solo de las piezas cobradas (10 por pieza): 5 cobradas.
    expect(r.lines.reduce((s, l) => s + l.points, 0)).toBe(50);
  });

  it('con 5 piezas del grupo todavía no hay gratis y los renglones quedan libres', () => {
    const r = applySeasonalPromotions(
      [line('sh-van', 3, 363), line('sh-choc', 2, 363)],
      [p6x5],
      CTX,
    );
    expect(r.applied).toEqual([]);
    expect(r.lines.every((l) => l.promotionId === null)).toBe(true);
  });

  it('dos grupos no se mezclan entre sí, y lo que está fuera de grupo cuenta solo', () => {
    const none = applySeasonalPromotions(
      [line('sh-van', 3, 363), line('gubi-a', 3, 513), line('mix-12', 5, 471)],
      [p6x5],
      CTX,
    );
    expect(none.applied).toEqual([]);
    // 5 de un grupo + 1 suelto del mismo precio: el suelto NO completa el grupo.
    const loose = applySeasonalPromotions(
      [line('sh-van', 5, 363), line('mix-12', 1, 363)],
      [p6x5],
      CTX,
    );
    expect(loose.applied).toEqual([]);
    const each = applySeasonalPromotions(
      [
        line('sh-van', 4, 363),
        line('gubi-a', 2, 513),
        line('sh-fresa', 2, 363),
        line('gubi-b', 4, 513),
        line('mix-12', 6, 471),
      ],
      [p6x5],
      CTX,
    );
    expect(each.applied[0]).toEqual(
      expect.objectContaining({ times: 3, freeUnits: 3 }),
    );
    expect(each.totalDiscount).toBe(363 + 513 + 471);
    expect(free(each)['mix-12']).toBe(1);
  });

  it('la gratis es la MÁS BARATA del grupo, y un renglón puede salir gratis completo', () => {
    const r = applySeasonalPromotions(
      [line('sh-van', 5, 363), line('sh-fresa', 1, 300)],
      [p6x5],
      CTX,
    );
    const cheap = r.lines.find((l) => l.productId === 'sh-fresa')!;
    expect([
      cheap.paidQuantity,
      cheap.freeQuantity,
      cheap.discountAmount,
      cheap.points,
    ]).toEqual([0, 1, 300, 0]);
    const dear = r.lines.find((l) => l.productId === 'sh-van')!;
    expect([dear.paidQuantity, dear.freeQuantity, dear.promotionId]).toEqual([
      5,
      0,
      'bf-6x5',
    ]);
    expect(r.totalDiscount).toBe(300);
  });

  it('12 piezas del grupo dan 2 gratis; maxPerSale las acota entre todos los conjuntos', () => {
    const cart = [
      line('sh-van', 7, 363),
      line('sh-choc', 5, 363),
      line('mix-12', 6, 471),
    ];
    const open = applySeasonalPromotions(cart, [p6x5], CTX);
    expect(open.applied[0]).toEqual(
      expect.objectContaining({ times: 3, freeUnits: 3 }),
    );
    const capped = applySeasonalPromotions(
      cart,
      [{ ...p6x5, maxPerSale: 2 }],
      CTX,
    );
    expect(capped.applied[0]).toEqual(
      expect.objectContaining({ times: 2, freeUnits: 2 }),
    );
    // El tope se gasta en orden del carrito: el 12 Mix ya no alcanza.
    expect(free(capped)['mix-12']).toBe(0);
    expect(
      capped.lines.find((l) => l.productId === 'mix-12')!.promotionId,
    ).toBe(null);
  });

  it('dos renglones del mismo producto dentro de un grupo también cuentan juntos', () => {
    const r = applySeasonalPromotions(
      [
        line('sh-van', 3, 363, { key: 'a' }),
        line('sh-van', 3, 363, { key: 'b' }),
      ],
      [p6x5],
      CTX,
    );
    expect(r.lines.reduce((s, l) => s + l.freeQuantity, 0)).toBe(1);
  });

  it('un grupo incompleto no consume: sus renglones quedan para la siguiente promoción', () => {
    const pct = promo({
      id: 'p10',
      type: 'percent_off',
      config: { percent: 10 },
      eligibleProductIds: ['sh-van', 'sh-choc'],
      priority: 5,
    });
    const r = applySeasonalPromotions(
      [line('sh-van', 2, 100), line('sh-choc', 2, 100)],
      [p6x5, pct],
      CTX,
    );
    expect(r.applied.map((a) => a.promotionId)).toEqual(['p10']);
    expect(r.totalDiscount).toBe(40);
  });

  it('sin grupos el resultado es el de siempre; con "combinar todo" los grupos no cuentan', () => {
    const cart = [line('sh-van', 3, 363), line('sh-choc', 3, 363)];
    const plain = {
      ...p6x5,
      config: { buy: 6, pay: 5, sameProductOnly: true },
    };
    expect(applySeasonalPromotions(cart, [plain], CTX).applied).toEqual([]);
    const all = {
      ...p6x5,
      config: { ...(p6x5.config as NxmConfig), sameProductOnly: false },
    };
    expect(nxmGroups(all.config)).toEqual([]);
    // Combinar todo: 3 del 24 Shake + 3 del 12 Mix sí completan.
    expect(
      applySeasonalPromotions(
        [line('sh-van', 3, 363), line('mix-12', 3, 471)],
        [all],
        CTX,
      ).applied[0],
    ).toEqual(expect.objectContaining({ times: 1, discountAmount: 363 }));
  });

  it('nxmGroups / nxmGroupOf toleran config sucia: 2+ productos y cada uno en su primer grupo', () => {
    const dirty = {
      buy: 3,
      pay: 2,
      sameProductOnly: true,
      groups: [
        { name: ' A ', productIds: ['x', 'y', 'x', '', 7] },
        { name: 'B', productIds: ['y', 'z'] },
        { name: 'C', productIds: ['z', 'w'] },
        null,
        { name: 'D' },
      ],
    } as unknown as NxmConfig;
    expect(nxmGroups(dirty)).toEqual([
      { name: 'A', productIds: ['x', 'y'] },
      { name: 'C', productIds: ['z', 'w'] },
    ]);
    expect(nxmGroupOf('y', dirty)?.name).toBe('A');
    expect(nxmGroupOf('w', dirty)?.name).toBe('C');
    expect(nxmGroupOf('q', dirty)).toBeNull();
    expect(nxmGroups(null)).toEqual([]);
    expect(nxmGroups({ percent: 10 })).toEqual([]);
  });
});

describe('percent_off y fixed_price', () => {
  it('porcentaje sobre el renglón, a centavos', () => {
    const p = promo({
      id: 'p20',
      type: 'percent_off',
      config: { percent: 20 },
      eligibleProductIds: ['a'],
    });
    const r = applySeasonalPromotions([line('a', 3, 119.99)], [p], CTX);
    expect(r.lines[0].discountAmount).toBe(71.99);
    expect(r.lines[0].freeQuantity).toBe(0);
    expect(r.lines[0].points).toBe(30);
    expect(r.applied[0].times).toBe(3);
  });

  it('precio especial del país; sin precio para el país o precio mayor no aplica', () => {
    const kit = promo({
      id: 'kit-2000',
      type: 'fixed_price',
      config: { prices: { MX: 2000, FN: 2000 } },
      eligibleProductIds: ['kit-premium'],
      excludesKitBonus: true,
    });
    const r = applySeasonalPromotions(
      [line('kit-premium', 1, 2789)],
      [kit],
      CTX,
    );
    expect(r.lines[0].discountAmount).toBe(789);
    expect(r.lines[0].kitBonusExcluded).toBe(true);
    const us = applySeasonalPromotions(
      [line('kit-premium', 1, 150)],
      [{ ...kit, countryCodes: ['US'] }],
      {
        ...CTX,
        countryCode: 'US',
      },
    );
    expect(us.applied).toEqual([]);
    const higher = applySeasonalPromotions(
      [line('kit-premium', 1, 1500)],
      [kit],
      CTX,
    );
    expect(higher.applied).toEqual([]);
  });

  it('pointsMode none deja en 0 los puntos de las piezas con descuento', () => {
    const p = promo({
      id: 'p10',
      type: 'percent_off',
      config: { percent: 10 },
      eligibleProductIds: ['a'],
      pointsMode: 'none',
    });
    const r = applySeasonalPromotions([line('a', 2, 100)], [p], CTX);
    expect([r.lines[0].points, r.lines[0].businessValue]).toEqual([0, 0]);
  });
});

describe('gift_with_purchase', () => {
  const gift = promo({
    id: 'regalo',
    type: 'gift_with_purchase',
    config: { minQuantity: 2, minAmount: null, repeat: true },
    eligibleProductIds: ['a', 'b'],
    gifts: [{ productId: 'shaker', quantity: 1 }],
  });

  it('da el regalo por cada múltiplo cuando repeat, con tope por venta', () => {
    const r = applySeasonalPromotions(
      [line('a', 3, 100), line('b', 2, 80)],
      [gift],
      CTX,
    );
    expect(r.gifts).toEqual([
      expect.objectContaining({
        productId: 'shaker',
        quantity: 2,
        promotionId: 'regalo',
      }),
    ]);
    const capped = applySeasonalPromotions(
      [line('a', 10, 100)],
      [{ ...gift, maxPerSale: 1 }],
      CTX,
    );
    expect(capped.gifts[0].quantity).toBe(1);
    const once = applySeasonalPromotions(
      [line('a', 10, 100)],
      [{ ...gift, config: { minQuantity: 2, minAmount: null, repeat: false } }],
      CTX,
    );
    expect(once.gifts[0].quantity).toBe(1);
  });

  it('por monto mínimo y sin alcanzar el umbral', () => {
    const byAmount = {
      ...gift,
      config: { minQuantity: null, minAmount: 500, repeat: false },
    };
    expect(
      applySeasonalPromotions([line('a', 5, 100)], [byAmount], CTX).gifts,
    ).toHaveLength(1);
    expect(
      applySeasonalPromotions([line('a', 4, 100)], [byAmount], CTX).gifts,
    ).toHaveLength(0);
  });

  it('no consume renglones: convive con un 3x2 sobre los mismos productos', () => {
    const p3x2 = promo({
      id: '3x2',
      type: 'nxm',
      config: { buy: 3, pay: 2, sameProductOnly: true },
      eligibleProductIds: ['a'],
    });
    const r = applySeasonalPromotions([line('a', 3, 100)], [p3x2, gift], CTX);
    expect(r.lines[0].freeQuantity).toBe(1);
    expect(r.gifts).toHaveLength(1);
  });
});

describe('prioridad y exclusiones', () => {
  it('un renglón entra a UNA promoción: gana la de menor prioridad', () => {
    const a = promo({
      id: 'a-20',
      type: 'percent_off',
      config: { percent: 20 },
      eligibleProductIds: ['x'],
      priority: 10,
    });
    const b = promo({
      id: 'b-3x2',
      type: 'nxm',
      config: { buy: 3, pay: 2, sameProductOnly: true },
      eligibleProductIds: ['x'],
      priority: 1,
    });
    const r = applySeasonalPromotions([line('x', 3, 100)], [a, b], CTX);
    expect(r.lines[0].promotionId).toBe('b-3x2');
    expect(r.applied.map((p) => p.promotionId)).toEqual(['b-3x2']);
  });

  it('renglones excluidos, en $0 o con cantidad 0 no participan', () => {
    const p = promo({
      id: 'p',
      type: 'percent_off',
      config: { percent: 50 },
      eligibleProductIds: ['x', 'y', 'z'],
    });
    const r = applySeasonalPromotions(
      [
        line('x', 1, 100, { excluded: true }),
        line('y', 1, 0),
        line('z', 0, 100),
      ],
      [p],
      CTX,
    );
    expect(r.totalDiscount).toBe(0);
    expect(r.applied).toEqual([]);
  });

  it('sin promociones vigentes regresa los renglones intactos', () => {
    const r = applySeasonalPromotions([line('x', 2, 100)], [], CTX);
    expect(r.lines[0]).toEqual(
      expect.objectContaining({
        paidQuantity: 2,
        freeQuantity: 0,
        discountAmount: 0,
        points: 20,
        promotionId: null,
      }),
    );
  });
});

describe('normalizeSeasonalPromoConfig / etiquetas', () => {
  it('valida cada tipo', () => {
    expect(normalizeSeasonalPromoConfig('nxm', { buy: '3', pay: '2' })).toEqual(
      { buy: 3, pay: 2, sameProductOnly: true },
    );
    expect(() =>
      normalizeSeasonalPromoConfig('nxm', { buy: 2, pay: 2 }),
    ).toThrow();
    expect(
      normalizeSeasonalPromoConfig('percent_off', { percent: '15.5' }),
    ).toEqual({ percent: 15.5 });
    expect(() =>
      normalizeSeasonalPromoConfig('percent_off', { percent: 0 }),
    ).toThrow();
    expect(
      normalizeSeasonalPromoConfig('fixed_price', {
        prices: { mx: '2000', FN: 2000, US: '' },
      }),
    ).toEqual({
      prices: { MX: 2000, FN: 2000 },
    });
    expect(() =>
      normalizeSeasonalPromoConfig('fixed_price', { prices: {} }),
    ).toThrow();
    expect(
      normalizeSeasonalPromoConfig('gift_with_purchase', {
        minQuantity: 2,
        repeat: 'no',
      }),
    ).toEqual({
      minQuantity: 2,
      minAmount: null,
      repeat: false,
    });
    expect(() =>
      normalizeSeasonalPromoConfig('gift_with_purchase', {}),
    ).toThrow();
  });

  it('nxm: los grupos se guardan limpios y solo con piezas idénticas', () => {
    expect(
      normalizeSeasonalPromoConfig('nxm', {
        buy: 6,
        pay: 5,
        sameProductOnly: true,
        groups: [
          { name: '  24   Shake ', productIds: ['a', 'b', 'a', ' c '] },
          { name: 'Uno solo', productIds: ['z'] },
          { name: 'Gubi', productIds: ['d', 'e'] },
        ],
      }),
    ).toEqual({
      buy: 6,
      pay: 5,
      sameProductOnly: true,
      groups: [
        { name: '24 Shake', productIds: ['a', 'b', 'c'] },
        { name: 'Gubi', productIds: ['d', 'e'] },
      ],
    });
    // Sin grupos útiles la config queda igual que antes (sin la llave).
    expect(
      normalizeSeasonalPromoConfig('nxm', { buy: 3, pay: 2, groups: [] }),
    ).toEqual({ buy: 3, pay: 2, sameProductOnly: true });
    expect(
      normalizeSeasonalPromoConfig('nxm', {
        buy: 3,
        pay: 2,
        groups: [{ name: 'Uno', productIds: ['a'] }],
      }),
    ).toEqual({ buy: 3, pay: 2, sameProductOnly: true });
    // "Combinar todo" no lleva grupos aunque lleguen.
    expect(
      normalizeSeasonalPromoConfig('nxm', {
        buy: 3,
        pay: 2,
        sameProductOnly: false,
        groups: [{ name: 'G', productIds: ['a', 'b'] }],
      }),
    ).toEqual({ buy: 3, pay: 2, sameProductOnly: false });
  });

  it('nxm: rechaza un producto en dos grupos, grupos sin nombre o con el nombre repetido', () => {
    const base = { buy: 3, pay: 2, sameProductOnly: true };
    expect(() =>
      normalizeSeasonalPromoConfig('nxm', {
        ...base,
        groups: [
          { name: 'A', productIds: ['x', 'y'] },
          { name: 'B', productIds: ['y', 'z'] },
        ],
      }),
    ).toThrow(/dos grupos/);
    expect(() =>
      normalizeSeasonalPromoConfig('nxm', {
        ...base,
        groups: [{ name: '  ', productIds: ['x', 'y'] }],
      }),
    ).toThrow(/nombre/);
    expect(() =>
      normalizeSeasonalPromoConfig('nxm', {
        ...base,
        groups: [
          { name: 'Shake', productIds: ['x', 'y'] },
          { name: 'shake', productIds: ['z', 'w'] },
        ],
      }),
    ).toThrow(/nombre/);
    expect(() =>
      normalizeSeasonalPromoConfig('nxm', { ...base, groups: 'x' }),
    ).toThrow(/lista/);
  });

  it('etiquetas', () => {
    expect(
      seasonalPromoTypeLabel('nxm', { buy: 3, pay: 2, sameProductOnly: true }),
    ).toBe('3x2');
    expect(seasonalPromoTypeLabel('percent_off', { percent: 20 })).toBe(
      '20% de descuento',
    );
    expect(seasonalPromoTypeLabel('fixed_price')).toBe('Precio especial');
    expect(seasonalPromoTypeLabel('gift_with_purchase')).toBe(
      'Regalo por compra',
    );
  });
});
