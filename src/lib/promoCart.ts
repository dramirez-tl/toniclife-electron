// promoCart.ts - Canje de promociones EN LA MISMA COMPRA (27-oct-2026).
//
// Cuando los puntos del carrito hacen que el distribuidor alcance una promo
// (ej. 4,000 pts → PROMO150), el POS la ofrece para cobrarla en esa misma
// venta: aquí se convierte la promo alcanzable en ítem del carrito ($0,
// 0 puntos, marcada promoBySale) y la venta cobrada en el bloque PROMOCIÓN
// del ticket. El servidor valida al cobrar: acumula los puntos, otorga el
// derecho y lo canjea en la misma transacción.

import type { ReachablePromotion } from '@/lib/promotionsApi';
import type { QuickProduct, SalePromotion } from '@/types/pos';
import type { SaleReceiptPromotion } from '@/types';

/** Ítem del carrito para una promo alcanzada con esta compra. */
export function reachablePromoToQuickProduct(
  promo: ReachablePromotion,
): QuickProduct {
  return {
    id: promo.productId,
    sku: promo.code,
    name: promo.name,
    slug: promo.code.toLowerCase(),
    basePrice: 0,
    points: 0,
    businessVolume: 0,
    taxRate: 0,
    isIncludedInPrice: false,
    isActive: true,
    productType: 'promotional',
    // Sin tope de stock: la promo descuenta componentes, no a sí misma.
    stock: undefined,
    // Un derecho por periodo: una sola unidad.
    maxQuantity: 1,
    components: promo.items,
    promoBySale: true,
    promoMinPoints: promo.minPointsRequired,
  };
}

/**
 * Promos del carrito marcadas "de esta compra" que YA NO se alcanzan con los
 * puntos actuales del distribuidor + los del carrito (se quitó producto).
 */
export function unreachablePromoItems(
  items: ReadonlyArray<{
    productId: string;
    productSku: string;
    promoBySale?: boolean;
    promoMinPoints?: number;
  }>,
  currentPoints: number,
  cartPoints: number,
): Array<{ productId: string; productSku: string; promoMinPoints: number }> {
  const projected = currentPoints + cartPoints;
  return items
    .filter(
      (it) =>
        it.promoBySale === true &&
        Number.isFinite(it.promoMinPoints) &&
        (it.promoMinPoints as number) > projected,
    )
    .map((it) => ({
      productId: it.productId,
      productSku: it.productSku,
      promoMinPoints: it.promoMinPoints as number,
    }));
}

/** Bloque PROMOCIÓN del ticket a partir de lo que trae la venta cobrada. */
export function toReceiptPromotions(
  promos: ReadonlyArray<SalePromotion> | null | undefined,
): SaleReceiptPromotion[] | undefined {
  if (!promos || promos.length === 0) return undefined;
  return promos.map((pr) => ({
    code: pr.code,
    name: pr.name,
    minPointsRequired: Number(pr.minPointsRequired) || 0,
    pointsAtGrant: Number(pr.pointsAtGrant) || 0,
    grantedBySale: pr.grantedBySale === true,
    items: (pr.items ?? []).map((it) => ({
      name: it.name,
      quantity: Number(it.quantity) || 1,
    })),
  }));
}
