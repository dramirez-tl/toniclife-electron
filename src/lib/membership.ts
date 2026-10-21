// membership.ts — Campañas de membresía ("Compra N puntos en producto y tu
// membresía de inscripción es GRATIS") en el POS: qué puntos del ticket
// cuentan, qué oferta se persigue y los textos del ticket/detalle. Funciones
// puras, sin React ni API, para poder razonarlas (y probarlas) aparte.

import type {
  PosMembershipOffer,
  SaleMembership,
  SaleMembershipStatus,
} from '@/types/pos';
import type { SaleReceiptMembership, SaleReceiptPayload } from '@/types';

/** Tipos de producto cuyos puntos NO cuentan para la campaña (espejo del
 *  servidor): kits, promos canjeables y boletos de evento. */
const EXCLUDED_PRODUCT_TYPES = new Set(['kit', 'promotional', 'event']);

/** Lo mínimo de una línea del carrito (o de una venta) para contar puntos. */
export interface MembershipPointsLine {
  /** Puntos POR UNIDAD. */
  points: number;
  quantity: number;
  productType?: string | null;
  isEnrollmentKit?: boolean;
}

/**
 * Puntos EN PRODUCTO del ticket que cuentan para una campaña de membresía:
 * Σ (puntos por unidad × cantidad) de las líneas cuyo producto no sea kit,
 * promocional ni evento, ni kit de inscripción, y con puntos > 0. Misma regla
 * que el servidor al validar `membershipCampaignId`.
 */
export function membershipPoints(
  lines: readonly MembershipPointsLine[],
): number {
  let sum = 0;
  for (const line of lines) {
    if (line.isEnrollmentKit) continue;
    if (line.productType && EXCLUDED_PRODUCT_TYPES.has(line.productType)) {
      continue;
    }
    const pts = Number(line.points);
    const qty = Number(line.quantity);
    if (!(pts > 0) || !(qty > 0)) continue;
    sum += pts * qty;
  }
  return sum;
}

/**
 * Oferta objetivo del banner: la de MAYOR `minPoints` que el ticket ya
 * cumple; si no cumple ninguna, la de MENOR `minPoints` (la más cercana).
 * null sin ofertas.
 */
export function pickTargetOffer(
  offers: readonly PosMembershipOffer[],
  points: number,
): PosMembershipOffer | null {
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => a.minPoints - b.minPoints);
  let target = sorted[0];
  for (const offer of sorted) {
    if (points >= offer.minPoints) target = offer;
  }
  return target;
}

/** Siguiente oferta por encima de la objetivo (para "con X pts más…"). */
export function nextOfferAbove(
  offers: readonly PosMembershipOffer[],
  target: PosMembershipOffer,
): PosMembershipOffer | null {
  const above = offers
    .filter((o) => o.minPoints > target.minPoints)
    .sort((a, b) => a.minPoints - b.minPoints);
  return above[0] ?? null;
}

/** 'premium' → "Premium", 'basic' → "Básico". */
export function membershipPositionLabel(grantPosition?: string | null): string {
  switch ((grantPosition ?? '').toLowerCase()) {
    case 'basic':
      return 'Básico';
    case 'premium':
    case '':
      return 'Premium';
    default:
      return grantPosition as string;
  }
}

/** Estado del beneficio en español (detalle de venta). */
export function membershipStatusLabel(status: SaleMembershipStatus): string {
  switch (status) {
    case 'applied':
      return 'Aplicada';
    case 'reverted':
      return 'Anulada';
    case 'failed':
      return 'No se pudo aplicar';
    case 'pending':
    default:
      return 'Pendiente de aplicar';
  }
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (fecha de negocio, sin zona horaria). */
export function formatIsoDateDmy(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Porcentaje del cupón sin decimales de más ("10 %", "12.5 %"). */
export function formatCouponPercent(pct?: number | null): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  const n = Number(pct);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')} %`;
}

/**
 * Qué incluye la oferta, para el banner: "membresía Premium + 2 x Producto +
 * cupón 10 % en tu primera recompra (vigencia 90 días)".
 */
export function describeOfferBenefits(offer: PosMembershipOffer): string {
  const parts = [`membresía ${membershipPositionLabel(offer.grantPosition)}`];
  for (const g of offer.gifts) {
    const inactive = g.productActive === false ? ' (inactivo, no se entrega)' : '';
    parts.push(`${g.quantity} x ${g.name}${inactive}`);
  }
  if (offer.couponPercent != null && offer.couponPercent > 0) {
    parts.push(
      `cupón ${formatCouponPercent(offer.couponPercent)} en tu primera recompra (vigencia ${offer.couponValidDays} días)`,
    );
  }
  return parts.join(' + ');
}

/** Bloque MEMBRESÍA del ticket a partir de lo que trae la venta. */
export function toReceiptMembership(m: SaleMembership): SaleReceiptMembership {
  return {
    name: m.name,
    code: m.code,
    status: m.status,
    positionLabel: membershipPositionLabel(m.grantPosition),
    gifts: (m.gifts ?? []).map((g) => ({
      name: g.name,
      quantity: Number(g.quantity) || 1,
      delivered: g.delivered !== false,
    })),
    couponCode: m.couponCode ?? null,
    couponPercent: m.couponPercent ?? null,
    couponValidUntil: m.couponValidUntil ?? null,
  };
}

/**
 * Renglones "Regalo" del ticket: los items de la venta que el servidor agregó
 * a $0 por la campaña (`membershipGift`). El carrito no los tiene, por eso se
 * leen de la venta ya cobrada.
 */
export function giftReceiptLines(
  items: ReadonlyArray<{
    productName: string;
    productSku: string;
    quantity: number;
    membershipGift?: boolean;
  }>,
): SaleReceiptPayload['items'] {
  return items
    .filter((it) => it.membershipGift === true)
    .map((it) => ({
      name: it.productName,
      sku: it.productSku,
      quantity: Number(it.quantity) || 1,
      unitPrice: 0,
      total: 0,
      gift: true,
    }));
}
