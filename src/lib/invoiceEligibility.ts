// invoiceEligibility.ts - ¿Se puede facturar (CFDI nominativa) una venta ya
// cobrada DESDE EL POS? Espejo de las reglas del API para POST
// /pos/sales/:id/stamp con via:'pos'; aquí solo decide si se MUESTRA el botón
// "Facturar" (el API vuelve a validar todo y es quien manda). Fail-closed:
// ante cualquier duda, no elegible.
//
// Reglas (contrato oct-2026):
//   - venta completada, nativa (folio no M-), total > 0, con cliente;
//   - sin CFDI nominativa viva y NO incluida en una factura global viva;
//   - sucursal de México o Frontera (CFDI solo aplica en MX);
//   - facturación habilitada en esta terminal;
//   - el día LOCAL de la venta (zona de la sucursal) cae en el MES NATURAL en
//     curso: después se factura desde el admin (Contabilidad). Mes natural,
//     NUNCA el periodo 26→25 del MLM;
//   - sin cobro en dólares, cashback ni promoción (Contabilidad, 22-oct-2026):
//     basta UN cobro > 0 de esos métodos; el API responde
//     CFDI_PAYMENT_NOT_INVOICEABLE y la global también los deja fuera.

import { localDateOf } from '@/lib/date';
import { PosSaleStatus, type Sale, type SalePayment } from '@/types/pos';

export type InvoiceIneligibleReason =
  | 'not_completed'
  | 'migrated'
  | 'zero_total'
  | 'no_customer'
  | 'already_invoiced'
  | 'in_global'
  | 'non_invoiceable_payment'
  | 'country'
  | 'invoicing_disabled'
  | 'out_of_month';

export type InvoiceEligibility =
  | { eligible: true }
  | { eligible: false; reason: InvoiceIneligibleReason };

export type InvoiceEligibilitySale = Pick<
  Sale,
  | 'status'
  | 'saleNumber'
  | 'total'
  | 'customerId'
  | 'invoiceId'
  | 'invoiceUuid'
  | 'globalInvoiceId'
  | 'createdAt'
  | 'paymentMethod'
> & {
  /** Cobros de la venta; la lista de ventas los trae, un detalle viejo puede no traerlos. */
  payments?: Array<Pick<SalePayment, 'paymentMethod' | 'amount'> & { status?: string }>;
};

/** Métodos de cobro del POS que NO se facturan (espejo de NON_INVOICEABLE_POS_METHODS del API). */
export const NON_INVOICEABLE_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  'usd_cash',
  'cash_usd',
  'cashback',
  'promotion',
]);

/** true si la venta se cobró (total o parcialmente) en dólares, cashback o promoción. */
export function hasNonInvoiceablePayment(
  sale: Pick<InvoiceEligibilitySale, 'paymentMethod' | 'payments'>,
): boolean {
  if (NON_INVOICEABLE_PAYMENT_METHODS.has(String(sale.paymentMethod ?? ''))) {
    return true;
  }
  return (sale.payments ?? []).some(
    (p) =>
      Number(p.amount) > 0 &&
      p.status !== 'cancelled' &&
      p.status !== 'refunded' &&
      NON_INVOICEABLE_PAYMENT_METHODS.has(String(p.paymentMethod ?? '')),
  );
}

export interface InvoiceEligibilityInput {
  sale: InvoiceEligibilitySale;
  /** ISO-2 del país de la sucursal (MX / FN facturan CFDI). */
  branchCountryCode?: string | null;
  /** Zona horaria de la sucursal (día local de la venta y "hoy"). */
  branchTz?: string;
  /** Interruptor "Facturación" de la terminal (heartbeat). */
  invoicingEnabled: boolean;
  /** Instante de referencia (pruebas); default = ahora. */
  now?: Date;
  /** "Hoy" local de la sucursal (YYYY-MM-DD) ya calculado. La lista de ventas
   *  lo computa UNA vez por render en lugar de una vez por fila; si se omite,
   *  se deriva de `now`/`branchTz`. */
  today?: string;
}

/** Países cuya sucursal emite CFDI: México y Frontera. */
export function isCfdiCountry(code?: string | null): boolean {
  const c = (code ?? '').trim().toUpperCase();
  return c === 'MX' || c === 'FN';
}

/** true si el instante cae en el mismo mes natural (YYYY-MM) que `now`, ambos
 *  en la zona horaria dada. */
export function isInCurrentCalendarMonth(
  when: string | Date,
  timeZone?: string,
  now: Date = new Date(),
): boolean {
  return sameCalendarMonth(localDateOf(when, timeZone), localDateOf(now, timeZone));
}

/** true si dos fechas YYYY-MM-DD caen en el mismo mes natural (YYYY-MM). */
function sameCalendarMonth(dayA: string, dayB: string): boolean {
  if (dayA.length < 7 || dayB.length < 7) return false;
  return dayA.slice(0, 7) === dayB.slice(0, 7);
}

export function invoiceEligibility(
  input: InvoiceEligibilityInput,
): InvoiceEligibility {
  const { sale } = input;
  if (sale.status !== PosSaleStatus.COMPLETED) {
    return { eligible: false, reason: 'not_completed' };
  }
  if ((sale.saleNumber ?? '').startsWith('M-')) {
    return { eligible: false, reason: 'migrated' };
  }
  if (!(Number(sale.total) > 0)) {
    return { eligible: false, reason: 'zero_total' };
  }
  if (!sale.customerId) {
    return { eligible: false, reason: 'no_customer' };
  }
  if (sale.invoiceUuid || sale.invoiceId) {
    return { eligible: false, reason: 'already_invoiced' };
  }
  if (sale.globalInvoiceId) {
    return { eligible: false, reason: 'in_global' };
  }
  if (hasNonInvoiceablePayment(sale)) {
    return { eligible: false, reason: 'non_invoiceable_payment' };
  }
  if (!isCfdiCountry(input.branchCountryCode)) {
    return { eligible: false, reason: 'country' };
  }
  if (!input.invoicingEnabled) {
    return { eligible: false, reason: 'invoicing_disabled' };
  }
  if (!sale.createdAt) {
    return { eligible: false, reason: 'out_of_month' };
  }
  const createdMs = new Date(sale.createdAt).getTime();
  if (!Number.isFinite(createdMs)) {
    return { eligible: false, reason: 'out_of_month' };
  }
  const today =
    input.today ?? localDateOf(input.now ?? new Date(), input.branchTz);
  if (!sameCalendarMonth(localDateOf(sale.createdAt, input.branchTz), today)) {
    return { eligible: false, reason: 'out_of_month' };
  }
  return { eligible: true };
}

/** Atajo booleano para mostrar/ocultar el botón "Facturar". */
export function canInvoiceSale(input: InvoiceEligibilityInput): boolean {
  return invoiceEligibility(input).eligible;
}

/** Texto para el cajero cuando la venta NO se puede facturar desde el POS. */
export const INVOICE_INELIGIBLE_LABELS: Record<InvoiceIneligibleReason, string> =
  {
    not_completed: 'Solo se facturan ventas cobradas.',
    migrated: 'Venta migrada del sistema anterior: se factura allá.',
    zero_total: 'Venta en $0: no hay ingreso que facturar.',
    no_customer: 'La venta no tiene cliente asignado.',
    already_invoiced: 'La venta ya tiene factura CFDI.',
    in_global:
      'La venta ya fue incluida en una factura global; no se puede facturar de forma nominativa.',
    non_invoiceable_payment:
      'La venta tiene cobro en dólares, cashback o promoción: Contabilidad lo registra aparte y no se factura.',
    country: 'La factura CFDI solo aplica en sucursales de México.',
    invoicing_disabled: 'La facturación está deshabilitada en esta terminal.',
    out_of_month:
      'Desde el POS solo se factura dentro del mes natural de la venta; después se factura desde el admin (Contabilidad).',
  };
