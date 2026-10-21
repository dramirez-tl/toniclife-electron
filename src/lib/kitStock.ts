// kitStock.ts - Lectura de la disponibilidad de kits/paquetes en el POS.
//
// El API (GET /products?branchId=) ya manda `stock` para TODO producto de la
// sucursal: para un kit/paquete que se ARMA al vender (kitDeductsInventory)
// es "cuántos se pueden armar" (0 si falta cualquier componente); para un kit
// PREARMADO es su pieza propia, igual que un producto normal. Para el kit que
// se arma manda además `limitingComponent` (el componente que menos alcanza):
// con stock 0 es el que FALTA, y el POS lo dice con nombre, clave y piezas
// (CEDEAS, 21-oct-2026: "no dice qué componente falta"). El POS solo lo lee y
// lo muestra; la regla dura (no se vende si falta un componente) la sigue
// aplicando el servidor al crear la venta.

import { isAssembledKit } from '@/lib/posApi';
import type { PosKitAvailability, QuickProduct } from '@/types/pos';

type StockLike = Pick<
  QuickProduct,
  'stock' | 'productType' | 'kitDeductsInventory' | 'limitingComponent'
>;

/** Kit o paquete (se arme o no). */
export function isKitLike(p: Pick<QuickProduct, 'productType'>): boolean {
  return p.productType === 'kit' || p.productType === 'pack';
}

/** Hay dato de existencia y es cero (o negativo). Sin dato ⇒ false. */
export function isOutOfStock(p: StockLike): boolean {
  return p.stock != null && p.stock <= 0;
}

/** "Energy Gold (8201): hay 0, necesita 1". */
function limitingText(p: StockLike): string | null {
  const c = p.limitingComponent;
  if (!c || !c.name) return null;
  const code = c.code ? ` (${c.code})` : '';
  return `${c.name}${code}: hay ${c.available}, necesita ${c.need}`;
}

/**
 * Motivo corto del agotado, para el badge/tooltip:
 *  - kit que se arma: el componente que falta en la sucursal (si el API lo
 *    manda) o, si no, "falta un componente";
 *  - prearmado / producto: sin existencia propia.
 */
export function outOfStockReason(p: StockLike): string {
  if (isAssembledKit(p)) {
    const limiting = limitingText(p);
    return limiting
      ? `falta ${limiting}`
      : 'falta un componente en esta sucursal';
  }
  if (isKitLike(p)) return 'sin existencia del kit en esta sucursal';
  return 'sin existencia en esta sucursal';
}

/**
 * Componentes que faltan según el desglose del API (GET /pos/kits/:id/
 * availability): "Energy Gold (8201): hay 0, faltan 1 · Lexi Life (8205): hay 1,
 * faltan 1". null si no falta ninguno o el desglose viene vacío.
 */
export function missingComponentsText(
  availability: Pick<PosKitAvailability, 'components' | 'reason'> | null | undefined,
): string | null {
  if (!availability) return null;
  if (availability.reason === 'recipe_empty') {
    return 'el kit no tiene composición cargada';
  }
  if (availability.reason === 'component_inactive') {
    return 'un componente del kit está inactivo';
  }
  const missing = availability.components.filter((c) => c.missing > 0);
  if (missing.length === 0) return null;
  return missing
    .map(
      (c) =>
        `${c.name}${c.code ? ` (${c.code})` : ''}: hay ${c.available}, faltan ${c.missing}`,
    )
    .join(' · ');
}

/** Texto corto de existencia para tarjetas: "7 armables" / "3 disp.". */
export function stockShortLabel(p: StockLike): string | null {
  if (p.stock == null) return null;
  if (isAssembledKit(p)) return `${p.stock} armables`;
  return `${p.stock} disp.`;
}

/**
 * Mensaje para el cajero cuando el kit elegido para una inscripción está
 * agotado en la sucursal. NO bloquea el alta (decisión D9: aviso hasta el
 * conteo inicial de componentes); solo avisa antes de capturar al prospecto.
 */
export function kitUnavailableMessage(kit: Pick<QuickProduct, 'sku' | 'name'> & StockLike): string {
  const limiting = isAssembledKit(kit) ? limitingText(kit) : null;
  const why = limiting
    ? `falta ${limiting}`
    : isAssembledKit(kit)
      ? 'falta existencia de al menos un componente'
      : 'no hay existencia del kit';
  return `Este kit no se puede vender en esta sucursal: ${why}. Puedes registrar al distribuidor, pero el cobro del kit ${kit.sku} se rechazará hasta que haya existencia (pide traspaso o elige otro kit).`;
}
