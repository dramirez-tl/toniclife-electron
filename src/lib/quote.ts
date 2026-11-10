// quote.ts - COTIZACIÓN desde el carrito (10-nov-2026, pedido de Call Center).
//
// Las cotizaciones se mandan por correo: armaban el carrito, le tomaban
// captura y la recortaban, pero el carrito corta los nombres y solo muestra
// lo que cabe. Aquí el carrito se convierte en una hoja COMPLETA (todos los
// productos con clave, nombre entero, cantidad, precio e importe; promociones,
// regalos, totales y puntos) que el proceso principal pinta como imagen para
// pegarla en el correo o como PDF (electron/quote.ts).
//
// No guarda nada ni aparta existencias: es una foto del carrito. Puro (sin
// React ni Electron). Aquí se ARMAN LOS DATOS desde el carrito (renderer); la
// hoja en HTML vive en lib/quoteHtml.ts, que es lo único que importa el main.

import type { PosCart } from '@/types/pos';
import { eventLine } from './eventInfo';
import { formatIncludes, isKitLikeType } from './kitComponents';
import { buildReceiptTotalsRows } from './receiptTotals';
import type { QuoteItem, QuotePayload } from './quoteHtml';
import { seasonalLineLabel } from './seasonalReceipt';

export interface QuoteContext {
  createdAt: string;
  timezone?: string;
  branchName: string;
  attendedBy?: string;
  currencySymbol: string;
  currencyCode: string;
}

const money = (n: number, symbol: string) =>
  `${symbol}${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El carrito tal como se cobraría, listo para pintarse como cotización. */
export function buildQuotePayload(cart: PosCart, ctx: QuoteContext): QuotePayload {
  const fmt = (n: number) => money(n, ctx.currencySymbol);
  const items: QuoteItem[] = cart.items.map((it) => {
    const notes: string[] = [];
    if (isKitLikeType(it.productType) && it.components && it.components.length > 0) {
      notes.push(formatIncludes(it.components).full);
    }
    if (it.promo) {
      notes.push(
        `${it.promo.name}: ${seasonalLineLabel(it.promo, fmt)}${it.promo.kitBonusExcluded ? ' · sin bono de inscripción' : ''}`,
      );
    }
    if (it.event) {
      notes.push(`${eventLine(it.event)} · ${it.quantity * it.event.ticketsPerUnit} boleto(s)`);
    }
    return {
      sku: it.productSku,
      name: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.total,
      notes,
    };
  });
  const totals = buildReceiptTotalsRows({
    items: cart.items.map((it) => ({
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineDiscount: it.discountAmount,
      taxIncluded: it.isIncludedInPrice,
      taxRate: it.taxRate,
    })),
    subtotal: cart.subtotal,
    discountAmount: (cart.couponCode ? cart.couponDiscount : cart.discountAmount) ?? 0,
    taxAmount: cart.taxAmount,
    total: cart.total,
    couponCode: cart.couponCode,
  });
  return {
    createdAt: ctx.createdAt,
    timezone: ctx.timezone,
    branchName: ctx.branchName,
    attendedBy: ctx.attendedBy?.trim() || undefined,
    customerName: cart.customerId ? cart.customerName?.trim() || undefined : undefined,
    customerNumber: cart.customerId ? cart.customerNumber?.trim() || undefined : undefined,
    currencySymbol: ctx.currencySymbol,
    currencyCode: ctx.currencyCode,
    items,
    gifts: (cart.seasonalGifts ?? []).map((g) => ({
      sku: g.sku,
      name: g.name,
      quantity: g.quantity,
      promoName: g.promoName,
    })),
    totals,
    seasonalDiscount: cart.seasonalDiscount ?? 0,
    totalPoints: cart.customerId ? cart.totalPoints : 0,
    couponDescription: cart.couponCode ? cart.couponDescription?.trim() || undefined : undefined,
  };
}
