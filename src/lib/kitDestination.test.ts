// Panel "¿Para quién es el kit?" (13-nov-2026): precio y puntos que se le
// enseñan al cajero antes de decidir, con el mismo motor del carrito.

import { describe, expect, it } from 'vitest';
import type { SeasonalPromotionDef } from './seasonalPromotions';
import {
  kitPositionLabel,
  kitPriceToday,
  type KitSeasonalContext,
} from './kitDestination';

const KIT = {
  id: 'kpm14',
  basePrice: 2789,
  points: 3300,
  businessVolume: 0,
  productType: 'kit',
  isEnrollmentKit: true,
};

function def(over: Partial<SeasonalPromotionDef> = {}): SeasonalPromotionDef {
  return {
    id: 'promo-kit',
    code: 'BUENFIN2026-KITTONICCENTERPR',
    name: 'Kit Tonic Center Premium a $2,000',
    type: 'fixed_price',
    config: { prices: { MX: 2000, FN: 2000 } },
    seasonId: 's',
    seasonCode: 'BUENFIN2026',
    seasonName: 'Buen Fin 2026',
    channels: ['pos'],
    countryCodes: ['MX', 'FN'],
    startsAt: '2026-11-13T06:00:00',
    endsAt: '2026-11-13T23:59:00',
    priority: 0,
    maxPerSale: null,
    pointsMode: 'keep',
    excludesKitBonus: true,
    eligibleProductIds: ['kpm14'],
    gifts: [],
    ...over,
  };
}

const ctx = (
  defs: SeasonalPromotionDef[],
  countryCode = 'MX',
): KitSeasonalContext => ({ defs, countryCode });

const NOON = '2026-11-13T12:00:00';

describe('kitPriceToday (lo que se cobrará por un kit si se agrega ahora)', () => {
  it('sin promociones: precio de lista y sus puntos', () => {
    expect(kitPriceToday(KIT, ctx([]), NOON)).toEqual({
      listPrice: 2789,
      price: 2789,
      points: 3300,
      promo: null,
    });
  });

  it('Buen Fin, viernes 13: el kit a $2,000, con sus 3,300 puntos y sin bono', () => {
    expect(kitPriceToday(KIT, ctx([def()]), NOON)).toEqual({
      listPrice: 2789,
      price: 2000,
      points: 3300,
      promo: {
        name: 'Kit Tonic Center Premium a $2,000',
        seasonName: 'Buen Fin 2026',
        discount: 789,
        excludesKitBonus: true,
      },
    });
  });

  it('respeta la ventana en hora local: antes de las 06:00 y después de las 23:59 va a lista', () => {
    const c = ctx([def()]);
    expect(kitPriceToday(KIT, c, '2026-11-13T05:59:59').promo).toBeNull();
    expect(kitPriceToday(KIT, c, '2026-11-13T06:00:00').price).toBe(2000);
    expect(kitPriceToday(KIT, c, '2026-11-13T23:58:00').price).toBe(2000);
    expect(kitPriceToday(KIT, c, '2026-11-14T00:05:00')).toMatchObject({
      price: 2789,
      promo: null,
    });
  });

  it('Frontera cobra su propio precio especial; otro país va a lista', () => {
    const d = def({ config: { prices: { MX: 2000, FN: 2100 } } });
    expect(kitPriceToday(KIT, ctx([d], 'FN'), NOON).price).toBe(2100);
    expect(kitPriceToday(KIT, ctx([d], 'US'), NOON).promo).toBeNull();
  });

  it('una promoción solo de la tienda en línea no cambia el precio de caja', () => {
    const d = def({ channels: ['online'] });
    expect(kitPriceToday(KIT, ctx([d]), NOON).promo).toBeNull();
  });

  it('otro producto en promoción no afecta a este kit', () => {
    const d = def({ eligibleProductIds: ['otro'] });
    expect(kitPriceToday(KIT, ctx([d]), NOON).promo).toBeNull();
  });

  it('un precio especial igual o mayor al de lista no se aplica', () => {
    const d = def({ config: { prices: { MX: 2789 } } });
    expect(kitPriceToday(KIT, ctx([d]), NOON)).toMatchObject({
      price: 2789,
      promo: null,
    });
  });

  it('porcentaje de descuento: baja el precio y dice cuánto', () => {
    const d = def({ type: 'percent_off', config: { percent: 10 } });
    expect(kitPriceToday(KIT, ctx([d]), NOON)).toMatchObject({
      price: 2510.1,
      promo: { discount: 278.9 },
    });
  });

  it('promoción sin puntos: el kit con descuento da 0 puntos', () => {
    const d = def({ pointsMode: 'none' });
    expect(kitPriceToday(KIT, ctx([d]), NOON)).toMatchObject({
      price: 2000,
      points: 0,
    });
  });

  it('un 3x2 no cambia el precio de una sola pieza', () => {
    const d = def({
      type: 'nxm',
      config: { buy: 3, pay: 2, sameProductOnly: true },
    });
    expect(kitPriceToday(KIT, ctx([d]), NOON)).toMatchObject({
      price: 2789,
      promo: null,
    });
  });

  it('"sin bono" solo se anuncia en un kit de inscripción', () => {
    const pack = { ...KIT, isEnrollmentKit: false };
    expect(
      kitPriceToday(pack, ctx([def()]), NOON).promo?.excludesKitBonus,
    ).toBe(false);
    const withBonus = def({ excludesKitBonus: false });
    expect(
      kitPriceToday(KIT, ctx([withBonus]), NOON).promo?.excludesKitBonus,
    ).toBe(false);
  });

  it('canjeables, boletos y precio $0 nunca entran a una promoción', () => {
    const c = ctx([def()]);
    expect(
      kitPriceToday({ ...KIT, productType: 'promotional' }, c, NOON).promo,
    ).toBeNull();
    expect(
      kitPriceToday(
        { ...KIT, event: { id: 'e', name: 'Evento' } as never },
        c,
        NOON,
      ).promo,
    ).toBeNull();
    expect(kitPriceToday({ ...KIT, basePrice: 0 }, c, NOON)).toEqual({
      listPrice: 0,
      price: 0,
      points: 3300,
      promo: null,
    });
  });

  it('sin nombre de temporada en la definición no inventa uno', () => {
    const d = def({ seasonName: '  ' });
    expect(kitPriceToday(KIT, ctx([d]), NOON).promo?.seasonName).toBeNull();
  });
});

describe('kitPositionLabel', () => {
  it('traduce las posiciones conocidas y deja pasar las demás', () => {
    expect(kitPositionLabel('premium')).toBe('Premium');
    expect(kitPositionLabel('BASIC')).toBe('Básico');
    expect(kitPositionLabel('preferred')).toBe('Preferente');
    expect(kitPositionLabel('oro')).toBe('oro');
    expect(kitPositionLabel('')).toBeNull();
    expect(kitPositionLabel(undefined)).toBeNull();
  });
});
