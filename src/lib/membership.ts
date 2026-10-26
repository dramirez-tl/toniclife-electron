// membership.ts — Campañas de membresía ("Compra N puntos en producto y tu
// membresía de inscripción es GRATIS") en el POS: qué puntos del ticket
// cuentan, qué oferta se persigue y los textos del ticket/detalle. Funciones
// puras, sin React ni API, para poder razonarlas (y probarlas) aparte.

import type {
  PosMembershipOffer,
  PosMembershipOffersResponse,
  SaleMembership,
  SaleMembershipStatus,
} from '@/types/pos';
import type { SaleReceiptMembership, SaleReceiptPayload } from '@/types';

/**
 * Respuesta de /pos/membership-campaigns(/offers) → tipos del POS, tolerante
 * a campos faltantes (API viejo) y ordenada por minPoints. `resolveImage`
 * convierte la liga de la imagen a la base del API (posApi.resolveImageUrl).
 */
export function parseMembershipOffersResponse(
  data: unknown,
  resolveImage: (url?: string) => string | undefined,
): PosMembershipOffersResponse {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const d = (data ?? {}) as any;
  const offers: PosMembershipOffer[] = (
    Array.isArray(d.offers) ? (d.offers as any[]) : []
  )
    .filter((o) => o && o.campaignId)
    .map(
      (o): PosMembershipOffer => ({
        campaignId: String(o.campaignId),
        code: String(o.code ?? ''),
        name: String(o.name ?? o.code ?? 'Campaña de membresía'),
        description: o.description ?? null,
        imageUrl: resolveImage(o.imageUrl ?? undefined) ?? null,
        minPoints: Number(o.minPoints) || 0,
        grantPosition: String(o.grantPosition ?? 'premium'),
        couponPercent: o.couponPercent != null ? Number(o.couponPercent) : null,
        couponValidDays: Number(o.couponValidDays) || 0,
        gifts: (Array.isArray(o.gifts) ? (o.gifts as any[]) : [])
          .map((g, i) => ({
            productId: String(g.productId ?? ''),
            sku: String(g.sku ?? ''),
            name: String(g.name ?? g.sku ?? 'Regalo'),
            quantity: Number(g.quantity) || 1,
            sortOrder: Number(g.sortOrder ?? i) || i,
            productActive:
              typeof g.productActive === 'boolean' ? g.productActive : undefined,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
        audience:
          o.audience === 'new' || o.audience === 'basic' ? o.audience : null,
      }),
    )
    .sort((a, b) => a.minPoints - b.minPoints);
  const c = d.customer;
  const customer =
    c && typeof c === 'object'
      ? {
          status: c.status ?? null,
          kitType: c.kitType ?? null,
          audience:
            c.audience === 'new' || c.audience === 'basic' ? c.audience : null,
          reason: c.reason ?? null,
        }
      : null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { offers, customer };
}

/**
 * Campañas que coinciden con lo tecleado en el buscador del catálogo: por
 * código ("MEMB1650"), por nombre o por la palabra "membresía" (3+ letras,
 * para que "mem" ya las muestre). Sin texto no coincide ninguna.
 */
export function matchMembershipOffers(
  offers: readonly PosMembershipOffer[],
  query: string,
): PosMembershipOffer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const generic = q.length >= 3 && 'membresia membresía campaña campana'.includes(q);
  return offers.filter(
    (o) =>
      generic ||
      o.code.toLowerCase().includes(q) ||
      o.name.toLowerCase().includes(q),
  );
}

export interface MembershipBagInput {
  /** Campaña elegida tal como la reporta la sucursal; null = ya no está
   *  encendida aquí (o aún cargando, ver loadingOffer). */
  offer: PosMembershipOffer | null;
  loadingOffer: boolean;
  hasCustomer: boolean;
  /** Ya respondió /offers para el distribuidor asignado. */
  offersLoaded: boolean;
  /** La campaña está entre las ofertas que HOY aplican al distribuidor. */
  eligible: boolean;
  /** Motivo del API cuando al distribuidor no le aplica ninguna. */
  customerReason: string | null;
  /** Puntos EN PRODUCTO del ticket (membershipPoints). */
  points: number;
}

export type MembershipBagTone = 'ok' | 'info' | 'warn' | 'error';

export interface MembershipBagStatus {
  /** Cumple todo: al cobrar viaja la campaña. */
  ready: boolean;
  missing: number;
  pct: number;
  tone: MembershipBagTone;
  message: string;
}

const fmtPts = (n: number) =>
  n.toLocaleString('es-MX', { maximumFractionDigits: 0 });

/**
 * Qué le falta a la "bolsa" de membresía del carrito para poder cobrarla, en
 * el orden en que el cajero lo resuelve: campaña vigente en la sucursal →
 * distribuidor asignado → que le aplique (nuevo o básico, no usada) → puntos
 * en producto. Misma regla que el servidor al validar membershipCampaignId.
 */
export function membershipBagStatus(i: MembershipBagInput): MembershipBagStatus {
  if (!i.offer) {
    return i.loadingOffer
      ? { ready: false, missing: 0, pct: 0, tone: 'info', message: 'Cargando la campaña…' }
      : {
          ready: false,
          missing: 0,
          pct: 0,
          tone: 'error',
          message:
            'Esta campaña ya no está habilitada en esta sucursal: quita la bolsa para cobrar.',
        };
  }
  const missing = Math.max(0, i.offer.minPoints - i.points);
  const pct =
    i.offer.minPoints > 0 ? Math.min(100, (i.points / i.offer.minPoints) * 100) : 100;
  if (!i.hasCustomer) {
    return {
      ready: false,
      missing,
      pct,
      tone: 'warn',
      message: 'Asigna al distribuidor (nuevo o básico) para poder aplicarla.',
    };
  }
  if (!i.offersLoaded) {
    return {
      ready: false,
      missing,
      pct,
      tone: 'info',
      message: 'Verificando si la campaña aplica al distribuidor…',
    };
  }
  if (!i.eligible) {
    return {
      ready: false,
      missing,
      pct,
      tone: 'error',
      message: i.customerReason
        ? `No aplica: ${i.customerReason}`
        : 'No aplica a este distribuidor (ya la usó o ya tiene esa posición).',
    };
  }
  if (missing > 0) {
    return {
      ready: false,
      missing,
      pct,
      tone: 'info',
      message: `Faltan ${fmtPts(missing)} pts en producto: agrega producto al carrito.`,
    };
  }
  return {
    ready: true,
    missing: 0,
    pct: 100,
    tone: 'ok',
    message: 'Lista: al cobrar se aplican la membresía, los regalos y el cupón.',
  };
}

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
