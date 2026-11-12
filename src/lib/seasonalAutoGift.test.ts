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
  claimPendingGift,
  claimedGiftText,
  governingNxm,
  resolveAutoGift,
  type AutoGiftPromo,
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
