// invoiceEligibility.test.ts - Botón "Facturar" de una venta cobrada: el tope
// de días desde la venta (sale.posStampUntil, billing.pos_stamp_max_days,
// 4-nov-2026) se suma a la regla del mes natural; sin el campo (API anterior o
// ajuste vacío) nada cambia.

import { describe, expect, it } from 'vitest';
import {
  INVOICE_INELIGIBLE_LABELS,
  invoiceEligibility,
  type InvoiceEligibilitySale,
} from './invoiceEligibility';
import { PosPaymentMethod, PosSaleStatus } from '@/types/pos';

const TZ = 'America/Mexico_City';

const sale = (partial: Partial<InvoiceEligibilitySale> = {}): InvoiceEligibilitySale => ({
  status: PosSaleStatus.COMPLETED,
  saleNumber: '343-20261104-0001',
  total: 391,
  customerId: 'c1',
  invoiceId: undefined,
  invoiceUuid: undefined,
  globalInvoiceId: null,
  // 4-nov-2026 12:00 hora Centro
  createdAt: '2026-11-04T18:00:00.000Z',
  paymentMethod: PosPaymentMethod.CASH,
  payments: [{ paymentMethod: PosPaymentMethod.CASH, amount: 391, status: 'completed' }],
  ...partial,
});

const base = { branchCountryCode: 'MX', branchTz: TZ, invoicingEnabled: true };

describe('invoiceEligibility · tope de días desde la venta', () => {
  it('dentro del plazo (hasta el día posStampUntil inclusive) se puede facturar', () => {
    expect(
      invoiceEligibility({ ...base, sale: sale({ posStampUntil: '2026-11-06' }), today: '2026-11-06' }),
    ).toEqual({ eligible: true });
  });

  it('al día siguiente del plazo ya no, con su motivo', () => {
    const r = invoiceEligibility({ ...base, sale: sale({ posStampUntil: '2026-11-06' }), today: '2026-11-07' });
    expect(r).toEqual({ eligible: false, reason: 'stamp_window_closed' });
    expect(INVOICE_INELIGIBLE_LABELS.stamp_window_closed).toContain('Contabilidad');
  });

  it('sin el campo (API anterior) o en null (sin tope) manda solo el mes natural', () => {
    expect(invoiceEligibility({ ...base, sale: sale(), today: '2026-11-20' })).toEqual({ eligible: true });
    expect(
      invoiceEligibility({ ...base, sale: sale({ posStampUntil: null }), today: '2026-11-20' }),
    ).toEqual({ eligible: true });
    expect(invoiceEligibility({ ...base, sale: sale(), today: '2026-12-01' })).toEqual({
      eligible: false,
      reason: 'out_of_month',
    });
  });

  it('las reglas previas siguen antes que el plazo (ya facturada, en global)', () => {
    expect(
      invoiceEligibility({
        ...base,
        sale: sale({ invoiceUuid: 'uuid', posStampUntil: '2026-11-04' }),
        today: '2026-11-10',
      }),
    ).toEqual({ eligible: false, reason: 'already_invoiced' });
    expect(
      invoiceEligibility({
        ...base,
        sale: sale({ globalInvoiceId: 'g1', posStampUntil: '2026-11-04' }),
        today: '2026-11-10',
      }),
    ).toEqual({ eligible: false, reason: 'in_global' });
  });
});
