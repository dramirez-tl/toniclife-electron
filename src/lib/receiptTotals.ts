// receiptTotals.ts - Filas del bloque de TOTALES cuando la venta lleva cupón o
// descuento global (decisión de Sistemas, 29-oct-2026 11:40): el cliente ve
// "Subtotal 332.00 / Cupón −99.60 / TOTAL 232.40" y debajo la línea
// informativa "IVA incluido 32.06". Lo que se calcula y se guarda NO cambia
// (regla 29-oct: descuento sobre el total con impuesto, desglose prorrateado;
// ver lib/saleDiscount.ts); solo cambia lo que ve el cliente y el cajero.
//
// Misma regla en los tres lugares que muestran el desglose: el ticket impreso
// (electron/receipts.ts), el carrito (components/pos/Cart.tsx) y el detalle
// de venta (components/pos/SaleDetailModal.tsx). Puro: sin React ni Electron
// (lo comparten el renderer y el main).
//
// Sea T = Σ renglones tal como se imprimen (precio × cantidad − descuento
// manual de línea), D = descuento global CON impuesto que guarda la cabecera,
// subtotal = base sin impuesto YA con descuento, tax = impuesto YA con
// descuento y total = T − D:
//   1. SIN descuento global (D = 0): EXACTAMENTE como siempre (Subtotal base,
//      IVA, TOTAL). Ningún ticket sin cupón cambia ni un carácter.
//   2. CON descuento y precios CON impuesto incluido (MX, FN, GT):
//        Subtotal      T (= total + D)
//        Cupón ABC123  −D   ("Descuento" si es manual)
//        TOTAL         total
//        IVA incluido  tax  (informativa, debajo del TOTAL; también en 0.00,
//                            igual que la reimpresión del admin)
//   3. CON descuento y precios SIN impuesto incluido (US, sales tax añadido):
//        Subtotal      Σ renglones sin impuesto (T_pre)
//        Descuento     −(T_pre − subtotal)  (la parte del descuento en el
//                                            espacio del precio: 10.00 en el
//                                            ejemplo US, no los 10.83 con impuesto)
//        Tax           tax
//        TOTAL         total
//      Así las líneas suman: 100.00 − 10.00 + 7.42 = 97.42.
//   La fila del impuesto ('tax') se devuelve SIEMPRE, también en 0.00: las
//   pantallas (carrito y detalle) siempre mostraron "Impuestos 0.00" y es el
//   ticket impreso quien omite IVA/Tax en 0, como siempre lo hizo
//   (electron/receipts.ts).
//   Cómo saber si el impuesto va incluido: cada renglón trae `taxIncluded`
//   (en caja, QuickProduct.isIncludedInPrice; en la reimpresión se deduce del
//   renglón guardado, ver savedSaleItemTaxIncluded). Solo opinan los
//   renglones CON impuesto (`taxRate` > 0): un producto MX sin regla en
//   product_taxes llega con taxIncludedInPrice indefinido y el store lo
//   guarda como `false` (pos-cart.store addItem), y sin impuesto da igual si
//   va incluido o añadido. Sin señal fiable se trata como incluido cuando
//   |Σ renglones − (total + D)| < 0.01.
//
// Ejemplos (pruebas en receiptTotals.test.ts):
//   - MX 8616 a 332.00 (IVA 16 % incluido), cupón 30 %:
//     Subtotal 332.00 / Cupón −99.60 / TOTAL 232.40 / IVA incluido 32.06.
//   - MX mixto 391.00 (IVA 0 %) + 332.00 (IVA 16 %), cupón 10 %:
//     Subtotal 723.00 / Cupón −72.30 / TOTAL 650.70 / IVA incluido 41.21.
//   - US 100.00 sin impuesto, sales tax 8.25 %, cupón 10 %:
//     Subtotal 100.00 / Descuento −10.00 / Tax 7.42 / TOTAL 97.42.
//   - MX sin cupón, 332.00: Subtotal 286.21 / IVA 45.79 / TOTAL 332.00.

import { roundHalfUp2 } from './saleDiscount';

export type ReceiptTotalsKind =
  | 'subtotal'
  | 'discount'
  | 'tax'
  | 'total'
  | 'taxIncluded';

export interface ReceiptTotalsRow {
  kind: ReceiptTotalsKind;
  /** Etiqueta del ticket impreso ("Subtotal", "Cupón X", "IVA", "Tax",
   *  "TOTAL", "IVA incluido"). El carrito y el detalle ponen las suyas por
   *  `kind`. */
  label: string;
  /** Importe con signo: la fila del descuento va NEGATIVA. */
  amount: number;
  /** Solo en la fila del descuento de un cupón: el código (para resaltarlo). */
  code?: string;
}

export interface ReceiptTotalsItem {
  quantity: number;
  unitPrice: number;
  /** Descuento MANUAL de línea en el espacio del precio (sin UI desde
   *  ago-2026). NUNCA la parte del descuento global prorrateada: esa ya va en
   *  `discountAmount` de la cabecera. */
  lineDiscount?: number;
  /** Regalo a $0 (campaña de membresía): no cuenta. */
  gift?: boolean;
  /** true = el precio incluye el impuesto (MX); false = se añade (US);
   *  undefined = sin señal (se deduce del cuadre). */
  taxIncluded?: boolean;
  /** Tasa del renglón (decimal 0.16 o porcentaje 16; solo importa si es > 0).
   *  Un renglón SIN impuesto no opina sobre `taxIncluded`: su señal no es
   *  fiable (producto MX sin regla fiscal → isIncludedInPrice false) y sin
   *  impuesto da igual. Sin dato (snapshots viejos de la cola local) se
   *  respeta `taxIncluded` tal cual. */
  taxRate?: number;
}

export interface ReceiptTotalsInput {
  items: readonly ReceiptTotalsItem[];
  /** Base sin impuesto YA con el descuento prorrateado. */
  subtotal: number;
  /** Descuento global (cupón o manual) CON impuesto: lo que ve el cliente. */
  discountAmount: number;
  /** Impuesto YA con el descuento prorrateado; subtotal + taxAmount = total. */
  taxAmount: number;
  total: number;
  /** Código del cupón: la fila dice "Cupón X". Sin él, "Descuento". */
  couponCode?: string;
}

const money = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : Number(n) || 0;

/** Importe del renglón en el espacio del precio: precio × cantidad − descuento
 *  manual de línea, nunca negativo; los regalos no cuentan. */
function itemAmount(it: ReceiptTotalsItem): number {
  if (it.gift) return 0;
  const amount = money(it.unitPrice) * money(it.quantity);
  return Math.max(0, roundHalfUp2(amount - Math.max(0, money(it.lineDiscount))));
}

/**
 * ¿Los precios de la venta incluyen el impuesto? Basta un renglón con importe
 * Y con impuesto que diga que NO (impuesto añadido) para presentar la variante
 * US; si todos los que opinan dicen que sí, incluido; sin señal, por cuadre:
 * incluido cuando Σ renglones (espacio del precio) = total + D al centavo.
 * Los renglones sin impuesto (taxRate 0) no opinan: en MX un producto sin
 * regla fiscal llega como "no incluido" y mandaba TODO el ticket a la variante
 * US (391 al 0 % + 332 al 16 % con cupón imprimía "Descuento −113.51 / Tax"
 * en vez de "Cupón −72.30 / IVA incluido 41.21").
 */
function receiptTaxIncluded(
  items: readonly ReceiptTotalsItem[],
  priceSum: number,
  total: number,
  discount: number,
): boolean {
  let sawIncluded = false;
  for (const it of items) {
    if (itemAmount(it) <= 0) continue;
    if (it.taxRate != null && !(money(it.taxRate) > 0)) continue;
    if (it.taxIncluded === false) return false;
    if (it.taxIncluded === true) sawIncluded = true;
  }
  if (sawIncluded) return true;
  return Math.abs(priceSum - roundHalfUp2(total + discount)) < 0.01;
}

/**
 * Filas del bloque de totales, en el orden en que se imprimen. Con D ≤ 0 el
 * bloque es el de siempre (Subtotal, IVA, TOTAL). La fila del impuesto va
 * también en 0.00 (las pantallas siempre la mostraron); el ticket impreso la
 * omite en 0, como siempre (electron/receipts.ts).
 */
export function buildReceiptTotalsRows(
  input: ReceiptTotalsInput,
): ReceiptTotalsRow[] {
  const subtotal = roundHalfUp2(money(input.subtotal));
  const discount = roundHalfUp2(money(input.discountAmount));
  const tax = roundHalfUp2(money(input.taxAmount));
  const total = roundHalfUp2(money(input.total));

  if (!(discount > 0)) {
    return [
      { kind: 'subtotal', label: 'Subtotal', amount: subtotal },
      { kind: 'tax', label: 'IVA', amount: tax },
      { kind: 'total', label: 'TOTAL', amount: total },
    ];
  }

  const priceSum = roundHalfUp2(
    input.items.reduce((acc, it) => acc + itemAmount(it), 0),
  );
  const code = input.couponCode?.trim() || undefined;

  if (receiptTaxIncluded(input.items, priceSum, total, discount)) {
    // Precio con impuesto incluido: Subtotal bruto = total + D (cuadra con
    // el TOTAL al centavo por construcción), Cupón/Descuento −D, TOTAL y el
    // impuesto neto como línea informativa.
    const rows: ReceiptTotalsRow[] = [
      {
        kind: 'subtotal',
        label: 'Subtotal',
        amount: roundHalfUp2(total + discount),
      },
      code
        ? { kind: 'discount', label: `Cupón ${code}`, amount: -discount, code }
        : { kind: 'discount', label: 'Descuento', amount: -discount },
      { kind: 'total', label: 'TOTAL', amount: total },
      // Informativa, también en 0.00 (misma fila que imprime el admin).
      { kind: 'taxIncluded', label: 'IVA incluido', amount: tax },
    ];
    return rows;
  }

  // Impuesto añadido (US): Subtotal sin impuesto, el descuento en el espacio
  // del precio (T_pre − base neta), Tax y TOTAL; las líneas suman.
  const priceDiscount = Math.max(0, roundHalfUp2(priceSum - subtotal));
  return [
    { kind: 'subtotal', label: 'Subtotal', amount: priceSum },
    { kind: 'discount', label: 'Descuento', amount: -priceDiscount },
    { kind: 'tax', label: 'Tax', amount: tax },
    { kind: 'total', label: 'TOTAL', amount: total },
  ];
}

/**
 * Etiqueta de una fila de totales para el ticket impreso, de modo que quepa
 * junto al importe en `cols` columnas (32 en 58 mm, 48 en 80 mm). escpos
 * labelValue recorta por la derecha —¡el importe!— cuando etiqueta + importe
 * no caben, y "Cupón <código>" con un código largo (coupons.code admite 40
 * caracteres) dejaba "-$99.6" en 58 mm a partir de 18 caracteres de código
 * (34 en 80 mm). Decisión del 29-oct: "Cupón" + código SI CABE; si no, solo
 * "Cupón". Cualquier otra etiqueta se recorta para que el importe salga
 * completo.
 */
export function receiptTotalsLabel(
  row: Pick<ReceiptTotalsRow, 'label' | 'code'>,
  value: string,
  cols: number,
): string {
  const max = Math.max(0, cols - value.length - 1);
  if (row.label.length <= max) return row.label;
  if (row.code) return 'Cupón'.slice(0, max);
  return row.label.slice(0, max);
}

// ---------------------------------------------------------------------------
// Reimpresión desde la venta guardada (SaleDto.items[])
// ---------------------------------------------------------------------------

/** Renglón de la venta como lo devuelve el API (GET /pos/sales/:id). */
export interface SavedSaleItemAmounts {
  quantity: number;
  unitPrice: number;
  /** Descuento de línea manual MÁS la parte del descuento global (regla
   *  29-oct-2026): ya no se puede separar. */
  discountAmount?: number;
  /** pos_sale_items.tax_rate: en porcentaje (16, 8.25); cargas antiguas
   *  pueden traerlo como decimal (0.16). */
  taxRate?: number;
  /** Base sin impuesto del renglón (ya con descuento). */
  subtotal: number;
  /** Lo cobrado por el renglón, con impuesto (ya con descuento). */
  total: number;
}

/** Tasa del renglón guardado como decimal. */
export function savedSaleItemRate(taxRate: number | undefined): number {
  const rate = money(taxRate);
  if (!(rate > 0)) return 0;
  return rate > 1 ? rate / 100 : rate;
}

/**
 * ¿El precio del renglón guardado incluye el impuesto? Se deduce de las
 * identidades que guarda el API: precio × cantidad − descuento = total (precio
 * con impuesto incluido, MX) o = base (impuesto añadido, US). Vale también
 * para ventas anteriores a la regla (descuento de línea 0). Sin impuesto en
 * el renglón no hay señal: undefined.
 */
export function savedSaleItemTaxIncluded(
  it: SavedSaleItemAmounts,
): boolean | undefined {
  if (!(savedSaleItemRate(it.taxRate) > 0)) return undefined;
  const net =
    money(it.unitPrice) * money(it.quantity) -
    Math.max(0, money(it.discountAmount));
  const toTotal = Math.abs(net - money(it.total));
  const toBase = Math.abs(net - money(it.subtotal));
  if (Math.abs(toTotal - toBase) < 0.005) return undefined;
  return toTotal < toBase;
}

/**
 * Importe BRUTO del renglón para reimprimir una venta CON descuento global:
 * precio × cantidad (con impuesto incluido) o × (1 + tasa) cuando el impuesto
 * se añade, igual que la línea del carrito en el ticket original de caja. El
 * `total` guardado ya trae descontada su parte del cupón (232.40 en vez de
 * 332.00) y el bloque de totales es quien explica el descuento. El descuento
 * de línea manual (sin UI desde ago-2026) no se puede separar de la parte del
 * global, así que no se resta.
 */
export function savedSaleItemGross(
  it: SavedSaleItemAmounts,
  taxIncluded: boolean | undefined,
): number {
  const amount = money(it.unitPrice) * money(it.quantity);
  if (taxIncluded === false) {
    return amount + amount * savedSaleItemRate(it.taxRate);
  }
  return amount;
}
