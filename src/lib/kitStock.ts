// kitStock.ts - Lectura de la disponibilidad de kits/paquetes en el POS.
//
// El API (GET /products?branchId=) ya manda `stock` para TODO producto de la
// sucursal: para un kit/paquete que se ARMA al vender (kitDeductsInventory)
// es "cuántos se pueden armar" (0 si falta cualquier componente); para un kit
// PREARMADO es su pieza propia, igual que un producto normal. El POS solo lo
// lee y lo muestra; la regla dura (no se vende si falta un componente) la
// sigue aplicando el servidor al crear la venta.

import { isAssembledKit } from '@/lib/posApi';
import type { QuickProduct } from '@/types/pos';

type StockLike = Pick<
  QuickProduct,
  'stock' | 'productType' | 'kitDeductsInventory'
>;

/** Kit o paquete (se arme o no). */
export function isKitLike(p: Pick<QuickProduct, 'productType'>): boolean {
  return p.productType === 'kit' || p.productType === 'pack';
}

/** Hay dato de existencia y es cero (o negativo). Sin dato ⇒ false. */
export function isOutOfStock(p: StockLike): boolean {
  return p.stock != null && p.stock <= 0;
}

/**
 * Motivo corto del agotado, para el badge/tooltip:
 *  - kit que se arma: falta al menos un componente en la sucursal;
 *  - prearmado / producto: sin existencia propia.
 */
export function outOfStockReason(p: StockLike): string {
  if (isAssembledKit(p)) return 'falta un componente en esta sucursal';
  if (isKitLike(p)) return 'sin existencia del kit en esta sucursal';
  return 'sin existencia en esta sucursal';
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
  const why = isAssembledKit(kit)
    ? 'falta existencia de al menos un componente'
    : 'no hay existencia del kit';
  return `Este kit no se puede vender en esta sucursal: ${why}. Puedes registrar al distribuidor, pero el cobro del kit ${kit.sku} se rechazará hasta que haya existencia (pide traspaso o elige otro kit).`;
}
