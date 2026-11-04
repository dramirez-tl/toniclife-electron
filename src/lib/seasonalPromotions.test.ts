import { describe, expect, it } from 'vitest';
import {
  applySeasonalPromotions,
  isPromotionActive,
  normalizeLocalStamp,
  normalizeSeasonalPromoConfig,
  seasonalPromoTypeLabel,
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
