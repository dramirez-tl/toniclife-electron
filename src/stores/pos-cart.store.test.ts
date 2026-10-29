// pos-cart.store.test.ts - Totales del carrito: el descuento global (cupón o
// manual) va SOBRE EL TOTAL CON IMPUESTO y se prorratea por renglón (regla
// 29-oct-2026). El store usa lib/saleDiscount.ts, ESPEJO 1:1 de
// pos/lib/sale-discount.lib.ts del API: aquí se portan los casos del spec del
// API (sale-discount.lib.spec.ts) y se comprueba que el carrito dé, al
// centavo, lo mismo que createSale; el API valida el pago contra SU total.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PosCartItem, QuickProduct } from '@/types/pos';
import {
  applyGlobalDiscount,
  fixedDiscount,
  lineGrossCents,
  lineGrossWithTax,
  percentDiscount,
  roundHalfUp2,
  saleGrossTotal,
  type SaleDiscountLine,
} from '@/lib/saleDiscount';
import {
  calculateCartTotals,
  calculateItemTotal,
  cartGrossTotal,
  prorateDiscount,
  toDiscountLine,
  usePosCartStore,
} from './pos-cart.store';

/** Alias local: centavos, mitad hacia arriba (misma función que el API). */
const round2 = roundHalfUp2;

/** Lo que responde POST /pos/coupons/validate para un cupón porcentual:
 *  round2(base × % / 100), con base = total CON impuesto del carrito. */
const apiPercent = (base: number, pct: number): number =>
  round2((base * pct) / 100);

const product = (
  p: Partial<QuickProduct> & { id: string; basePrice: number },
): QuickProduct => ({
  sku: p.id,
  name: `Producto ${p.id}`,
  slug: p.id,
  isActive: true,
  taxRate: 0.16,
  isIncludedInPrice: true,
  points: 10,
  businessVolume: 100,
  ...p,
});

/** 8616 a $332 con IVA 16 % incluido (MX). */
const P8616 = product({ id: '8616', basePrice: 332 });
/** 9019 Jimmy Coffee a $391, IVA 0 % (MX). */
const P9019 = product({ id: '9019', basePrice: 391, taxRate: 0 });
/** US: $100 sin impuesto incluido, sales tax 8.25 % (se añade). */
const PUS = product({
  id: 'US100',
  basePrice: 100,
  taxRate: 0.0825,
  isIncludedInPrice: false,
});
/** US: $N sin impuesto incluido con la tasa dada. */
const us = (id: string, basePrice: number, taxRate: number) =>
  product({ id, basePrice, taxRate, isIncludedInPrice: false });

/** Renglones de la lib como los arma el spec del API. */
const mx = (
  amount: number,
  rate = 0.16,
  lineDiscount = 0,
): SaleDiscountLine => ({ amount, lineDiscount, rate, taxIncluded: true });
const usLine = (
  amount: number,
  rate: number,
  lineDiscount = 0,
): SaleDiscountLine => ({ amount, lineDiscount, rate, taxIncluded: false });

/**
 * Total que cobraba el POS (y createSale) ANTES de la regla: sumas sin
 * redondear de base e impuesto por renglón y round2 al final. Es exactamente
 * round2(Σ item.total) del carrito.
 */
const legacyTotal = (items: PosCartItem[]): number =>
  round2(items.reduce((sum, it) => sum + it.total, 0));

/** Cada renglón y la cabecera cuadran al centavo (identidades del contrato). */
function expectBalanced(
  lines: readonly SaleDiscountLine[],
  result: ReturnType<typeof applyGlobalDiscount>,
) {
  result.lines.forEach((line, i) => {
    expect(line.base + line.tax).toBeCloseTo(line.total, 10);
    expect(line.gross - line.share).toBeCloseTo(line.net, 10);
    expect(line.base).toBeGreaterThanOrEqual(0);
    expect(line.tax).toBeGreaterThanOrEqual(0);
    expect(line.discountAmount).toBeGreaterThanOrEqual(0);
    const amount = Math.max(0, lines[i].amount);
    expect(round2(amount - line.discountAmount)).toBe(
      lines[i].taxIncluded ? line.net : line.base,
    );
  });
  expect(result.subtotal + result.tax).toBeCloseTo(result.total, 10);
  expect(result.grossTotal - result.discount).toBeCloseTo(result.total, 10);
  expect(result.lines.reduce((a, l) => a + l.gross, 0)).toBeCloseTo(
    result.grossTotal,
    10,
  );
  expect(result.lines.reduce((a, l) => a + l.share, 0)).toBeCloseTo(
    result.discount,
    10,
  );
  expect(result.lines.reduce((a, l) => a + l.total, 0)).toBeCloseTo(
    result.total,
    10,
  );
  expect(result.lines.reduce((a, l) => a + l.base, 0)).toBeCloseTo(
    result.subtotal,
    10,
  );
  expect(result.lines.reduce((a, l) => a + l.tax, 0)).toBeCloseTo(
    result.tax,
    10,
  );
}

const store = () => usePosCartStore.getState();
const cart = () => usePosCartStore.getState().cart;

beforeEach(() => {
  store().clearCart();
});

describe('calculateCartTotals: descuento sobre el total con impuesto', () => {
  it('sin descuento deja el desglose íntegro (332 = 286.21 + 45.79)', () => {
    store().addItem(P8616);
    expect(cart().subtotal).toBe(286.21);
    expect(cart().taxAmount).toBe(45.79);
    expect(cart().total).toBe(332);
    expect(cart().couponDiscount).toBeUndefined();
    expect(cart().discountAmount).toBeUndefined();
    expect(cartGrossTotal(cart().items)).toBe(332);
  });

  it('canónico MX: 8616 a $332, cupón 30 % → 200.34 / 32.06 / 99.60 / 232.40', () => {
    store().addItem(P8616);
    const base = cartGrossTotal(cart().items);
    expect(base).toBe(332);
    store().setCoupon('TL-3GCM52PF', apiPercent(base, 30));
    expect(cart().couponDiscount).toBe(99.6);
    expect(cart().subtotal).toBe(200.34);
    expect(cart().taxAmount).toBe(32.06);
    expect(cart().total).toBe(232.4);
    expect(round2(cart().subtotal + cart().taxAmount)).toBe(cart().total);
    // La base del cupón NO cambia con el cupón aplicado: la re-validación
    // (PosScreen) vuelve a mandar 332, no 232.40.
    expect(cartGrossTotal(cart().items)).toBe(332);
    // Los renglones conservan sus importes brutos (UI); el API recalcula.
    expect(cart().items[0].total).toBe(332);
    expect(cart().items[0].discountAmount).toBe(0);
  });

  it('mixto MX: $391 (IVA 0) + $332 (IVA 16), cupón 10 % → 609.49 / 41.21 / 72.30 / 650.70', () => {
    store().addItem(P9019);
    store().addItem(P8616);
    const base = cartGrossTotal(cart().items);
    expect(base).toBe(723);
    store().setCoupon('DIEZ', apiPercent(base, 10));
    expect(cart().couponDiscount).toBe(72.3);
    expect(prorateDiscount(72.3, [391, 332])).toEqual([39.1, 33.2]);
    expect(cart().subtotal).toBe(609.49);
    expect(cart().taxAmount).toBe(41.21);
    expect(cart().total).toBe(650.7);
  });

  it('US: $100 sin impuesto incluido, tasa 8.25 %, cupón 10 % → 90.00 / 7.42 / 10.83 / 97.42', () => {
    store().addItem(PUS);
    const base = cartGrossTotal(cart().items);
    expect(base).toBe(108.25);
    // 10.825 → 10.83 (mitad hacia arriba, como roundHalfUp2 del API).
    store().setCoupon('US10', apiPercent(base, 10));
    expect(cart().couponDiscount).toBe(10.83);
    expect(cart().subtotal).toBe(90);
    expect(cart().taxAmount).toBe(7.42);
    expect(cart().total).toBe(97.42);
  });

  it('descuento manual porcentual: 30 % SOBRE el total con impuesto (99.60), mismo desglose que el cupón', () => {
    store().addItem(P8616);
    store().setDiscount(30, undefined, 'Autorizado');
    expect(cart().discountPercent).toBe(30);
    expect(cart().discountAmount).toBe(99.6);
    expect(cart().subtotal).toBe(200.34);
    expect(cart().taxAmount).toBe(32.06);
    expect(cart().total).toBe(232.4);
    expect(cart().couponDiscount).toBeUndefined();
    // Si el carrito cambia, el % se vuelve a aplicar sobre el nuevo T (el
    // monto derivado se reescribe; es el que viaja al API, que lo toma
    // primero y obtiene el mismo D).
    store().addItem(P9019);
    expect(cartGrossTotal(cart().items)).toBe(723);
    expect(cart().discountAmount).toBe(216.9);
    expect(cart().total).toBe(506.1);
  });

  it('descuento manual de monto fijo: D con impuesto prorrateado (50 sobre 332 → 243.10 / 38.90 / 282)', () => {
    store().addItem(P8616);
    store().setDiscount(undefined, 50, 'Autorizado');
    expect(cart().discountAmount).toBe(50);
    expect(cart().subtotal).toBe(243.1);
    expect(cart().taxAmount).toBe(38.9);
    expect(cart().total).toBe(282);
  });

  it('el cupón excluye al descuento manual (uno u otro, como el API)', () => {
    store().addItem(P8616);
    store().setDiscount(30, undefined, 'Autorizado');
    store().setCoupon('TL-3GCM52PF', 99.6);
    expect(cart().discountPercent).toBeUndefined();
    expect(cart().discountAmount).toBeUndefined();
    expect(cart().discountReason).toBeUndefined();
    expect(cart().total).toBe(232.4);
    // Snapshot viejo (pestaña estacionada) con ambos: gana el cupón.
    const mixed = calculateCartTotals({
      ...cart(),
      discountPercent: 50,
      discountAmount: 166,
    });
    expect(mixed.discountPercent).toBeUndefined();
    expect(mixed.discountAmount).toBeUndefined();
    expect(mixed.couponDiscount).toBe(99.6);
    expect(mixed.total).toBe(232.4);
  });

  it('residuo de centavos al último renglón con importe; subtotal + impuestos = total', () => {
    // $1.00 entre 3 × $10: 0.33 + 0.33 + 0.34 (el centavo sobrante al último).
    expect(prorateDiscount(1, [10, 10, 10])).toEqual([0.33, 0.33, 0.34]);
    expect(prorateDiscount(1, [10, 10, 10, 0])).toEqual([0.33, 0.33, 0.34, 0]);
    expect(prorateDiscount(1, [])).toEqual([]);
    expect(prorateDiscount(1, [0, 0])).toEqual([0, 0]);
    expect(prorateDiscount(0, [10, 10])).toEqual([0, 0]);
    store().addItem(product({ id: 'A', basePrice: 10 }));
    store().addItem(product({ id: 'B', basePrice: 10 }));
    store().addItem(product({ id: 'C', basePrice: 10 }));
    store().setDiscount(undefined, 1, 'Redondeo');
    // Netos 9.67, 9.67, 9.66 → bases 8.34, 8.34, 8.33; IVA 1.33 cada uno.
    expect(cart().subtotal).toBe(25.01);
    expect(cart().taxAmount).toBe(3.99);
    expect(cart().total).toBe(29);
  });

  it('descuento mayor que el total se topa en T: total 0, nada negativo', () => {
    store().addItem(P8616);
    store().setCoupon('REGALO', 500);
    expect(cart().couponDiscount).toBe(332);
    expect(cart().subtotal).toBe(0);
    expect(cart().taxAmount).toBe(0);
    expect(cart().total).toBe(0);
  });

  it('renglones en $0 (promo canjeada) no reciben parte del descuento', () => {
    store().addItem(
      product({ id: 'PROMO', basePrice: 0, productType: 'promotional', points: 0 }),
    );
    store().addItem(P8616);
    store().setCoupon('TL-3GCM52PF', 99.6);
    expect(prorateDiscount(99.6, [0, 332])).toEqual([0, 99.6]);
    expect(cart().subtotal).toBe(200.34);
    expect(cart().taxAmount).toBe(32.06);
    expect(cart().total).toBe(232.4);
  });

  it('descuento 0 y cupón en 0 no alteran el desglose', () => {
    store().addItem(P8616);
    store().setDiscount(0, 0, undefined);
    expect(cart().discountAmount).toBeUndefined();
    expect(cart().total).toBe(332);
    store().setCoupon('CERO', 0);
    expect(cart().couponDiscount).toBe(0);
    expect(cart().subtotal).toBe(286.21);
    expect(cart().taxAmount).toBe(45.79);
    expect(cart().total).toBe(332);
  });

  it('quitar el cupón restaura el desglose; vaciar el carrito borra cupón y descuento', () => {
    store().addItem(P8616);
    store().setCoupon('TL-3GCM52PF', 99.6);
    store().clearCoupon();
    expect(cart().couponCode).toBeUndefined();
    expect(cart().subtotal).toBe(286.21);
    expect(cart().total).toBe(332);
    store().setCoupon('TL-3GCM52PF', 99.6);
    store().removeItem('8616');
    expect(cart().items).toHaveLength(0);
    expect(cart().couponCode).toBeUndefined();
    expect(cart().couponDiscount).toBeUndefined();
    expect(cart().total).toBe(0);
  });

  it('puntos y valor de negocio no cambian con el descuento', () => {
    store().addItem(P8616, 2);
    store().setCoupon('TL-3GCM52PF', 199.2);
    expect(cart().total).toBe(464.8);
    expect(cart().totalPoints).toBe(20);
    expect(cart().totalBusinessVolume).toBe(200);
  });

  it('lo que viaja al API no cambia: renglones brutos (precio, cantidad, descuento de línea) y código del cupón', () => {
    store().addItem(P9019);
    store().addItem(PUS, 2);
    const before = cart().items;
    store().setCoupon('DIEZ', apiPercent(cartGrossTotal(before), 10));
    // El cupón no toca los renglones (misma referencia): PosScreen manda
    // productId/quantity/discountPercent/discountAmount tal cual + couponCode.
    expect(cart().items).toBe(before);
    expect(
      cart().items.map((it) => [
        it.productId,
        it.quantity,
        it.unitPrice,
        it.discountPercent,
        it.discountAmount,
        round2(it.total),
      ]),
    ).toEqual([
      ['9019', 1, 391, undefined, 0, 391],
      ['US100', 2, 100, undefined, 0, 216.5],
    ]);
    expect(cart().couponCode).toBe('DIEZ');
    expect(cart().couponDiscount).toBe(60.75);
    expect(cart().discountAmount).toBeUndefined();
    expect(cart().discountPercent).toBeUndefined();
  });

  it('cuadra al centavo en una malla de precios, cantidades y porcentajes', () => {
    const prices = [332, 391, 1650, 123.45, 0.01, 99.99];
    for (const pct of [5, 10, 12.5, 30, 33, 50, 100]) {
      for (let i = 0; i < prices.length; i++) {
        store().clearCart();
        store().addItem(product({ id: 'X', basePrice: prices[i] }), 3);
        store().addItem(
          product({
            id: 'Y',
            basePrice: prices[(i + 1) % prices.length],
            taxRate: 0,
          }),
        );
        store().addItem(
          product({
            id: 'Z',
            basePrice: prices[(i + 2) % prices.length],
            taxRate: 0.0825,
            isIncludedInPrice: false,
          }),
          2,
        );
        const base = cartGrossTotal(cart().items);
        store().setCoupon('MALLA', apiPercent(base, pct));
        const c = cart();
        expect(round2(c.subtotal + c.taxAmount)).toBe(c.total);
        expect(c.total).toBe(round2(base - (c.couponDiscount ?? 0)));
        expect(c.subtotal).toBeGreaterThanOrEqual(0);
        expect(c.taxAmount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('paridad 1:1 con pos/lib/sale-discount.lib.ts del API (casos del spec)', () => {
  it('US 2 × $10 @ 8.25 % en dos renglones: T = 21.65 (no 21.66) = round2(Σ item.total); brutos [10.83, 10.82]', () => {
    store().addItem(us('USA', 10, 0.0825));
    store().addItem(us('USB', 10, 0.0825));
    const items = cart().items;
    // T = round2(Σ bruto SIN redondear por renglón) = round2(10.825 + 10.825).
    expect(legacyTotal(items)).toBe(21.65);
    expect(cartGrossTotal(items)).toBe(21.65);
    const lines = items.map(toDiscountLine);
    expect(saleGrossTotal(lines)).toBe(21.65);
    // Por renglón a centavos: 10.83 + 10.83 = 21.66; el centavo del residuo
    // se carga al ÚLTIMO renglón con importe.
    expect(lineGrossCents(lines)).toEqual({
      grossTotal: 21.65,
      gross: [10.83, 10.82],
    });
    const r = applyGlobalDiscount(lines, 0);
    expect(r.lines.map((l) => l.gross)).toEqual([10.83, 10.82]);
    // La base no se mueve (precio × cantidad): el centavo queda en el impuesto.
    expect(r.lines.map((l) => l.base)).toEqual([10, 10]);
    expect(r.lines.map((l) => l.tax)).toEqual([0.83, 0.82]);
    expect(r.lines.map((l) => l.discountAmount)).toEqual([0, 0]);
    expect(r).toMatchObject({ subtotal: 20, tax: 1.65, total: 21.65 });
    expectBalanced(lines, r);
    // El carrito muestra lo mismo que guardará el API.
    expect(cart().subtotal).toBe(20);
    expect(cart().taxAmount).toBe(1.65);
    expect(cart().total).toBe(21.65);

    // Con cupón del 10 % sobre T: D = round2(2.165) = 2.17; partes 1.09 +
    // 1.08 sobre los brutos [10.83, 10.82]; netos 9.74 y 9.74; bases del neto
    // exacto (10.825 − parte) / 1.0825 = 8.99 y 9.00.
    store().setCoupon('US10', apiPercent(21.65, 10));
    expect(cart().couponDiscount).toBe(2.17);
    expect(prorateDiscount(2.17, [10.83, 10.82])).toEqual([1.09, 1.08]);
    const rc = applyGlobalDiscount(lines, 2.17);
    expect(rc.lines.map((l) => l.share)).toEqual([1.09, 1.08]);
    expect(rc.lines.map((l) => l.net)).toEqual([9.74, 9.74]);
    expect(rc.lines.map((l) => l.base)).toEqual([8.99, 9]);
    expect(rc.lines.map((l) => l.tax)).toEqual([0.75, 0.74]);
    expect(rc).toMatchObject({ subtotal: 17.99, tax: 1.49, total: 19.48 });
    expectBalanced(lines, rc);
    expect(cart().subtotal).toBe(17.99);
    expect(cart().taxAmount).toBe(1.49);
    expect(cart().total).toBe(19.48);
    expect(round2(cart().subtotal + cart().taxAmount)).toBe(cart().total);
  });

  it('US $70 + $30 @ 10.25 % (Santa Fe Springs): T = 110.25 (no 110.26); brutos [77.18, 33.07]; cabecera 100.00 / 10.25', () => {
    store().addItem(us('U70', 70, 0.1025));
    store().addItem(us('U30', 30, 0.1025));
    const items = cart().items;
    expect(legacyTotal(items)).toBe(110.25);
    expect(cartGrossTotal(items)).toBe(110.25);
    const lines = items.map(toDiscountLine);
    expect(lineGrossCents(lines).gross).toEqual([77.18, 33.07]);
    const r = applyGlobalDiscount(lines, 0);
    expect(r.lines.map((l) => l.base)).toEqual([70, 30]);
    expect(r.lines.map((l) => l.tax)).toEqual([7.18, 3.07]);
    expect(r).toMatchObject({ subtotal: 100, tax: 10.25, total: 110.25 });
    expectBalanced(lines, r);
    expect(cart().subtotal).toBe(100);
    expect(cart().taxAmount).toBe(10.25);
    expect(cart().total).toBe(110.25);
  });

  it('MX 2 × $332 sin descuento: total 664 sin cambio; la cabecera es Σ bases por renglón', () => {
    // Dos RENGLONES de $332: 286.21 + 286.21 = 572.42 / 91.58 (antes,
    // round2 de la suma sin redondear: 572.41 / 91.59).
    store().addItem(P8616);
    store().addItem(product({ id: '8616B', basePrice: 332 }));
    expect(legacyTotal(cart().items)).toBe(664);
    const lines = cart().items.map(toDiscountLine);
    const r = applyGlobalDiscount(lines, 0);
    expect(r.lines.map((l) => l.base)).toEqual([286.21, 286.21]);
    expect(r).toMatchObject({
      grossTotal: 664,
      discount: 0,
      subtotal: 572.42,
      tax: 91.58,
      total: 664,
    });
    expectBalanced(lines, r);
    expect(cart().subtotal).toBe(572.42);
    expect(cart().taxAmount).toBe(91.58);
    expect(cart().total).toBe(664);

    // UN renglón con cantidad 2 es un solo renglón de $664 (es la estructura
    // que recibe el API): base round2(664 / 1.16) = 572.41 / 91.59.
    store().clearCart();
    store().addItem(P8616, 2);
    expect(cart().items).toHaveLength(1);
    expect(cart().subtotal).toBe(572.41);
    expect(cart().taxAmount).toBe(91.59);
    expect(cart().total).toBe(664);
  });

  it('canónico MX: 8616 a $332 (IVA 16 %), cupón 30 % → renglón 332 / 99.60 / 232.40 / 200.34 / 32.06', () => {
    const lines = [mx(332)];
    const T = saleGrossTotal(lines);
    expect(T).toBe(332);
    const D = percentDiscount(T, 30);
    expect(D).toBe(99.6);
    const r = applyGlobalDiscount(lines, D);
    expect(r.lines[0]).toEqual({
      gross: 332,
      share: 99.6,
      net: 232.4,
      base: 200.34,
      tax: 32.06,
      total: 232.4,
      discountAmount: 99.6,
    });
    expect(r).toMatchObject({
      grossTotal: 332,
      discount: 99.6,
      subtotal: 200.34,
      tax: 32.06,
      total: 232.4,
    });
    expectBalanced(lines, r);
  });

  it('mixto: 9019 $391 (IVA 0 %) + 8616 $332 (IVA 16 %), cupón 10 % → partes 39.10 y 33.20; 609.49 / 41.21 / 72.30 / 650.70', () => {
    const lines = [mx(391, 0), mx(332, 0.16)];
    const T = saleGrossTotal(lines);
    expect(T).toBe(723);
    const D = percentDiscount(T, 10);
    expect(D).toBe(72.3);
    const r = applyGlobalDiscount(lines, D);
    expect(r.lines.map((l) => l.share)).toEqual([39.1, 33.2]);
    expect(r.lines.map((l) => l.discountAmount)).toEqual([39.1, 33.2]);
    expect(r.lines[0]).toMatchObject({ net: 351.9, base: 351.9, tax: 0 });
    expect(r.lines[1]).toMatchObject({ net: 298.8, base: 257.59, tax: 41.21 });
    expect(r).toMatchObject({
      subtotal: 609.49,
      tax: 41.21,
      discount: 72.3,
      total: 650.7,
    });
    expectBalanced(lines, r);
  });

  it('US: precio 100 sin impuesto, sales tax 8.25 %, cupón 10 % → bruto 108.25, D 10.83, 90.00 / 7.42 / 97.42, descuento guardado 10.00', () => {
    const lines = [usLine(100, 0.0825)];
    expect(lineGrossWithTax(lines[0])).toBeCloseTo(108.25, 10);
    const T = saleGrossTotal(lines);
    expect(T).toBe(108.25);
    const D = percentDiscount(T, 10);
    expect(D).toBe(10.83);
    const r = applyGlobalDiscount(lines, D);
    expect(r.lines[0]).toEqual({
      gross: 108.25,
      share: 10.83,
      net: 97.42,
      base: 90,
      tax: 7.42,
      total: 97.42,
      // La parte del global en el espacio del precio: 100 − 90.00.
      discountAmount: 10,
    });
    expect(r).toMatchObject({ subtotal: 90, tax: 7.42, total: 97.42 });
    expectBalanced(lines, r);

    // $10 al 50 %: bruto 10.825 → 10.83; D 5.42 (5.415 hacia arriba); neto
    // 5.41; base round2((10.825 − 5.42) / 1.0825) = 4.99; impuesto 0.42; la
    // identidad precio − discount_amount = base es EXACTA.
    const lines10 = [usLine(10, 0.0825)];
    const r10 = applyGlobalDiscount(
      lines10,
      percentDiscount(saleGrossTotal(lines10), 50),
    );
    expect(r10.lines[0]).toMatchObject({
      gross: 10.83,
      share: 5.42,
      net: 5.41,
      base: 4.99,
      tax: 0.42,
      discountAmount: 5.01,
    });
    expectBalanced(lines10, r10);
  });

  it('residuo de centavos: al ÚLTIMO renglón con importe (3 × 100 y un regalo en $0, D = 10 → 3.33 / 3.33 / 3.34 / 0); cupón 50 sobre 116 / 232 / 58 → 14.29 / 28.57 / 7.14', () => {
    const lines = [mx(100), mx(100), mx(100), mx(0)];
    const r = applyGlobalDiscount(lines, 10);
    expect(r.lines.map((l) => l.share)).toEqual([3.33, 3.33, 3.34, 0]);
    expect(r.lines[3]).toMatchObject({
      gross: 0,
      net: 0,
      base: 0,
      tax: 0,
      discountAmount: 0,
    });
    expect(r).toMatchObject({ grossTotal: 300, discount: 10, total: 290 });
    expectBalanced(lines, r);

    const cfdi = [mx(116), mx(232), mx(58)];
    const rc = applyGlobalDiscount(cfdi, 50);
    expect(rc.lines.map((l) => l.share)).toEqual([14.29, 28.57, 7.14]);
    expect(rc.total).toBe(356);
    expectBalanced(cfdi, rc);
  });

  it('acotaciones: descuento mayor a T, 0 / negativo / NaN, sin renglones, descuento de línea mayor al importe, línea + cupón, topes', () => {
    const big = applyGlobalDiscount([mx(116)], 500);
    expect(big).toMatchObject({
      grossTotal: 116,
      discount: 116,
      subtotal: 0,
      tax: 0,
      total: 0,
    });
    expect(big.lines[0]).toMatchObject({
      share: 116,
      net: 0,
      base: 0,
      tax: 0,
      discountAmount: 116,
    });

    for (const d of [0, -5, Number.NaN]) {
      const lines = [mx(116), mx(232)];
      const r = applyGlobalDiscount(lines, d);
      expect(r.lines.map((l) => l.share)).toEqual([0, 0]);
      expect(r.lines.map((l) => l.discountAmount)).toEqual([0, 0]);
      expect(r).toMatchObject({
        discount: 0,
        subtotal: 300,
        tax: 48,
        total: 348,
      });
      expectBalanced(lines, r);
    }

    expect(applyGlobalDiscount([mx(0), mx(0)], 10)).toMatchObject({
      grossTotal: 0,
      discount: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
    });
    expect(applyGlobalDiscount([], 10)).toEqual({
      grossTotal: 0,
      discount: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
      lines: [],
    });

    // Descuento de línea mayor al importe: renglón en 0 (no negativo) y su
    // descuento guardado = el importe.
    expect(lineGrossWithTax(mx(100, 0.16, 120))).toBe(0);
    const over = [mx(100, 0.16, 120), mx(100)];
    const ro = applyGlobalDiscount(over, 10);
    expect(ro.lines.map((l) => l.share)).toEqual([0, 10]);
    expect(ro.lines[0]).toMatchObject({ net: 0, base: 0, discountAmount: 100 });
    expect(ro.total).toBe(90);
    expectBalanced(over, ro);

    // $100 con $10 de línea y cupón 10 %: T = 90; D = 9; neto 81;
    // discount_amount = 10 + 9 = 19 = 100 − 81.
    const withLine = [mx(100, 0.16, 10)];
    const rl = applyGlobalDiscount(
      withLine,
      percentDiscount(saleGrossTotal(withLine), 10),
    );
    expect(rl).toMatchObject({ grossTotal: 90, discount: 9, total: 81 });
    expect(rl.lines[0]).toMatchObject({ share: 9, net: 81, discountAmount: 19 });
    expectBalanced(withLine, rl);

    expect(percentDiscount(332, 30, 50)).toBe(50);
    expect(percentDiscount(332, 30, null)).toBe(99.6);
    expect(percentDiscount(332, 150)).toBe(332);
    expect(percentDiscount(332, 0)).toBe(0);
    expect(fixedDiscount(332, 40)).toBe(40);
    expect(fixedDiscount(332, 400)).toBe(332);
    expect(fixedDiscount(332, -1)).toBe(0);
    expect(fixedDiscount(332, 10.005)).toBe(10.01);
  });

  it('barrido determinista (MX y US, con y sin descuento): sin descuento T = fórmula anterior; siempre Σ renglones = cabecera y subtotal + impuesto = total', () => {
    let seed = 20261029;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const rates = [0.0825, 0.1025, 0.07, 0.0625, 0];
    for (let c = 0; c < 1500; c++) {
      const taxIncluded = next() < 0.5;
      const n = 1 + Math.floor(next() * 5);
      const items: PosCartItem[] = Array.from({ length: n }, (_, i) => {
        const unitPrice = next() < 0.1 ? 0 : Math.round(next() * 50000) / 100;
        const quantity = 1 + Math.floor(next() * 4);
        const discountPercent = next() < 0.2 ? Math.round(next() * 50) : 0;
        return calculateItemTotal({
          productId: `P${i}`,
          productSku: `P${i}`,
          productName: `P${i}`,
          quantity,
          unitPrice,
          taxRate: taxIncluded
            ? next() < 0.2
              ? 0
              : 0.16
            : rates[Math.floor(next() * rates.length)],
          taxAmount: 0,
          isIncludedInPrice: taxIncluded,
          subtotal: 0,
          total: 0,
          points: 0,
          businessVolume: 0,
          discountPercent: discountPercent || undefined,
        });
      });
      const lines = items.map(toDiscountLine);
      const T = cartGrossTotal(items);
      // Sin descuento: T es EXACTAMENTE el total de siempre.
      expect(T).toBe(legacyTotal(items));
      expect(T).toBe(saleGrossTotal(lines));
      const r0 = applyGlobalDiscount(lines, 0);
      expect(r0.total).toBe(T);
      expect(r0.lines.every((l) => l.share === 0)).toBe(true);
      expectBalanced(lines, r0);

      const D =
        next() < 0.5
          ? percentDiscount(T, Math.round(next() * 10000) / 100)
          : fixedDiscount(T, Math.round(next() * T * 100) / 100);
      const r = applyGlobalDiscount(lines, D);
      expect(r.grossTotal).toBe(T);
      expect(r.discount).toBe(D);
      expectBalanced(lines, r);
      // El carrito reporta la misma cabecera que el API guardará.
      const c = calculateCartTotals({
        ...cart(),
        items,
        couponCode: 'BARRIDO',
        couponDiscount: D,
      });
      expect(c.subtotal).toBe(r.subtotal);
      expect(c.taxAmount).toBe(r.tax);
      expect(c.total).toBe(r.total);
      expect(c.couponDiscount).toBe(r.discount);
    }
  });
});

describe('descuento de LÍNEA (latente, sin UI): mismo redondeo y semántica que el API', () => {
  const line = (p: Partial<PosCartItem>): PosCartItem =>
    calculateItemTotal({
      productId: 'L',
      productSku: 'L',
      productName: 'Línea',
      quantity: 1,
      unitPrice: 0,
      taxRate: 0.16,
      taxAmount: 0,
      isIncludedInPrice: true,
      subtotal: 0,
      total: 0,
      points: 0,
      businessVolume: 0,
      ...p,
    });

  it('porcentual: se redondea a centavos ANTES de restar (0.03 × 50 % → descuento 0.02, bruto 0.01, como el API)', () => {
    const half = line({ unitPrice: 0.03, discountPercent: 50 });
    expect(half.discountAmount).toBe(0.02);
    expect(round2(half.total)).toBe(0.01);
    expect(cartGrossTotal([half])).toBe(0.01);
    // Tres renglones con centavos impares al 50 %: 0.05 / 0.07 / 0.09 →
    // descuentos 0.03 / 0.04 / 0.05 (mitad hacia arriba) → T = 0.02 + 0.03
    // + 0.04 = 0.09 (sin redondear el descuento salía 0.11).
    const odd = [0.05, 0.07, 0.09].map((unitPrice) =>
      line({ unitPrice, discountPercent: 50 }),
    );
    expect(odd.map((i) => i.discountAmount)).toEqual([0.03, 0.04, 0.05]);
    expect(cartGrossTotal(odd)).toBe(0.09);
  });

  it('monto fijo: es el importe de TODA la línea (no por unidad) y no se acumula al recalcular', () => {
    const once = line({ unitPrice: 10, quantity: 2, discountAmount: 3 });
    expect(once.discountAmount).toBe(3);
    expect(round2(once.total)).toBe(17);
    // Cambio de cantidad (updateItemQuantity recalcula el renglón): el
    // descuento sigue siendo 3 para la línea, no 3 × cantidad ni 6 × 3.
    const again = calculateItemTotal({ ...once, quantity: 3 });
    expect(again.discountAmount).toBe(3);
    expect(round2(again.total)).toBe(27);
    // Con más de 2 decimales se lleva a centavos (el API rechaza >2).
    expect(line({ unitPrice: 10, discountAmount: 1.005 }).discountAmount).toBe(
      1.01,
    );
    // Sin descuento de línea no cambia nada: bruto = precio × cantidad.
    expect(line({ unitPrice: 332, quantity: 2 }).discountAmount).toBe(0);
    expect(cartGrossTotal([line({ unitPrice: 332, quantity: 2 })])).toBe(664);
  });
});
