// invoiceEmail.ts - Helpers del envío de la factura CFDI por correo.
//
// El API manda la factura al correo fiscal/de contacto del cliente justo al
// timbrar (si lo tiene) y expone el resultado en SaleDto.invoice
// (emailedAt/emailedTo/emailCount). Aquí se centralizan los textos para que
// los tres caminos de timbrado (cobro, reintento y "Facturar" desde ventas)
// avisen igual al cajero.

import { toast } from 'sonner';
import { posApi } from '@/lib/posApi';
import type { Sale } from '@/types/pos';

/** Estado del PAC/SAT de la factura en palabras del cajero. */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  stamping: 'Timbrando',
  stamped: 'Timbrada',
  sent: 'Timbrada',
  error: 'Error al timbrar',
  cancel_pending: 'Cancelación en proceso',
  cancelled: 'Cancelada',
};

/** Primer destinatario de `emailedTo` (el API guarda varios separados por
 *  coma); '' si nunca se envió. */
export function firstRecipient(emailedTo: string | null | undefined): string {
  return (emailedTo ?? '')
    .split(',')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
}

/** Validación mínima de un correo capturado a mano (el API vuelve a validar). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Aviso tras timbrar: éxito + a quién se envió, o éxito + advertencia de que
 * no salió el correo (cliente sin correo) con la pista de dónde reenviarla.
 *
 * La respuesta de POST /pos/sales/:id/stamp trae la factura tal como quedó
 * ANTES de mandar el correo (emailedAt siempre null), así que no sirve para
 * saber si salió: se vuelve a leer la venta y sólo se advierte cuando esa
 * lectura fresca trae la factura sin ningún envío. Si la lectura falla o el
 * API no adjunta `invoice` en el detalle, se avisa sólo el timbrado (nunca
 * una advertencia falsa que haga reenviar duplicados). Nunca lanza.
 */
export async function notifyInvoiceStamped(
  saleId: string,
  saleNumber: string,
  stamped?: Sale,
): Promise<void> {
  let fresh: Sale | undefined;
  try {
    fresh = await posApi.getSaleById(saleId);
  } catch {
    fresh = undefined;
  }
  const inv = fresh?.invoice ?? stamped?.invoice;
  if (inv?.emailedAt) {
    toast.success(
      `Factura de la venta ${saleNumber} timbrada y enviada a ${inv.emailedTo ?? 'el correo del cliente'}`,
      { duration: 8_000 },
    );
    return;
  }
  toast.success(`Factura de la venta ${saleNumber} timbrada`);
  const freshInv = fresh?.invoice;
  if (freshInv && !freshInv.emailedAt && (freshInv.emailCount ?? 0) === 0) {
    toast.warning(
      'No se envió por correo: el cliente no tiene correo; envíala desde el detalle de la venta',
      { duration: 10_000 },
    );
  }
}
