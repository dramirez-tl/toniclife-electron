// Panel "Promociones de temporada": qué productos se combinan entre sí.

import { describe, expect, it } from 'vitest';
import { promoGiftEntersAlone, splitPromoProducts } from './seasonalGroups';

const p = (productId: string) => ({ productId, name: productId.toUpperCase() });
const ids = (list: { productId: string }[]) => list.map((x) => x.productId);

const CONFIG = {
  buy: 6,
  pay: 5,
  sameProductOnly: true,
  groups: [
    { name: '24 Shake', productIds: ['van', 'choc', 'fresa'] },
    { name: 'Gubi Shake', productIds: ['gubi-a', 'gubi-b'] },
  ],
};
const PRODUCTS = [p('van'), p('gubi-a'), p('choc'), p('mix'), p('gubi-b'), p('fresa')];

describe('splitPromoProducts', () => {
  it('separa los grupos que se combinan de los productos sueltos, en el orden de la lista', () => {
    const { groups, loose } = splitPromoProducts('nxm', CONFIG, PRODUCTS);
    expect(groups.map((g) => [g.name, ids(g.products)])).toEqual([
      ['24 Shake', ['van', 'choc', 'fresa']],
      ['Gubi Shake', ['gubi-a', 'gubi-b']],
    ]);
    expect(ids(loose)).toEqual(['mix']);
  });

  it('un grupo con un solo producto en la lista no combina nada: ese producto va suelto', () => {
    const { groups, loose } = splitPromoProducts('nxm', CONFIG, [p('van'), p('gubi-a'), p('gubi-b')]);
    expect(groups.map((g) => g.name)).toEqual(['Gubi Shake']);
    expect(ids(loose)).toEqual(['van']);
  });

  it('sin grupos, con "combinar todo" o en otro tipo de promoción, todo va suelto', () => {
    const plain = { buy: 3, pay: 2, sameProductOnly: true };
    expect(splitPromoProducts('nxm', plain, PRODUCTS).groups).toEqual([]);
    expect(ids(splitPromoProducts('nxm', plain, PRODUCTS).loose)).toEqual(ids(PRODUCTS));
    expect(splitPromoProducts('nxm', { ...CONFIG, sameProductOnly: false }, PRODUCTS).groups).toEqual([]);
    expect(splitPromoProducts('percent_off', { percent: 10 }, PRODUCTS).groups).toEqual([]);
    expect(splitPromoProducts('nxm', null, PRODUCTS).loose).toHaveLength(PRODUCTS.length);
  });
});

describe('promoGiftEntersAlone', () => {
  it('solo en "lleva N, paga M" de piezas idénticas, con o sin grupos', () => {
    expect(promoGiftEntersAlone('nxm', { buy: 3, pay: 2, sameProductOnly: true })).toBe(true);
    expect(promoGiftEntersAlone('nxm', CONFIG)).toBe(true);
    expect(promoGiftEntersAlone('nxm', { buy: 3, pay: 2, sameProductOnly: false })).toBe(false);
    expect(promoGiftEntersAlone('percent_off', { percent: 10 })).toBe(false);
    expect(promoGiftEntersAlone('gift_with_purchase', { minQuantity: 2, minAmount: null, repeat: false })).toBe(false);
  });
});
