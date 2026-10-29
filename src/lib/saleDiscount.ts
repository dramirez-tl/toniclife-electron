// saleDiscount.ts - Descuento global (cupón o manual) SOBRE EL PRECIO CON
// IMPUESTO y prorrateo del desglose (decisión de negocio del 29-oct-2026).
//
// ESPEJO 1:1 de la lib del API `toniclife-api/src/modules/pos/lib/
// sale-discount.lib.ts` (+ `money.lib.ts`): misma regla, mismas funciones,
// mismo redondeo. El API valida el pago contra SU total al centavo, así que
// cualquier cambio en la lib del API se replica aquí EN LA MISMA VERSIÓN del
// POS (y viceversa). Las pruebas (stores/pos-cart.store.test.ts) portan los
// casos del spec del API.
//
// Regla única (cupón porcentual, cupón de monto fijo y descuento manual; MX y US):
//   1. Base del descuento = TOTAL CON IMPUESTOS (T) = round2(Σ bruto_i), donde
//      bruto_i es lo cobrado por el renglón DESPUÉS de su descuento de línea y
//      CON impuesto, SIN redondear por renglón:
//        - precio con impuesto incluido (MX): bruto_i = precio × cantidad − desc_línea
//        - precio sin impuesto (US, sales tax añadido):
//          bruto_i = (precio × cantidad − desc_línea) × (1 + tasa_i)
//      T es EXACTAMENTE el total que el POS cobraba antes de esta regla
//      (round2(subtotal + impuestos) con las sumas sin redondear): una venta
//      SIN descuento cobra lo mismo que siempre (2 × $10 al 8.25 % = 21.65, no
//      21.66). Por renglón, bruto_i se lleva a centavos y el residuo
//      T − Σ round2(bruto_i) (solo aparece con impuesto añadido) se carga al
//      ÚLTIMO renglón con importe, para que Σ renglones = T.
//   2. Porcentaje: D = round2(T × p / 100) (con tope). Monto fijo: D = min(monto, T).
//      Siempre 0 ≤ D ≤ T.
//   3. D se reparte entre los renglones en proporción a bruto_i (a centavos),
//      con el residuo de centavos en el ÚLTIMO renglón con importe (mismo
//      criterio que `prorate(..., 'last')` del CFDI). total_i = bruto_i − parte_i;
//      base_i = round2(neto exacto_i / (1 + tasa_i)), con neto exacto_i = bruto
//      exacto_i − parte_i (así, sin descuento global, base_i = precio ×
//      cantidad − desc_línea exacto también en US, y el residuo de T se queda
//      en el impuesto); impuesto_i = total_i − base_i.
//   4. Cabecera: subtotal = Σ base_i; impuesto = total − subtotal (= Σ impuesto_i);
//      descuento = D; total = T − D. subtotal + impuesto = total al centavo.
//      NOTA: subtotal = Σ base_i a centavos: en tickets multilínea la cabecera
//      base/IVA puede moverse 1 ¢ respecto a round2(Σ bases sin redondear)
//      (dos renglones de $332: 572.42 / 91.58 en vez de 572.41 / 91.59; el
//      total 664 no cambia). Un renglón con cantidad 2 es UN renglón (664 →
//      572.41 / 91.59): el API recibe la misma estructura de renglones.
//   5. Puntos y valor de negocio no dependen de esto (producto × cantidad).
//
// `discountAmount` de cada renglón del resultado es lo que el API guarda en
// pos_sale_items.discount_amount (descuento de línea manual MÁS la parte del
// global, en el espacio del precio del renglón): precio × cantidad −
// discount_amount = total_i (precio con impuesto) o = base_i (impuesto añadido).
//
// Puro: sin React, sin Electron, sin red.

/**
 * Redondeo a 2 decimales, mitad hacia arriba (en magnitud). MISMA función que
 * el API (pos/lib/money.lib.ts roundHalfUp2). El float de JS guarda 7.175 como
 * 7.17499999999999982…, así que Math.round(x * 100) y toFixed(2) lo bajan a
 * 7.17 (Santa Fe Springs, 13-oct-2026: $70.00 × 10.25 % = $7.175 → el legacy
 * cobra $7.18). Antes de redondear se "aplana" el ruido binario a 6 decimales,
 * muchísimo menor que medio centavo, y el .5 real sube.
 */
export function roundHalfUp2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const cents = Math.round(Number((Math.abs(n) * 100).toFixed(6)));
  return (sign * cents) / 100;
}

export interface SaleDiscountLine {
  /** precio × cantidad, en el espacio del precio del renglón. */
  amount: number;
  /**
   * Descuento de línea manual, en el mismo espacio y a centavos. Mayor que
   * `amount` deja el renglón en $0 (nunca negativo). Default 0.
   */
  lineDiscount?: number;
  /** Tasa del renglón como decimal (0.16, 0.0825, 0). */
  rate: number;
  /** true = el precio ya incluye el impuesto (MX); false = se añade (US). */
  taxIncluded: boolean;
}

export interface SaleDiscountLineResult {
  /**
   * bruto_i a centavos: lo cobrado por el renglón CON impuesto antes del
   * descuento global (el último renglón con importe absorbe el residuo de T).
   */
  gross: number;
  /** parte_i del descuento global que le toca (CON impuesto). */
  share: number;
  /** total_i = bruto_i − parte_i: lo realmente cobrado por el renglón. */
  net: number;
  /** base_i = round2(neto exacto_i / (1 + tasa_i)). */
  base: number;
  /** impuesto_i = total_i − base_i (absorbe el residuo de redondeo). */
  tax: number;
  /** total_i = net (= base_i + impuesto_i al centavo). */
  total: number;
  /**
   * Lo que el API guarda en pos_sale_items.discount_amount: descuento de
   * línea manual + parte del global, en el espacio del precio del renglón, de
   * modo que precio × cantidad − discount_amount = total_i (precio con
   * impuesto) o = base_i (impuesto añadido), al centavo. Nunca negativo.
   */
  discountAmount: number;
}

export interface SaleDiscountResult {
  /** T: round2(Σ bruto_i exacto) = total con impuesto antes del descuento global. */
  grossTotal: number;
  /** D ya acotado a [0, T]. */
  discount: number;
  /** Σ base_i. */
  subtotal: number;
  /** total − subtotal (= Σ impuesto_i; absorbe el residuo). */
  tax: number;
  /** T − D (= Σ total_i). */
  total: number;
  lines: SaleDiscountLineResult[];
}

const finite = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : 0;

/** Suma a centavos (mitad hacia arriba) sin arrastrar ruido binario. */
export function sumCents(values: readonly number[]): number {
  return roundHalfUp2(values.reduce((acc, v) => acc + finite(v), 0));
}

/**
 * Importe del renglón después de su descuento de línea manual, en el espacio
 * del precio y a centavos (precio × cantidad − desc_línea, nunca negativo).
 */
export function lineAmountAfterDiscount(line: SaleDiscountLine): number {
  const amount = roundHalfUp2(Math.max(0, finite(line.amount)));
  const discount = roundHalfUp2(Math.max(0, finite(line.lineDiscount)));
  return Math.max(0, roundHalfUp2(amount - discount));
}

/**
 * bruto_i EXACTO (sin redondear): lo cobrado por el renglón CON impuesto
 * después de su descuento de línea. Con precio con impuesto incluido ya está a
 * centavos; con impuesto añadido trae la fracción de centavo de × (1 + tasa).
 */
export function lineGrossWithTax(line: SaleDiscountLine): number {
  const amount = lineAmountAfterDiscount(line);
  const rate = Math.max(0, finite(line.rate));
  return line.taxIncluded ? amount : amount * (1 + rate);
}

/**
 * T = round2(Σ bruto_i exacto): el total con impuesto de la venta antes del
 * descuento global. Misma fórmula que el cobro histórico del POS
 * (round2(subtotal + impuestos) con sumas sin redondear): es la base del
 * cupón que se manda a validar y el total que el API valida al cobrar.
 */
export function saleGrossTotal(lines: readonly SaleDiscountLine[]): number {
  return roundHalfUp2(
    lines.reduce((acc, line) => acc + lineGrossWithTax(line), 0),
  );
}

/**
 * bruto_i a centavos con Σ = T exacto: cada renglón se redondea y el residuo
 * T − Σ round2(bruto_i) (−n/2..+n/2 centavos; solo existe con impuesto
 * añadido) se carga al ÚLTIMO renglón con importe que lo soporte.
 */
export function lineGrossCents(lines: readonly SaleDiscountLine[]): {
  grossTotal: number;
  gross: number[];
} {
  const exact = lines.map(lineGrossWithTax);
  const grossTotal = roundHalfUp2(exact.reduce((acc, v) => acc + v, 0));
  const gross = exact.map(roundHalfUp2);
  const residue = roundHalfUp2(grossTotal - sumCents(gross));
  if (residue !== 0) {
    let idx = -1;
    for (let i = gross.length - 1; i >= 0; i--) {
      if (gross[i] > 0 && gross[i] + residue >= 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      for (let i = gross.length - 1; i >= 0; i--) {
        if (exact[i] > 0) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= 0) gross[idx] = Math.max(0, roundHalfUp2(gross[idx] + residue));
  }
  return { grossTotal, gross };
}

/**
 * Descuento porcentual sobre T: round2(T × p / 100), con tope opcional
 * (`max_discount_amount` del cupón) y nunca mayor que T.
 */
export function percentDiscount(
  grossTotal: number,
  percent: number,
  cap?: number | null,
): number {
  const total = Math.max(0, finite(grossTotal));
  const pct = Math.max(0, finite(percent));
  let discount = roundHalfUp2((total * pct) / 100);
  const limit = finite(cap);
  if (limit > 0) discount = Math.min(discount, roundHalfUp2(limit));
  return Math.min(discount, total);
}

/** Descuento de monto fijo: min(monto, T), nunca negativo. */
export function fixedDiscount(grossTotal: number, amount: number): number {
  const total = Math.max(0, finite(grossTotal));
  return Math.min(Math.max(0, roundHalfUp2(finite(amount))), total);
}

/**
 * Reparte `total` (a centavos) en proporción a `weights`; el residuo de
 * redondeo va a la ÚLTIMA posición con peso > 0 para que la suma sea EXACTA.
 * Pesos ≤ 0 reciben 0. Sin pesos positivos (o total 0) => todo ceros. Es el
 * mismo criterio que `prorate(total, weights, 'last')` del CFDI del API
 * (billing/cfdi/cfdi-amounts.lib.ts).
 */
export function prorateDiscount(
  total: number,
  weights: readonly number[],
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const target = roundHalfUp2(Math.max(0, finite(total)));
  const positive = weights.map((w) => Math.max(0, finite(w)));
  const sumWeights = positive.reduce((acc, w) => acc + w, 0);
  if (!(sumWeights > 0) || target === 0) return positive.map(() => 0);

  const shares = positive.map((w) =>
    w > 0 ? roundHalfUp2((target * w) / sumWeights) : 0,
  );
  const residue = roundHalfUp2(target - sumCents(shares));
  if (residue !== 0) {
    for (let i = n - 1; i >= 0; i--) {
      if (positive[i] > 0) {
        shares[i] = roundHalfUp2(shares[i] + residue);
        break;
      }
    }
  }
  return shares;
}

/**
 * Aplica el descuento global D (cupón o manual, CON impuesto) a los renglones
 * y devuelve el desglose completo: por renglón y de cabecera. D se acota a
 * [0, T]. Renglones en $0 no reciben parte y quedan en ceros.
 */
export function applyGlobalDiscount(
  lines: readonly SaleDiscountLine[],
  discount: number,
): SaleDiscountResult {
  const { grossTotal, gross } = lineGrossCents(lines);
  const applied = Math.min(
    Math.max(0, roundHalfUp2(finite(discount))),
    grossTotal,
  );
  const shares = prorateDiscount(applied, gross);

  const results: SaleDiscountLineResult[] = lines.map((line, i) => {
    const rate = Math.max(0, finite(line.rate));
    const amount = roundHalfUp2(Math.max(0, finite(line.amount)));
    const share = shares[i];
    const net = Math.max(0, roundHalfUp2(gross[i] - share));
    // base del neto EXACTO (bruto sin redondear − parte): el residuo de
    // redondeo de T se queda en el impuesto, nunca en la base. Sin descuento
    // global y con impuesto añadido, base_i = precio × cantidad − desc_línea.
    const netExact = Math.max(0, lineGrossWithTax(line) - share);
    let base = roundHalfUp2(netExact / (1 + rate));
    if (base > net) base = net;
    const tax = roundHalfUp2(net - base);
    const discountAmount = Math.max(
      0,
      roundHalfUp2(amount - (line.taxIncluded ? net : base)),
    );
    return {
      gross: gross[i],
      share,
      net,
      base,
      tax,
      total: net,
      discountAmount,
    };
  });

  const total = roundHalfUp2(grossTotal - applied);
  const subtotal = sumCents(results.map((r) => r.base));
  // El impuesto se deriva de total − subtotal ya redondeados: subtotal + tax
  // == total al centavo aunque la suma de impuestos arrastre un residuo.
  const tax = roundHalfUp2(total - subtotal);

  return {
    grossTotal,
    discount: applied,
    subtotal,
    tax,
    total,
    lines: results,
  };
}
