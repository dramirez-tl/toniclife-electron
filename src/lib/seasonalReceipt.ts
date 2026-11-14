// seasonalReceipt.ts - Promociones de temporada (mig 186) en el ticket: la
// etiqueta bajo el renglón ("3x2: 1 pieza gratis"), las piezas gratis y los
// regalos como renglones "Regalo" cuando el ticket se arma desde el carrito
// (sin conexión) y el bloque PROMOCIONES DE TEMPORADA. Puro.

import type { PosCart, PosCartItem, SaleSeasonalPromotion } from '@/types/pos';
import type { SaleReceiptPayload, SaleReceiptSeasonalPromotion } from '@/types';
import type { SeasonalEngineApplied } from './seasonalPromotions';
import { seasonalPromoTypeLabel } from './seasonalPromotions';

/** Texto bajo el renglón del ticket y del carrito. */
export function seasonalLineLabel(
  promo: NonNullable<PosCartItem['promo']>,
  fmt: (n: number) => string,
): string {
  // Sabores que se combinan: "6x5 · 24 Shake" explica por qué dos productos
  // distintos van en la misma promoción (y cuál de ellos lleva la gratis).
  const label = promo.groupName
    ? `${promo.typeLabel} · ${promo.groupName}`
    : promo.typeLabel;
  if (promo.freeQuantity > 0) {
    return `${label}: ${promo.freeQuantity} ${promo.freeQuantity === 1 ? 'pieza gratis' : 'piezas gratis'}`;
  }
  if (promo.discountAmount > 0) {
    return `${label}: -${fmt(promo.discountAmount)}`;
  }
  return label;
}

/**
 * Renglones "Regalo" que el servidor crearía para esta venta, armados desde
 * el carrito (piezas gratis del 3x2 + regalos por compra). Solo para el
 * ticket sin conexión; con conexión se toman de la venta cobrada.
 */
export function localSeasonalGiftLines(
  cart: Pick<PosCart, 'items' | 'seasonalGifts'>,
): SaleReceiptPayload['items'] {
  const rows: SaleReceiptPayload['items'] = [];
  for (const it of cart.items) {
    const free = it.promo?.freeQuantity ?? 0;
    if (free > 0) {
      rows.push({
        name: it.productName,
        sku: it.productSku,
        quantity: free,
        unitPrice: 0,
        total: 0,
        gift: true,
        promoLabel: it.promo ? `Regalo ${it.promo.typeLabel}` : undefined,
      });
    }
  }
  for (const g of cart.seasonalGifts ?? []) {
    rows.push({
      name: g.name,
      sku: g.sku,
      quantity: g.quantity,
      unitPrice: 0,
      total: 0,
      gift: true,
      promoLabel: `Regalo ${g.promoCode}`,
    });
  }
  return rows;
}

/**
 * "Puntos de la compra" del ticket: los que reportó el servidor al cobrar
 * (también 0) y, si no viajaron (sin conexión, API anterior o reintento del
 * cobro), los del carrito YA con las promociones de temporada aplicadas
 * (`cart.totalPoints`): una línea "sin puntos" y la pieza gratis de un 3x2 no
 * suman. Sin cliente no hay puntos que imprimir.
 *
 * 13-nov-2026 (Buen Fin): el respaldo sumaba los puntos de LISTA del carrito y
 * el kit Tonic Center Premium, que con la promoción no da puntos, imprimía
 * "Puntos de la compra 3300" aunque el sistema no acreditó nada.
 */
export function receiptSalePoints(
  serverPoints: number | null | undefined,
  cart: Pick<PosCart, 'customerId' | 'totalPoints'>,
): number | undefined {
  if (serverPoints != null) return serverPoints;
  return cart.customerId ? cart.totalPoints : undefined;
}

/** Bloque PROMOCIONES DE TEMPORADA: desde la venta cobrada o desde el carrito. */
export function toReceiptSeasonal(
  fromSale: ReadonlyArray<SaleSeasonalPromotion> | null | undefined,
  fromCart?: ReadonlyArray<SeasonalEngineApplied> | null,
): SaleReceiptSeasonalPromotion[] | undefined {
  if (fromSale && fromSale.length > 0) {
    return fromSale.map((p) => ({
      code: p.code,
      name: p.name,
      typeLabel: p.typeLabel,
      times: p.times,
      discountAmount: Number(p.discountAmount) || 0,
    }));
  }
  if (fromCart && fromCart.length > 0) {
    return fromCart.map((a) => ({
      code: a.code,
      name: a.name,
      typeLabel: seasonalPromoTypeLabel(a.type),
      times: a.times,
      discountAmount: a.discountAmount,
    }));
  }
  return undefined;
}
