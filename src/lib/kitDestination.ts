// kitDestination.ts - Lo que el panel "¿Para quién es el kit?" le enseña al
// cajero antes de decidir (recompra del cliente o inscripción de un nuevo).
//
// El catálogo trae el kit a su precio de LISTA; una promoción de temporada
// (p. ej. "Kit Tonic Center Premium a $2,000", Buen Fin 13-nov-2026) solo se
// aplica al entrar al carrito. Para que el cajero no vea $2,789 en el panel y
// $2,000 un segundo después, aquí se corre el MISMO motor del carrito
// (lib/seasonalPromotions) sobre un renglón de una pieza. Solo informa: quien
// decide el cobro sigue siendo el carrito y, al final, el servidor.

import {
  applySeasonalPromotions,
  roundMoney,
  type SeasonalPromotionDef,
} from '@/lib/seasonalPromotions';
import type { QuickProduct } from '@/types/pos';

const KIT_POSITION_LABELS: Record<string, string> = {
  basic: 'Básico',
  premium: 'Premium',
  preferred: 'Preferente',
};

/** "Premium" / "Básico" / "Preferente"; una posición desconocida se muestra tal cual. */
export function kitPositionLabel(
  position: string | null | undefined,
): string | null {
  const key = (position ?? '').trim();
  if (!key) return null;
  return KIT_POSITION_LABELS[key.toLowerCase()] ?? key;
}

/** Lo que el motor necesita del contexto de temporada del carrito. */
export interface KitSeasonalContext {
  defs: SeasonalPromotionDef[];
  countryCode: string;
}

export interface KitPricePromo {
  /** Nombre de la promoción ("Kit Tonic Center Premium a $2,000"). */
  name: string;
  /** Nombre de la temporada ("Buen Fin 2026"), si la definición lo trae. */
  seasonName: string | null;
  /** Lo que baja el precio de UN kit. */
  discount: number;
  /** La promoción quita el Bono de Inscripción (solo kits de inscripción). */
  excludesKitBonus: boolean;
}

export interface KitPriceToday {
  /** Precio de lista (el del catálogo de la sucursal). */
  listPrice: number;
  /** Lo que se cobrará por UN kit al agregarlo ahora. */
  price: number;
  /** Puntos de UN kit, ya con la regla de puntos de la promoción. */
  points: number;
  /** Promoción de temporada que baja el precio; null = precio de lista. */
  promo: KitPricePromo | null;
}

type KitLike = Pick<
  QuickProduct,
  | 'id'
  | 'basePrice'
  | 'points'
  | 'businessVolume'
  | 'productType'
  | 'event'
  | 'isEnrollmentKit'
>;

/**
 * Precio y puntos de UN kit si se agrega al carrito en este momento
 * (`nowLocal` = hora local de la sucursal, 'YYYY-MM-DDTHH:mm:ss'). Mismas
 * exclusiones que el carrito (applySeasonalToItems): canjeables, boletos y
 * renglones en $0 nunca entran a una promoción de temporada. Un "lleva N,
 * paga M" no cambia el precio de una sola pieza, así que queda en lista.
 */
export function kitPriceToday(
  kit: KitLike,
  seasonal: KitSeasonalContext,
  nowLocal: string,
): KitPriceToday {
  const listPrice = Number(kit.basePrice) || 0;
  const list: KitPriceToday = {
    listPrice,
    price: listPrice,
    points: Number(kit.points) || 0,
    promo: null,
  };
  if (seasonal.defs.length === 0 || !(listPrice > 0)) return list;

  const result = applySeasonalPromotions(
    [
      {
        key: kit.id,
        productId: kit.id,
        quantity: 1,
        unitPrice: listPrice,
        unitPoints: Number(kit.points) || 0,
        unitBusinessValue: Number(kit.businessVolume) || 0,
        excluded: kit.productType === 'promotional' || !!kit.event,
      },
    ],
    seasonal.defs,
    { channel: 'pos', countryCode: seasonal.countryCode, nowLocal },
  );
  const line = result.lines.find((l) => l.key === kit.id);
  if (
    !line ||
    !line.promotionId ||
    line.freeQuantity > 0 ||
    !(line.discountAmount > 0)
  ) {
    return list;
  }
  const def = seasonal.defs.find((d) => d.id === line.promotionId);
  return {
    listPrice,
    price: Math.max(0, roundMoney(listPrice - line.discountAmount)),
    points: line.points,
    promo: {
      name: line.promoName ?? def?.name ?? 'Promoción de temporada',
      seasonName: def?.seasonName?.trim() || null,
      discount: line.discountAmount,
      excludesKitBonus: line.kitBonusExcluded && kit.isEnrollmentKit === true,
    },
  };
}
