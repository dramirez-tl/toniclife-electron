// seasonalAutoGift.ts - La pieza GRATIS de una promoción "lleva N, paga M"
// entra SOLA al carrito (Diego, 12-nov-2026: "cuando agreguen 2 de un producto
// en promoción se agregue el de regalo sí o sí, por defecto, en automático").
//
// Antes el 3x2 solo se aplicaba si el cajero capturaba las 3 piezas: con 2 en
// el carrito el cliente pagaba 2 y se llevaba 2. Ahora, en cuanto el renglón
// llega a las piezas que se PAGAN (2 en un 3x2, 5 en un "compra 5 y llévate
// 1"), la cantidad sube sola hasta completar el grupo (3, 6): el cliente paga
// lo mismo y se lleva la gratis. Al bajar la cantidad, la gratis se va junto
// con la pieza que la ganaba (de 3 baja a 1, no a 2): no se puede quedar un
// renglón "pagando 2 sin su regalo", salvo que NO haya existencia para la
// pieza gratis (entonces se queda como está y se avisa).
//
// NO toca el motor (lib/seasonalPromotions.ts es copia 1:1 del API): solo
// decide la CANTIDAD del renglón. El API recibe la cantidad total, como
// siempre, y vuelve a aplicar la promoción; su resultado manda. Por eso la
// pieza solo se agrega si el motor confirma que sale gratis (`resolveAutoGift`
// recibe `freeAt`): nunca se le cobra al cliente una pieza que entró sola.
//
// En mostrador pasan las dos cosas, y las dos deben quedar bien:
//   a) el cliente trae 2 piezas → el cajero pasa 2 → el carrito queda en 3 y
//      el cajero le entrega la tercera;
//   b) el cliente ya trae las 3 → el cajero pasa las 3 por el escáner. La
//      tercera pasada NO debe dejar 4: es la misma pieza gratis que ya había
//      entrado sola. Por eso el renglón recuerda cuántas gratis entraron
//      "sin pasar" (`autoGiftPending`) y la siguiente pieza que se AGREGA
//      (escáner, clave o clic en el catálogo) se toma de ahí (`claimPendingGift`).
//      Los botones + y − del carrito son explícitos: siempre mueven la cantidad.
//
// Alcance: promociones `nxm` en piezas IDÉNTICAS (sameProductOnly). En un
// "mezcla y lleva" la gratis es la más barata del conjunto: ahí no se adivina.
// Puro: sin estado ni React.

import {
  isPromotionActive,
  type NxmConfig,
  type SeasonalEngineContext,
  type SeasonalPromotionDef,
} from './seasonalPromotions';

/** Promoción "lleva N, paga M" que gobierna un producto. */
export interface AutoGiftPromo {
  id: string;
  code: string;
  name: string;
  /** Piezas del grupo (3 en un 3x2). */
  buy: number;
  /** Piezas que se pagan (2 en un 3x2). */
  pay: number;
  /** Etiqueta corta ("3x2", "6x5"). */
  label: string;
}

export interface AutoGiftOutcome {
  /** Cantidad con la que queda el renglón. */
  quantity: number;
  /** Piezas gratis que entraron solas. */
  added: number;
  /** Piezas que se fueron de más al bajar (la gratis que ya no se gana). */
  removed: number;
  /** Piezas gratis que NO cupieron por existencia o tope. */
  missing: number;
  promo: AutoGiftPromo | null;
}

/**
 * La promoción "lleva N, paga M" en piezas idénticas que el motor le aplicaría
 * AHORA a ese producto, o null. Mismo orden que el motor (prioridad y código):
 * un renglón participa en UNA sola promoción, la primera que lo consume; si
 * esa es de otro tipo (precio especial, %) o un "mezcla y lleva", no hay
 * pieza gratis que agregar. El regalo por compra no consume renglones.
 */
export function governingNxm(
  productId: string,
  defs: readonly SeasonalPromotionDef[],
  ctx: SeasonalEngineContext,
): AutoGiftPromo | null {
  const active = defs
    .filter((d) => isPromotionActive(d, ctx))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  for (const d of active) {
    if (d.type === 'gift_with_purchase') continue;
    if (!d.eligibleProductIds.includes(productId)) continue;
    if (d.type !== 'nxm') return null;
    const cfg = d.config as NxmConfig;
    const buy = Math.floor(Number(cfg.buy));
    const pay = Math.floor(Number(cfg.pay));
    if (cfg.sameProductOnly === false) return null;
    if (!(buy > 1) || !(pay >= 1) || pay >= buy) return null;
    return { id: d.id, code: d.code, name: d.name, buy, pay, label: `${buy}x${pay}` };
  }
  return null;
}

/**
 * Cantidad a la que debe quedar el renglón para que la pieza gratis vaya
 * incluida. `wanted` = lo que pidió el cajero; `previous` = lo que había.
 *   - Sube (o renglón nuevo): si el sobrante ya alcanzó las piezas que se
 *     pagan, se completa el grupo. 3x2: 2 → 3, 5 → 6; 6x5: 5 → 6, 11 → 12.
 *   - Baja: si quedaría "pagando sin su regalo", baja una más: 3 → 1, 6 → 4.
 */
export function autoGiftTarget(
  wanted: number,
  previous: number,
  promo: Pick<AutoGiftPromo, 'buy' | 'pay'>,
): number {
  const q = Math.floor(Number(wanted));
  if (!(q > 0)) return q;
  const rem = q % promo.buy;
  if (rem < promo.pay) return q;
  if (q >= Math.floor(Number(previous) || 0)) return q + (promo.buy - rem);
  return q - rem + (promo.pay - 1);
}

/**
 * Resuelve la cantidad final del renglón.
 *   - `max`: tope por existencia o por derechos (null/undefined = sin tope).
 *   - `freeAt(q)`: piezas gratis que el MOTOR le da a este renglón si queda con
 *     `q` piezas (con el resto del carrito igual). Es el candado: la cantidad
 *     solo sube si lo que el cliente PAGA no aumenta.
 */
export function resolveAutoGift(args: {
  wanted: number;
  previous: number;
  promo: AutoGiftPromo | null;
  max?: number | null;
  freeAt: (quantity: number) => number;
}): AutoGiftOutcome {
  const { wanted, previous, promo, max } = args;
  const same: AutoGiftOutcome = {
    quantity: wanted,
    added: 0,
    removed: 0,
    missing: 0,
    promo,
  };
  if (!promo || !(wanted > 0)) return same;
  const target = autoGiftTarget(wanted, previous, promo);
  if (target === wanted) return same;
  if (target < wanted) {
    return { ...same, quantity: target, removed: wanted - target };
  }
  // Sube: solo si hay existencia para la pieza gratis…
  if (max != null && target > max) {
    return { ...same, missing: target - wanted };
  }
  // …y si el motor confirma que lo agregado sale gratis (el cliente paga lo
  // mismo que con la cantidad que pidió).
  const paidWanted = wanted - args.freeAt(wanted);
  const paidTarget = target - args.freeAt(target);
  if (paidTarget > paidWanted) return same;
  return { ...same, quantity: target, added: target - wanted };
}

/**
 * Al AGREGAR piezas a un renglón que trae gratis que entraron solas y aún no
 * se han pasado (`pending`): las primeras piezas agregadas son esas mismas, así
 * que no suman. Devuelve cuántas sí hay que sumar, cuántas gratis siguen sin
 * pasar y cuántas se reconocieron.
 */
export function claimPendingGift(
  add: number,
  pending: number,
): { add: number; pending: number; claimed: number } {
  const toAdd = Math.max(0, Math.floor(Number(add) || 0));
  const waiting = Math.max(0, Math.floor(Number(pending) || 0));
  const claimed = Math.min(toAdd, waiting);
  return { add: toAdd - claimed, pending: waiting - claimed, claimed };
}

/** Aviso cuando la pieza que se pasó era la gratis que ya estaba en el carrito. */
export function claimedGiftText(productName: string): string {
  return `Esa pieza de ${productName} es la gratis que ya estaba en el carrito: la cantidad no cambia`;
}

/** Texto del aviso al cajero (null = nada que avisar). */
export function autoGiftMessage(
  outcome: AutoGiftOutcome,
  productName: string,
): { kind: 'added' | 'removed' | 'missing'; text: string } | null {
  const promo = outcome.promo;
  if (!promo) return null;
  const pieces = (n: number) => (n === 1 ? '1 pieza' : `${n} piezas`);
  if (outcome.added > 0) {
    return {
      kind: 'added',
      text: `${promo.label}: se agregó ${pieces(outcome.added)} gratis de ${productName}`,
    };
  }
  if (outcome.missing > 0) {
    return {
      kind: 'missing',
      text: `${promo.label}: no hay existencia para la pieza gratis de ${productName}; se cobra sin promoción`,
    };
  }
  if (outcome.removed > 0) {
    return {
      kind: 'removed',
      text: `${promo.label}: también se quitó la pieza gratis de ${productName}`,
    };
  }
  return null;
}
