// receiptTotals.test.ts - Presentación del bloque de totales con cupón o
// descuento global (decisión de Sistemas, 29-oct-2026 11:40): los cuatro
// ejemplos de la especificación deben salir tal cual; sin descuento no cambia
// nada; la variante US (impuesto añadido); la deducción "impuesto incluido" en
// la reimpresión desde la venta guardada.

import { describe, expect, it } from 'vitest';
import {
  buildReceiptTotalsRows,
  receiptTotalsLabel,
  savedSaleItemGross,
  savedSaleItemRate,
  savedSaleItemTaxIncluded,
  type ReceiptTotalsRow,
} from './receiptTotals';

/** Filas como se imprimen: [etiqueta, importe]. */
const printed = (rows: ReceiptTotalsRow[]) =>
  rows.map((r) => [r.label, r.amount]);

describe('buildReceiptTotalsRows: ejemplos de la especificación', () => {
  it('MX, 8616 a 332.00 (IVA 16 % incluido), cupón TL-3GCM52PF 30 %: Subtotal 332.00 / Cupón −99.60 / TOTAL 232.40 / IVA incluido 32.06', () => {
    const rows = buildReceiptTotalsRows({
      items: [{ quantity: 1, unitPrice: 332, taxIncluded: true }],
      subtotal: 200.34,
      discountAmount: 99.6,
      taxAmount: 32.06,
      total: 232.4,
      couponCode: 'TL-3GCM52PF',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 332],
      ['Cupón TL-3GCM52PF', -99.6],
      ['TOTAL', 232.4],
      ['IVA incluido', 32.06],
    ]);
    expect(rows.map((r) => r.kind)).toEqual([
      'subtotal',
      'discount',
      'total',
      'taxIncluded',
    ]);
    expect(rows[1].code).toBe('TL-3GCM52PF');
  });

  it('MX mixto, 9019 391.00 (IVA 0 %) + 8616 332.00 (IVA 16 %), cupón 10 %: Subtotal 723.00 / Cupón −72.30 / TOTAL 650.70 / IVA incluido 41.21', () => {
    const rows = buildReceiptTotalsRows({
      items: [
        { quantity: 1, unitPrice: 391, taxIncluded: true },
        { quantity: 1, unitPrice: 332, taxIncluded: true },
      ],
      subtotal: 609.49,
      discountAmount: 72.3,
      taxAmount: 41.21,
      total: 650.7,
      couponCode: 'DIEZ',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 723],
      ['Cupón DIEZ', -72.3],
      ['TOTAL', 650.7],
      ['IVA incluido', 41.21],
    ]);
  });

  it('US, 100.00 sin impuesto, sales tax 8.25 %, cupón 10 %: Subtotal 100.00 / Descuento −10.00 / Tax 7.42 / TOTAL 97.42 (las líneas suman)', () => {
    const rows = buildReceiptTotalsRows({
      items: [{ quantity: 1, unitPrice: 100, taxIncluded: false }],
      subtotal: 90,
      discountAmount: 10.83,
      taxAmount: 7.42,
      total: 97.42,
      couponCode: 'US10',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 100],
      ['Descuento', -10],
      ['Tax', 7.42],
      ['TOTAL', 97.42],
    ]);
    expect(rows.map((r) => r.kind)).toEqual([
      'subtotal',
      'discount',
      'tax',
      'total',
    ]);
    expect(100 - 10 + 7.42).toBeCloseTo(97.42, 10);
  });

  it('MX sin cupón, 8616 a 332.00: Subtotal 286.21 / IVA 45.79 / TOTAL 332.00 (sin cambio respecto a hoy)', () => {
    const rows = buildReceiptTotalsRows({
      items: [{ quantity: 1, unitPrice: 332, taxIncluded: true }],
      subtotal: 286.21,
      discountAmount: 0,
      taxAmount: 45.79,
      total: 332,
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 286.21],
      ['IVA', 45.79],
      ['TOTAL', 332],
    ]);
  });
});

describe('buildReceiptTotalsRows: reglas', () => {
  it('sin descuento global la etiqueta del impuesto es "IVA" también en US y la fila sale también en 0 (la pantalla siempre mostró "Impuestos 0.00"; el ticket impreso la omite)', () => {
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 2, unitPrice: 10, taxIncluded: false }],
          subtotal: 20,
          discountAmount: 0,
          taxAmount: 1.65,
          total: 21.65,
        }),
      ),
    ).toEqual([
      ['Subtotal', 20],
      ['IVA', 1.65],
      ['TOTAL', 21.65],
    ]);
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 391, taxIncluded: true }],
          subtotal: 391,
          discountAmount: 0,
          taxAmount: 0,
          total: 391,
        }),
      ),
    ).toEqual([
      ['Subtotal', 391],
      ['IVA', 0],
      ['TOTAL', 391],
    ]);
  });

  it('descuento manual (sin código de cupón): la fila dice "Descuento"; "IVA incluido" sale también en 0 (igual que la reimpresión del admin)', () => {
    const rows = buildReceiptTotalsRows({
      items: [{ quantity: 1, unitPrice: 332, taxIncluded: true }],
      subtotal: 243.1,
      discountAmount: 50,
      taxAmount: 38.9,
      total: 282,
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 332],
      ['Descuento', -50],
      ['TOTAL', 282],
      ['IVA incluido', 38.9],
    ]);
    expect(rows[1].code).toBeUndefined();

    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 391, taxIncluded: true }],
          subtotal: 351.9,
          discountAmount: 39.1,
          taxAmount: 0,
          total: 351.9,
          couponCode: 'DIEZ',
        }),
      ),
    ).toEqual([
      ['Subtotal', 391],
      ['Cupón DIEZ', -39.1],
      ['TOTAL', 351.9],
      ['IVA incluido', 0],
    ]);
  });

  it('solo opinan los renglones CON impuesto: 391 al 0 % sin regla fiscal (taxIncluded false, como lo deja el store) + 332 al 16 % con cupón sigue siendo la variante con IVA incluido', () => {
    // Producto MX sin fila en product_taxes: el API manda taxIncludedInPrice
    // indefinido y el store lo guarda como isIncludedInPrice false. Antes
    // bastaba ese renglón para imprimir "Descuento −113.51 / Tax 41.21".
    const rows = buildReceiptTotalsRows({
      items: [
        { quantity: 1, unitPrice: 391, taxIncluded: false, taxRate: 0 },
        { quantity: 1, unitPrice: 332, taxIncluded: true, taxRate: 0.16 },
      ],
      subtotal: 609.49,
      discountAmount: 72.3,
      taxAmount: 41.21,
      total: 650.7,
      couponCode: 'DIEZ',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 723],
      ['Cupón DIEZ', -72.3],
      ['TOTAL', 650.7],
      ['IVA incluido', 41.21],
    ]);
    // La tasa en porcentaje (16) también cuenta como "con impuesto".
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [
            { quantity: 1, unitPrice: 391, taxIncluded: false, taxRate: 0 },
            { quantity: 1, unitPrice: 332, taxIncluded: true, taxRate: 16 },
          ],
          subtotal: 609.49,
          discountAmount: 72.3,
          taxAmount: 41.21,
          total: 650.7,
          couponCode: 'DIEZ',
        }),
      ),
    ).toEqual(printed(rows));
  });

  it('solo renglones al 0 % (sin voto): decide por cuadre → incluido; un renglón US con impuesto sigue mandando a la variante US aunque haya exentos', () => {
    // Carrito MX solo con productos sin regla fiscal (taxIncluded false):
    // Σ renglones = total + D → incluido, con "IVA incluido 0.00".
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 391, taxIncluded: false, taxRate: 0 }],
          subtotal: 351.9,
          discountAmount: 39.1,
          taxAmount: 0,
          total: 351.9,
          couponCode: 'DIEZ',
        }),
      ),
    ).toEqual([
      ['Subtotal', 391],
      ['Cupón DIEZ', -39.1],
      ['TOTAL', 351.9],
      ['IVA incluido', 0],
    ]);
    // US: exento (rate 0, el API lo manda como incluido) + gravado al 8.25 %.
    // T = 50 + 108.25 = 158.25; cupón 10 % → D 15.83; partes 5.00 / 10.83;
    // bases 45.00 + 90.00 = 135.00; impuesto 7.42; total 142.42.
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [
            { quantity: 1, unitPrice: 50, taxIncluded: true, taxRate: 0 },
            { quantity: 1, unitPrice: 100, taxIncluded: false, taxRate: 0.0825 },
          ],
          subtotal: 135,
          discountAmount: 15.83,
          taxAmount: 7.42,
          total: 142.42,
          couponCode: 'US10',
        }),
      ),
    ).toEqual([
      ['Subtotal', 150],
      ['Descuento', -15],
      ['Tax', 7.42],
      ['TOTAL', 142.42],
    ]);
    expect(150 - 15 + 7.42).toBeCloseTo(142.42, 10);
    // Sin tasa conocida (snapshot viejo de la cola local) se respeta
    // taxIncluded tal cual.
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 100, taxIncluded: false }],
          subtotal: 90,
          discountAmount: 10.83,
          taxAmount: 7.42,
          total: 97.42,
        }),
      )[1],
    ).toEqual(['Descuento', -10]);
  });

  it('la variante US también devuelve la fila Tax en 0 (la pantalla la muestra; el ticket impreso la omite)', () => {
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 100, taxIncluded: false, taxRate: 0.0825 }],
          subtotal: 90,
          discountAmount: 10,
          taxAmount: 0,
          total: 90,
        }),
      ),
    ).toEqual([
      ['Subtotal', 100],
      ['Descuento', -10],
      ['Tax', 0],
      ['TOTAL', 90],
    ]);
  });

  it('el Subtotal con impuesto incluido es total + D (cuadra con el TOTAL al centavo) y el descuento de línea manual se resta de los renglones', () => {
    // $100 con $10 de línea y cupón 10 %: T = 90; D = 9; total 81 (base
    // 69.83, IVA 11.17).
    const rows = buildReceiptTotalsRows({
      items: [{ quantity: 1, unitPrice: 100, lineDiscount: 10, taxIncluded: true }],
      subtotal: 69.83,
      discountAmount: 9,
      taxAmount: 11.17,
      total: 81,
      couponCode: 'X',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 90],
      ['Cupón X', -9],
      ['TOTAL', 81],
      ['IVA incluido', 11.17],
    ]);
  });

  it('US con dos renglones y residuo: Subtotal = Σ sin impuesto, Descuento = Subtotal − base neta', () => {
    // 2 × $10 @ 8.25 %, cupón 10 %: T 21.65, D 2.17, bases 8.99 + 9.00 =
    // 17.99, impuesto 1.49, total 19.48.
    const rows = buildReceiptTotalsRows({
      items: [
        { quantity: 1, unitPrice: 10, taxIncluded: false },
        { quantity: 1, unitPrice: 10, taxIncluded: false },
      ],
      subtotal: 17.99,
      discountAmount: 2.17,
      taxAmount: 1.49,
      total: 19.48,
      couponCode: 'US10',
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 20],
      ['Descuento', -2.01],
      ['Tax', 1.49],
      ['TOTAL', 19.48],
    ]);
    expect(20 - 2.01 + 1.49).toBeCloseTo(19.48, 10);
  });

  it('los regalos a $0 no cuentan y un renglón con impuesto añadido basta para la variante US', () => {
    const rows = buildReceiptTotalsRows({
      items: [
        { quantity: 1, unitPrice: 0, gift: true, taxIncluded: true },
        { quantity: 1, unitPrice: 100, taxIncluded: false },
      ],
      subtotal: 90,
      discountAmount: 10.83,
      taxAmount: 7.42,
      total: 97.42,
    });
    expect(printed(rows)).toEqual([
      ['Subtotal', 100],
      ['Descuento', -10],
      ['Tax', 7.42],
      ['TOTAL', 97.42],
    ]);
  });

  it('sin señal de impuesto incluido decide por cuadre: Σ renglones = total + D → incluido; si no → añadido', () => {
    // Snapshot viejo de la cola local (sin taxIncluded): MX cuadra.
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 332 }],
          subtotal: 200.34,
          discountAmount: 99.6,
          taxAmount: 32.06,
          total: 232.4,
          couponCode: 'TL-3GCM52PF',
        }),
      ),
    ).toEqual([
      ['Subtotal', 332],
      ['Cupón TL-3GCM52PF', -99.6],
      ['TOTAL', 232.4],
      ['IVA incluido', 32.06],
    ]);
    // US: 100 ≠ 97.42 + 10.83 → impuesto añadido.
    expect(
      printed(
        buildReceiptTotalsRows({
          items: [{ quantity: 1, unitPrice: 100 }],
          subtotal: 90,
          discountAmount: 10.83,
          taxAmount: 7.42,
          total: 97.42,
          couponCode: 'US10',
        }),
      ),
    ).toEqual([
      ['Subtotal', 100],
      ['Descuento', -10],
      ['Tax', 7.42],
      ['TOTAL', 97.42],
    ]);
  });
});

describe('reimpresión desde la venta guardada (SaleDto.items[])', () => {
  it('savedSaleItemTaxIncluded: precio × cantidad − descuento = total → incluido (MX); = base → añadido (US); sin impuesto → sin señal', () => {
    // Venta nueva MX con cupón (renglón con su parte prorrateada).
    expect(
      savedSaleItemTaxIncluded({
        quantity: 1,
        unitPrice: 332,
        discountAmount: 99.6,
        taxRate: 16,
        subtotal: 200.34,
        total: 232.4,
      }),
    ).toBe(true);
    // Venta anterior a la regla (línea sin descuento).
    expect(
      savedSaleItemTaxIncluded({
        quantity: 2,
        unitPrice: 332,
        discountAmount: 0,
        taxRate: 16,
        subtotal: 572.41,
        total: 664,
      }),
    ).toBe(true);
    // US nueva: precio − descuento guardado (10.00) = base 90.
    expect(
      savedSaleItemTaxIncluded({
        quantity: 1,
        unitPrice: 100,
        discountAmount: 10,
        taxRate: 8.25,
        subtotal: 90,
        total: 97.42,
      }),
    ).toBe(false);
    // US sin descuento, tasa como decimal (cargas antiguas).
    expect(
      savedSaleItemTaxIncluded({
        quantity: 1,
        unitPrice: 70,
        discountAmount: 0,
        taxRate: 0.1025,
        subtotal: 70,
        total: 77.18,
      }),
    ).toBe(false);
    // IVA 0 %: no hay forma de saberlo (y no importa).
    expect(
      savedSaleItemTaxIncluded({
        quantity: 1,
        unitPrice: 391,
        discountAmount: 39.1,
        taxRate: 0,
        subtotal: 351.9,
        total: 351.9,
      }),
    ).toBeUndefined();
    expect(savedSaleItemRate(16)).toBe(0.16);
    expect(savedSaleItemRate(0.16)).toBe(0.16);
    expect(savedSaleItemRate(undefined)).toBe(0);
  });

  it('savedSaleItemGross: bruto del renglón como en el ticket original (332.00 aunque el total guardado sea 232.40; US con impuesto: 108.25)', () => {
    const mxItem = {
      quantity: 1,
      unitPrice: 332,
      discountAmount: 99.6,
      taxRate: 16,
      subtotal: 200.34,
      total: 232.4,
    };
    expect(savedSaleItemGross(mxItem, savedSaleItemTaxIncluded(mxItem))).toBe(
      332,
    );
    const usItem = {
      quantity: 1,
      unitPrice: 100,
      discountAmount: 10,
      taxRate: 8.25,
      subtotal: 90,
      total: 97.42,
    };
    expect(
      savedSaleItemGross(usItem, savedSaleItemTaxIncluded(usItem)),
    ).toBeCloseTo(108.25, 10);
    // Sin señal (IVA 0 %): precio × cantidad.
    expect(
      savedSaleItemGross(
        {
          quantity: 2,
          unitPrice: 391,
          discountAmount: 78.2,
          taxRate: 0,
          subtotal: 703.8,
          total: 703.8,
        },
        undefined,
      ),
    ).toBe(782);
  });
});

describe('receiptTotalsLabel: la etiqueta del ticket impreso cabe junto al importe', () => {
  const coupon = (code: string): ReceiptTotalsRow => ({
    kind: 'discount',
    label: `Cupón ${code}`,
    amount: -99.6,
    code,
  });

  it('"Cupón <código>" se imprime completo cuando cabe (TL-3GCM52PF en 58 y 80 mm)', () => {
    expect(receiptTotalsLabel(coupon('TL-3GCM52PF'), '-$99.60', 32)).toBe(
      'Cupón TL-3GCM52PF',
    );
    expect(receiptTotalsLabel(coupon('TL-3GCM52PF'), '-$99.60', 48)).toBe(
      'Cupón TL-3GCM52PF',
    );
    // Justo al límite de 58 mm: 6 + 18 + 1 + 7 = 32 columnas.
    expect(receiptTotalsLabel(coupon('A'.repeat(18)), '-$99.60', 32)).toBe(
      `Cupón ${'A'.repeat(18)}`,
    );
  });

  it('con un código largo (hasta 40 caracteres) se imprime solo "Cupón" y el importe sale completo', () => {
    expect(receiptTotalsLabel(coupon('A'.repeat(19)), '-$99.60', 32)).toBe('Cupón');
    expect(
      receiptTotalsLabel(coupon('BIENVENIDO2026-ABCDEFGHIJKLMNOPQRSTUVWXY'), '-$99.60', 32),
    ).toBe('Cupón');
    expect(receiptTotalsLabel(coupon('A'.repeat(34)), '-$99.60', 48)).toBe(
      `Cupón ${'A'.repeat(34)}`,
    );
    expect(receiptTotalsLabel(coupon('A'.repeat(35)), '-$99.60', 48)).toBe('Cupón');
  });

  it('las demás etiquetas no cambian y, si no cupieran, se recortan por la etiqueta (nunca por el importe)', () => {
    expect(receiptTotalsLabel({ label: 'IVA incluido' }, '$32.06', 32)).toBe(
      'IVA incluido',
    );
    expect(receiptTotalsLabel({ label: 'TOTAL' }, '$232.40', 32)).toBe('TOTAL');
    expect(receiptTotalsLabel({ label: 'X'.repeat(40) }, '$1.00', 32)).toBe(
      'X'.repeat(26),
    );
  });
});
