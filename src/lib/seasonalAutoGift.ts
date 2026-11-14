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
//
// GRUPOS que se combinan (14-nov-2026, "el 24 Shake tiene diferentes sabores
// pero es el mismo producto"): si el producto está en un grupo de la promoción,
// lo que cuenta es el TOTAL del grupo en el carrito, no su renglón:
//   - al llegar el grupo a las piezas que se pagan (3 de vainilla + 2 de
//     chocolate en un 6x5), la gratis entra sola en el ÚLTIMO sabor capturado.
//     Si los productos del grupo tienen precios distintos y eso le costaría más
//     al cliente (la gratis es la más barata), entra en el más barato;
//   - al bajar, la gratis se va con la pieza que la ganaba: primero la que
//     había entrado sola y nadie pasó (esté en el sabor que esté), si no, una
//     más del renglón que se bajó;
//   - al quitar un renglón completo no hay de dónde bajar más: si el grupo
//     queda en las piezas que se pagan, la gratis entra en otro renglón;
//   - la pieza gratis que entró sola en un sabor y el cliente trae de OTRO
//     sabor: al pasar esa otra pieza toma su lugar (el grupo no crece).
// Puro: sin estado ni React.

import {
  isPromotionActive,
  nxmGroupOf,
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
  /**
   * Grupo de productos que se combinan con este dentro de la promoción (sabores
   * del mismo producto). Sin grupo, el producto cuenta solo: no viene la llave.
   */
  group?: { name: string; productIds: string[] };
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
    const promo: AutoGiftPromo = {
      id: d.id,
      code: d.code,
      name: d.name,
      buy,
      pay,
      label: `${buy}x${pay}`,
    };
    // Solo cuentan los productos del grupo que la promoción sí vende hoy.
    const group = nxmGroupOf(productId, cfg);
    const productIds = (group?.productIds ?? []).filter((id) =>
      d.eligibleProductIds.includes(id),
    );
    return group && productIds.length > 1
      ? { ...promo, group: { name: group.name, productIds } }
      : promo;
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

// --- grupos de productos que se combinan -------------------------------------

/** Renglón de un grupo, como lo ve la pieza gratis automática. */
export interface GroupGiftLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** Tope por existencia o por derechos (null = sin tope). */
  max: number | null;
  /** Gratis que entraron solas a este renglón y nadie ha pasado. */
  pending: number;
}

export interface GroupGiftPlan {
  /** Cantidad final de los renglones del grupo que cambian (0 = se quita). */
  quantities: Map<string, number>;
  /** Gratis "sin pasar" con las que quedan los renglones que cambian. */
  pending: Map<string, number>;
  /** La pieza gratis que entró sola, y en qué producto. */
  added: { productId: string; name: string; pieces: number } | null;
  /** Piezas que se fueron de más al bajar (la gratis que ya no se gana). */
  removed: { productId: string; name: string; pieces: number }[];
  /** Gratis que no cupieron: sin existencia, o le costarían al cliente. */
  missing: number;
}

const NO_GROUP_PLAN = (): GroupGiftPlan => ({
  quantities: new Map(),
  pending: new Map(),
  added: null,
  removed: [],
  missing: 0,
});

/**
 * Deja el GRUPO con su pieza gratis. `lines` = renglones del grupo en el
 * carrito, en orden, ya con el cambio del cajero aplicado.
 *   - `touched`: el producto que movió el cajero (null si su renglón ya no está).
 *   - `previousTotal`: piezas del grupo antes del cambio.
 *   - `payable(q)`: lo que paga el cliente por el carrito si los renglones del
 *     grupo quedaran con esas cantidades (corre el MOTOR). Es el candado: la
 *     gratis solo entra si el cliente NO paga más que sin ella.
 */
export function planGroupGift(args: {
  lines: readonly GroupGiftLine[];
  touched: string | null;
  previousTotal: number;
  promo: Pick<AutoGiftPromo, 'buy' | 'pay'>;
  payable: (quantities: ReadonlyMap<string, number>) => number;
}): GroupGiftPlan {
  const { lines, promo } = args;
  const plan = NO_GROUP_PLAN();
  const startTotal = lines.reduce((s, l) => s + l.quantity, 0);
  const touched = lines.find((l) => l.productId === args.touched) ?? null;

  // Estado de trabajo: piezas y gratis "sin pasar" de cada renglón.
  let qty = new Map(lines.map((l) => [l.productId, l.quantity]));
  let pend = new Map(
    lines.map((l) => [l.productId, Math.max(0, Math.min(l.pending, l.quantity))]),
  );
  let total = startTotal;
  const left = (l: GroupGiftLine) => qty.get(l.productId) ?? 0;
  const waiting = (l: GroupGiftLine) => pend.get(l.productId) ?? 0;
  const take = (l: GroupGiftLine, fromPending: boolean): void => {
    qty.set(l.productId, left(l) - 1);
    pend.set(
      l.productId,
      fromPending ? waiting(l) - 1 : Math.min(waiting(l), left(l)),
    );
    total -= 1;
  };
  /** Se va una gratis que entró sola y nadie pasó: primero de los otros sabores. */
  const takePending = (): boolean => {
    const l = [...lines.filter((x) => x !== touched), ...(touched ? [touched] : [])].find(
      (x) => waiting(x) > 0,
    );
    if (!l) return false;
    take(l, true);
    return true;
  };
  /** El plan: solo los renglones que cambiaron respecto a como llegaron. */
  const finish = (): GroupGiftPlan => {
    for (const l of lines) {
      const q = left(l);
      const p = waiting(l);
      if (q === l.quantity && p === l.pending) continue;
      plan.quantities.set(l.productId, q);
      plan.pending.set(l.productId, p);
      if (q < l.quantity) {
        plan.removed.push({
          productId: l.productId,
          name: l.name,
          pieces: l.quantity - q,
        });
      }
    }
    return plan;
  };

  if (startTotal < Math.floor(Number(args.previousTotal) || 0)) {
    // BAJA. 1) Las gratis que entraron solas y que el grupo YA NO GANA se van
    // siempre, estén en el sabor que estén: nadie las pasó por el escáner, y
    // si se quedaran se le cobrarían al cliente.
    const freePer = promo.buy - promo.pay;
    const pendingTotal = () => [...pend.values()].reduce((s, n) => s + n, 0);
    while (
      pendingTotal() > Math.floor(total / promo.buy) * freePer &&
      takePending()
    ) {
      /* sigue hasta que las gratis sin pasar quepan en lo que el grupo gana */
    }
    // 2) El grupo no puede quedar "pagando sin su regalo": la gratis se va con
    // la pieza que la ganaba (una sin pasar si queda; si no, del renglón que
    // se bajó).
    const saved = { qty: new Map(qty), pend: new Map(pend), total };
    let stuck = false;
    while (total > 0 && total % promo.buy >= promo.pay) {
      if (takePending()) continue;
      if (touched && left(touched) > 0) {
        take(touched, false);
        continue;
      }
      stuck = true;
      break;
    }
    if (!stuck) return finish();
    // No hay de dónde bajar más (se quitó el renglón completo): el grupo se
    // queda en las piezas que se pagan, así que la gratis entra en otro.
    qty = saved.qty;
    pend = saved.pend;
    total = saved.total;
  }

  const rem = total % promo.buy;
  if (!(total > 0) || rem < promo.pay) return finish();

  // SUBE (o no se pudo bajar): se completa el grupo. Primero en el renglón
  // que movió el cajero; si ahí le costaría más al cliente (precios distintos:
  // la gratis es la más barata) o no hay existencia, en el más barato.
  const n = promo.buy - rem;
  const base = args.payable(qty);
  const rest = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l !== touched && left(l) > 0)
    .sort((a, b) => a.l.unitPrice - b.l.unitPrice || b.i - a.i)
    .map(({ l }) => l);
  let noStock = false;
  for (const c of touched && left(touched) > 0 ? [touched, ...rest] : rest) {
    const next = new Map(qty);
    next.set(c.productId, left(c) + n);
    // El candado (medio centavo de tolerancia: importes en flotante). Si la
    // promoción ya no regala más (tope por venta), nada entra y nada se avisa.
    if (args.payable(next) > base + 0.005) continue;
    if (c.max != null && left(c) + n > c.max) {
      noStock = true;
      continue;
    }
    qty.set(c.productId, left(c) + n);
    pend.set(c.productId, waiting(c) + n);
    plan.added = { productId: c.productId, name: c.name, pieces: n };
    return finish();
  }
  // Había pieza gratis que dar, pero ningún sabor del carrito tiene existencia.
  if (noStock) plan.missing = n;
  return finish();
}

/**
 * Al AGREGAR piezas de un producto del grupo: si OTRO renglón del grupo trae
 * gratis que entraron solas y nadie ha pasado, la pieza que se pasa ahora es
 * esa misma pieza gratis (el cliente la trae de otro sabor): toma su lugar y
 * el grupo no crece. Devuelve cuántas piezas deja cada renglón y de cuál.
 * (Las del MISMO renglón se reconocen antes, con `claimPendingGift`.)
 */
export function claimGroupPending(
  add: number,
  others: readonly Pick<GroupGiftLine, 'productId' | 'name' | 'pending' | 'quantity'>[],
): { productId: string; name: string; pieces: number }[] {
  let left = Math.max(0, Math.floor(Number(add) || 0));
  const moved: { productId: string; name: string; pieces: number }[] = [];
  for (const l of others) {
    if (left <= 0) break;
    const waiting = Math.max(0, Math.floor(Number(l.pending) || 0));
    const pieces = Math.min(left, waiting, Math.max(0, l.quantity));
    if (pieces <= 0) continue;
    moved.push({ productId: l.productId, name: l.name, pieces });
    left -= pieces;
  }
  return moved;
}

/** Texto del aviso al cajero de lo que hizo la gratis de un grupo (null = nada). */
export function groupGiftMessage(
  plan: GroupGiftPlan,
  promo: AutoGiftPromo,
): { kind: 'added' | 'removed' | 'missing'; text: string } | null {
  const pieces = (n: number) => (n === 1 ? '1 pieza' : `${n} piezas`);
  if (plan.added) {
    return {
      kind: 'added',
      text: `${promo.label}: se agregó ${pieces(plan.added.pieces)} gratis de ${plan.added.name}`,
    };
  }
  if (plan.missing > 0) {
    const group = promo.group?.name ? ` de ${promo.group.name}` : '';
    return {
      kind: 'missing',
      text: `${promo.label}: no hay existencia para la pieza gratis${group}. Agrega otra pieza del grupo y sale gratis`,
    };
  }
  if (plan.removed.length > 0) {
    const names = plan.removed.map((r) => r.name).join(' y ');
    return {
      kind: 'removed',
      text: `${promo.label}: también se quitó la pieza gratis de ${names}`,
    };
  }
  return null;
}

/** Aviso cuando la pieza que se pasó tomó el lugar de la gratis de otro sabor. */
export function movedGiftText(
  promo: Pick<AutoGiftPromo, 'label'>,
  productName: string,
  fromNames: readonly string[],
): string {
  return `${promo.label}: ${productName} entra en lugar de la pieza gratis de ${fromNames.join(' y ')} que se había agregado sola`;
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
