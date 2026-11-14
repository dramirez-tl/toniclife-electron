// seasonalGroups.ts - Cómo se le explica al cajero una promoción "lleva N, paga
// M" (14-nov-2026): qué productos se COMBINAN entre sí (grupos de sabores del
// mismo producto), cuáles cuentan por separado y si la pieza gratis entra sola
// al carrito. Puro: lo usa el panel "Promociones de temporada".

import {
  nxmGroups,
  type NxmConfig,
  type SeasonalPromoConfig,
  type SeasonalPromoType,
} from './seasonalPromotions';

export interface PromoProductGroup<T> {
  /** Nombre del grupo ("24 Shake"). */
  name: string;
  products: T[];
}

/**
 * Productos de la promoción separados en los grupos que se combinan y los
 * sueltos (cuentan solo en piezas idénticas). Un grupo solo aparece si al
 * menos DOS de sus productos están en la lista: con uno no hay nada que
 * combinar y ese producto se muestra suelto. Conserva el orden de la lista.
 */
export function splitPromoProducts<T extends { productId: string }>(
  type: SeasonalPromoType,
  config: SeasonalPromoConfig | null | undefined,
  products: readonly T[],
): { groups: PromoProductGroup<T>[]; loose: T[] } {
  if (type !== 'nxm') return { groups: [], loose: [...products] };
  const groups: PromoProductGroup<T>[] = [];
  const grouped = new Set<string>();
  for (const g of nxmGroups(config)) {
    const members = products.filter((p) => g.productIds.includes(p.productId));
    if (members.length < 2) continue;
    members.forEach((p) => grouped.add(p.productId));
    groups.push({ name: g.name, products: members });
  }
  return {
    groups,
    loose: products.filter((p) => !grouped.has(p.productId)),
  };
}

/**
 * ¿La pieza gratis entra sola al carrito? Solo en "lleva N, paga M" de piezas
 * idénticas (con o sin grupos). En un "combinar todo" la gratis es la más
 * barata de todo el carrito y no se adivina (lib/seasonalAutoGift).
 */
export function promoGiftEntersAlone(
  type: SeasonalPromoType,
  config: SeasonalPromoConfig | null | undefined,
): boolean {
  if (type !== 'nxm') return false;
  return (config as Partial<NxmConfig> | null | undefined)?.sameProductOnly !== false;
}
