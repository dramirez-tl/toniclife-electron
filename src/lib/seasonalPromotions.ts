// seasonal-promotions.engine.ts — Motor PURO de promociones de temporada
// (Buen Fin 2026 y siguientes, mig 186): dado el carrito y las promociones
// vigentes decide qué piezas salen gratis (3x2), qué descuento lleva cada
// renglón (% o precio especial) y qué regalos se agregan (regalo por compra).
//
// Reglas de negocio (Diego, 4-nov-2026):
//   - Las piezas GRATIS y los REGALOS se cobran en $0, descuentan existencia y
//     NO generan puntos ni valor de negocio.
//   - Una promoción se configura UNA vez por temporada y tipo (sin un código
//     por producto); el POS y la tienda reaccionan solos por fecha-hora local.
//   - Un renglón participa en UNA sola promoción (la de mayor prioridad que le
//     aplique); el regalo por compra no "consume" renglones, solo los cuenta.
//   - El kit vendido con "precio especial … sin bono" se marca para que el
//     reporte Bono de Inscripción lo excluya (kitBonusExcluded).
//
// Combinar por grupo (Diego, 14-nov-2026: "el 24 Shake tiene diferentes sabores
// pero es el mismo producto"): en un "lleva N, paga M" de piezas idénticas, los
// productos de un mismo GRUPO cuentan juntos (5 de vainilla + 1 de chocolate
// completan el 6x5). Lo que no está en un grupo sigue contando solo. Las piezas
// gratis son las más baratas del grupo, así que un renglón puede salir GRATIS
// COMPLETO (paidQuantity = 0): quien guarda la venta lo trata como regalo.
//
// Sin BD, sin Nest, sin fechas con zona horaria: las vigencias y el "ahora"
// llegan como marcas de hora LOCAL de la sucursal/país ('YYYY-MM-DDTHH:mm:ss')
// y se comparan como texto. Dinero a centavos, mitad hacia arriba.
//
// COPIA 1:1 del API (toniclife-api/src/modules/seasonal-promotions/lib/
// seasonal-promotions.engine.ts): si cambia aquel archivo, cambia este y sus
// pruebas. La terminal lo usa para reflejar la promoción en vivo y en la cola
// local; el API vuelve a aplicarlo al crear la venta y su resultado manda.

/**
 * Nivel de reglas de este motor. Sube cuando el motor aprende una regla que
 * cambia lo que se cobra: la caja declara su nivel al crear la venta y el
 * servidor la valúa con esas mismas reglas (API: lib/seasonal-client).
 *   1 = motor original (mig 186) · 2 = combinar por grupo (NxmConfig.groups).
 */
export const SEASONAL_ENGINE_LEVEL = 2;

export type SeasonalPromoChannel = 'pos' | 'online';
export type SeasonalPromoType =
  | 'nxm'
  | 'percent_off'
  | 'fixed_price'
  | 'gift_with_purchase';
export type SeasonalPointsMode = 'keep' | 'none';

export const SEASONAL_PROMO_TYPES: readonly SeasonalPromoType[] = [
  'nxm',
  'percent_off',
  'fixed_price',
  'gift_with_purchase',
];
export const SEASONAL_PROMO_CHANNELS: readonly SeasonalPromoChannel[] = [
  'pos',
  'online',
];

/** Productos que se combinan entre sí en un "lleva N, paga M": sabores o presentaciones de lo mismo. */
export interface NxmGroup {
  /** Nombre corto que ven el cajero y el comprador ("24 Shake"). */
  name: string;
  productIds: string[];
}

/**
 * "Lleva N, paga M" (3x2 = buy 3, pay 2).
 *   - sameProductOnly = false: se combinan TODOS los productos de la promoción.
 *   - sameProductOnly = true: solo piezas idénticas… salvo los productos de un
 *     mismo `groups[i]`, que cuentan juntos. Un producto fuera de todo grupo
 *     sigue contando solo. Sin `groups` (o vacío) = solo piezas idénticas.
 */
export interface NxmConfig {
  buy: number;
  pay: number;
  sameProductOnly: boolean;
  groups?: NxmGroup[];
}

/** Topes de la captura de grupos (admin). */
export const NXM_MAX_GROUPS = 30;
export const NXM_GROUP_NAME_MAX = 60;
/** Porcentaje de descuento sobre el precio del renglón. */
export interface PercentOffConfig {
  percent: number;
}
/** Precio unitario final por código de país (en el espacio del precio del canal: con IVA en MX). */
export interface FixedPriceConfig {
  prices: Record<string, number>;
}
/** Regalo al comprar N piezas (o $ monto) de los productos elegibles. */
export interface GiftWithPurchaseConfig {
  minQuantity: number | null;
  minAmount: number | null;
  /** true = cada múltiplo del umbral vuelve a dar el regalo (tope maxPerSale). */
  repeat: boolean;
}
export type SeasonalPromoConfig =
  | NxmConfig
  | PercentOffConfig
  | FixedPriceConfig
  | GiftWithPurchaseConfig;

export interface SeasonalPromoGift {
  productId: string;
  quantity: number;
}

/** Promoción ya resuelta (vigencia heredada de la temporada cuando no tiene la suya). */
export interface SeasonalPromotionDef {
  id: string;
  code: string;
  name: string;
  type: SeasonalPromoType;
  config: SeasonalPromoConfig;
  seasonId: string;
  seasonCode: string;
  seasonName: string;
  channels: SeasonalPromoChannel[];
  /** Códigos de país donde aplica (temporada ∩ promoción). */
  countryCodes: string[];
  /** Hora local 'YYYY-MM-DDTHH:mm:ss' (o 'YYYY-MM-DD' / sin segundos). */
  startsAt: string;
  endsAt: string;
  /** Menor = se evalúa primero. */
  priority: number;
  /** Veces por venta: grupos (nxm), piezas (% / precio fijo) o regalos (regalo). null = sin tope. */
  maxPerSale: number | null;
  /** Puntos de las piezas COBRADAS con descuento: keep = completos, none = 0. Las gratis siempre 0. */
  pointsMode: SeasonalPointsMode;
  /** true = el kit de inscripción vendido con esta promo NO genera bono al patrocinador. */
  excludesKitBonus: boolean;
  eligibleProductIds: string[];
  gifts: SeasonalPromoGift[];
}

export interface SeasonalEngineContext {
  channel: SeasonalPromoChannel;
  countryCode: string;
  /** Hora local de la sucursal/país 'YYYY-MM-DDTHH:mm:ss'. */
  nowLocal: string;
}

export interface SeasonalEngineLine {
  /** Identificador del renglón en el carrito (en el POS, el productId). */
  key: string;
  productId: string;
  /** Entero > 0. */
  quantity: number;
  /** Precio unitario en el espacio del canal (con IVA en MX, sin impuesto en US). */
  unitPrice: number;
  unitPoints: number;
  unitBusinessValue: number;
  /** true = nunca participa (promocionales canjeables, boletos, regalos de otra campaña, $0). */
  excluded?: boolean;
}

export interface SeasonalEngineLineResult {
  key: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Piezas que se cobran. */
  paidQuantity: number;
  /** Piezas gratis (3x2): $0, 0 puntos, descuentan existencia. */
  freeQuantity: number;
  /** Descuento total del renglón en el espacio del precio (gratis × precio + % / precio especial). */
  discountAmount: number;
  /** Puntos y valor de negocio totales del renglón ya con la regla de puntos. */
  points: number;
  businessValue: number;
  promotionId: string | null;
  promoCode: string | null;
  promoName: string | null;
  promoType: SeasonalPromoType | null;
  kitBonusExcluded: boolean;
}

export interface SeasonalEngineGift {
  productId: string;
  quantity: number;
  promotionId: string;
  promoCode: string;
  promoName: string;
  seasonId: string;
}

export interface SeasonalEngineApplied {
  promotionId: string;
  code: string;
  name: string;
  type: SeasonalPromoType;
  seasonId: string;
  /** Grupos (nxm), piezas (% / precio fijo) o regalos entregados (regalo). */
  times: number;
  discountAmount: number;
  freeUnits: number;
  giftUnits: number;
}

export interface SeasonalEngineResult {
  lines: SeasonalEngineLineResult[];
  gifts: SeasonalEngineGift[];
  applied: SeasonalEngineApplied[];
  totalDiscount: number;
}

// --- utilidades -------------------------------------------------------------

/** A centavos, mitad hacia arriba (misma regla que money.lib del POS). */
export function roundMoney(n: number): number {
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  return (sign * Math.round((abs + Number.EPSILON) * 100)) / 100;
}

/** 'YYYY-MM-DD' → 'YYYY-MM-DDT00:00:00'; 'YYYY-MM-DDTHH:mm' → '…:00'; recorta a segundos. */
export function normalizeLocalStamp(value: string | null | undefined): string {
  const v = String(value ?? '')
    .trim()
    .replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  return v.slice(0, 19);
}

export function isWithinLocalWindow(
  nowLocal: string,
  startsAt: string,
  endsAt: string,
): boolean {
  const now = normalizeLocalStamp(nowLocal);
  const start = normalizeLocalStamp(startsAt);
  const end = normalizeLocalStamp(endsAt);
  if (!now || !start || !end) return false;
  return start <= now && now <= end;
}

export function isPromotionActive(
  def: SeasonalPromotionDef,
  ctx: SeasonalEngineContext,
): boolean {
  if (!def.channels.includes(ctx.channel)) return false;
  if (!def.countryCodes.includes(ctx.countryCode)) return false;
  return isWithinLocalWindow(ctx.nowLocal, def.startsAt, def.endsAt);
}

function asInt(n: unknown, fallback = 0): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? v : fallback;
}

function capTimes(times: number, maxPerSale: number | null): number {
  if (maxPerSale == null || maxPerSale <= 0) return times;
  return Math.min(times, maxPerSale);
}

interface Work {
  line: SeasonalEngineLine;
  consumed: boolean;
  free: number;
  discount: number;
  promo: SeasonalPromotionDef | null;
}

function pointsFor(w: Work): { points: number; businessValue: number } {
  const paid = Math.max(0, w.line.quantity - w.free);
  const factor = w.promo && w.promo.pointsMode === 'none' ? 0 : paid;
  return {
    points: roundMoney(w.line.unitPoints * factor),
    businessValue: roundMoney(w.line.unitBusinessValue * factor),
  };
}

function pushApplied(
  applied: SeasonalEngineApplied[],
  promo: SeasonalPromotionDef,
  data: Pick<
    SeasonalEngineApplied,
    'times' | 'discountAmount' | 'freeUnits' | 'giftUnits'
  >,
): void {
  applied.push({
    promotionId: promo.id,
    code: promo.code,
    name: promo.name,
    type: promo.type,
    seasonId: promo.seasonId,
    times: data.times,
    discountAmount: roundMoney(data.discountAmount),
    freeUnits: data.freeUnits,
    giftUnits: data.giftUnits,
  });
}

/**
 * Grupos que el motor respeta en un "lleva N, paga M": solo con piezas
 * idénticas (sameProductOnly), de 2 o más productos, y cada producto en el
 * PRIMER grupo que lo nombra. Vacío = sin grupos. Tolera config vieja o sucia.
 */
export function nxmGroups(
  config: SeasonalPromoConfig | null | undefined,
): NxmGroup[] {
  const cfg = (config ?? {}) as Partial<NxmConfig>;
  if (!cfg.sameProductOnly || !Array.isArray(cfg.groups)) return [];
  const taken = new Set<string>();
  const out: NxmGroup[] = [];
  for (const item of cfg.groups as unknown[]) {
    const g = (item && typeof item === 'object' ? item : {}) as Record<
      string,
      unknown
    >;
    const ids: string[] = [];
    for (const raw of Array.isArray(g.productIds) ? g.productIds : []) {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (id && !taken.has(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length < 2) continue;
    ids.forEach((id) => taken.add(id));
    out.push({
      name: typeof g.name === 'string' ? g.name.trim() : '',
      productIds: ids,
    });
  }
  return out;
}

/** Grupo (o null) en el que un producto se combina con otros dentro de la promoción. */
export function nxmGroupOf(
  productId: string,
  config: SeasonalPromoConfig | null | undefined,
): NxmGroup | null {
  return (
    nxmGroups(config).find((g) => g.productIds.includes(productId)) ?? null
  );
}

/**
 * Conjuntos de renglones que cuentan JUNTOS en un "lleva N, paga M" de piezas
 * idénticas: cada grupo configurado y, fuera de grupos, cada renglón por
 * separado. En el orden en que aparecen en el carrito.
 */
function nxmPools(candidates: Work[], groups: NxmGroup[]): Work[][] {
  if (groups.length === 0) return candidates.map((w) => [w]);
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.productIds.forEach((id) => groupOf.set(id, i)));
  const pools: Work[][] = [];
  const poolOfGroup = new Map<number, Work[]>();
  for (const w of candidates) {
    const g = groupOf.get(w.line.productId);
    if (g === undefined) {
      pools.push([w]);
      continue;
    }
    let pool = poolOfGroup.get(g);
    if (!pool) {
      pool = [];
      poolOfGroup.set(g, pool);
      pools.push(pool);
    }
    pool.push(w);
  }
  return pools;
}

/**
 * El conjunto entra a la promoción y sus `toFree` piezas MÁS BARATAS salen
 * gratis (a igual precio, por id de producto: mismo resultado en la terminal y
 * en el servidor). Regresa las piezas liberadas y lo que valían.
 */
function freeCheapest(
  pool: Work[],
  toFree: number,
  promo: SeasonalPromotionDef,
): { units: number; discount: number } {
  let left = toFree;
  let units = 0;
  let discount = 0;
  const byPrice = [...pool].sort(
    (a, b) =>
      a.line.unitPrice - b.line.unitPrice ||
      a.line.productId.localeCompare(b.line.productId),
  );
  for (const w of byPrice) {
    w.consumed = true;
    w.promo = promo;
    if (left <= 0) continue;
    const f = Math.min(left, w.line.quantity);
    left -= f;
    w.free = f;
    w.discount = roundMoney(f * w.line.unitPrice);
    units += f;
    discount += w.discount;
  }
  return { units, discount };
}

// --- motor ------------------------------------------------------------------

/**
 * Aplica las promociones vigentes al carrito. `promotions` puede traer todas las
 * promociones conocidas: aquí se filtran por canal, país y hora local, y se
 * evalúan por prioridad (menor primero) y luego por código.
 */
export function applySeasonalPromotions(
  lines: SeasonalEngineLine[],
  promotions: SeasonalPromotionDef[],
  ctx: SeasonalEngineContext,
): SeasonalEngineResult {
  const work: Work[] = lines.map((line) => {
    const quantity = asInt(line.quantity);
    return {
      line: { ...line, quantity },
      consumed:
        !!line.excluded || quantity <= 0 || !(Number(line.unitPrice) > 0),
      free: 0,
      discount: 0,
      promo: null,
    };
  });
  const active = promotions
    .filter((p) => isPromotionActive(p, ctx))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

  const gifts: SeasonalEngineGift[] = [];
  const applied: SeasonalEngineApplied[] = [];

  for (const promo of active) {
    const eligible = new Set(promo.eligibleProductIds);

    if (promo.type === 'gift_with_purchase') {
      // Cuenta renglones elegibles (consumidos por otra promo o no): "compra N y llévate…".
      const pool = work.filter(
        (w) => eligible.has(w.line.productId) && !w.line.excluded,
      );
      const units = pool.reduce((s, w) => s + w.line.quantity, 0);
      const amount = pool.reduce(
        (s, w) =>
          s +
          w.line.unitPrice * Math.max(0, w.line.quantity - w.free) -
          (w.free > 0 ? 0 : w.discount),
        0,
      );
      const cfg = promo.config as GiftWithPurchaseConfig;
      const minQty =
        cfg.minQuantity != null && cfg.minQuantity > 0
          ? asInt(cfg.minQuantity)
          : null;
      const minAmt =
        cfg.minAmount != null && cfg.minAmount > 0
          ? Number(cfg.minAmount)
          : null;
      if ((minQty == null && minAmt == null) || promo.gifts.length === 0) {
        continue;
      }
      const qtyTimes =
        minQty == null
          ? Number.POSITIVE_INFINITY
          : units >= minQty
            ? cfg.repeat
              ? Math.floor(units / minQty)
              : 1
            : 0;
      const amtTimes =
        minAmt == null
          ? Number.POSITIVE_INFINITY
          : amount >= minAmt
            ? cfg.repeat
              ? Math.floor(amount / minAmt)
              : 1
            : 0;
      const times = capTimes(Math.min(qtyTimes, amtTimes), promo.maxPerSale);
      if (!(times > 0) || !Number.isFinite(times)) continue;
      let giftUnits = 0;
      for (const g of promo.gifts) {
        const qty = asInt(g.quantity) * times;
        if (qty <= 0) continue;
        giftUnits += qty;
        gifts.push({
          productId: g.productId,
          quantity: qty,
          promotionId: promo.id,
          promoCode: promo.code,
          promoName: promo.name,
          seasonId: promo.seasonId,
        });
      }
      if (giftUnits > 0) {
        pushApplied(applied, promo, {
          times,
          discountAmount: 0,
          freeUnits: 0,
          giftUnits,
        });
      }
      continue;
    }

    const candidates = work.filter(
      (w) => !w.consumed && eligible.has(w.line.productId),
    );
    if (candidates.length === 0) continue;

    if (promo.type === 'nxm') {
      const cfg = promo.config as NxmConfig;
      const buy = asInt(cfg.buy);
      const pay = asInt(cfg.pay);
      if (buy <= 1 || pay < 1 || pay >= buy) continue;
      const freePerGroup = buy - pay;
      let groupsLeft =
        promo.maxPerSale != null && promo.maxPerSale > 0
          ? promo.maxPerSale
          : Number.POSITIVE_INFINITY;
      let freeUnits = 0;
      let discount = 0;
      let groupsTotal = 0;
      // Qué cuenta junto: con piezas idénticas, cada renglón por separado y
      // cada GRUPO configurado como un solo conjunto; si no, todos los
      // renglones. Un conjunto que no completa N piezas no se consume (queda
      // libre para una promoción de menor prioridad).
      const pools = cfg.sameProductOnly
        ? nxmPools(candidates, nxmGroups(cfg))
        : [candidates];
      for (const pool of pools) {
        if (groupsLeft <= 0) break;
        const units = pool.reduce((s, w) => s + w.line.quantity, 0);
        const groups = Math.min(Math.floor(units / buy), groupsLeft);
        if (groups <= 0) continue;
        groupsLeft -= groups;
        groupsTotal += groups;
        // Las piezas gratis son las MÁS BARATAS del conjunto.
        const freed = freeCheapest(pool, groups * freePerGroup, promo);
        freeUnits += freed.units;
        discount += freed.discount;
      }
      if (groupsTotal > 0) {
        pushApplied(applied, promo, {
          times: groupsTotal,
          discountAmount: discount,
          freeUnits,
          giftUnits: 0,
        });
      }
      continue;
    }

    if (promo.type === 'percent_off' || promo.type === 'fixed_price') {
      let unitsLeft =
        promo.maxPerSale != null && promo.maxPerSale > 0
          ? promo.maxPerSale
          : Number.POSITIVE_INFINITY;
      let units = 0;
      let discount = 0;
      for (const w of candidates) {
        if (unitsLeft <= 0) break;
        let perUnit = 0;
        if (promo.type === 'percent_off') {
          const pct = Number((promo.config as PercentOffConfig).percent);
          if (!(pct > 0) || pct > 100) break;
          perUnit = (w.line.unitPrice * pct) / 100;
        } else {
          const fixed = Number(
            (promo.config as FixedPriceConfig).prices?.[ctx.countryCode],
          );
          if (
            !Number.isFinite(fixed) ||
            fixed < 0 ||
            fixed >= w.line.unitPrice
          ) {
            continue;
          }
          perUnit = w.line.unitPrice - fixed;
        }
        const n = Math.min(w.line.quantity, unitsLeft);
        if (n <= 0) continue;
        unitsLeft -= n;
        units += n;
        w.discount = roundMoney(perUnit * n);
        w.consumed = true;
        w.promo = promo;
        discount += w.discount;
      }
      if (units > 0) {
        pushApplied(applied, promo, {
          times: units,
          discountAmount: discount,
          freeUnits: 0,
          giftUnits: 0,
        });
      }
    }
  }

  const out: SeasonalEngineLineResult[] = work.map((w) => {
    const pts = pointsFor(w);
    return {
      key: w.line.key,
      productId: w.line.productId,
      quantity: w.line.quantity,
      unitPrice: w.line.unitPrice,
      paidQuantity: Math.max(0, w.line.quantity - w.free),
      freeQuantity: w.free,
      discountAmount: roundMoney(w.discount),
      points: pts.points,
      businessValue: pts.businessValue,
      promotionId: w.promo?.id ?? null,
      promoCode: w.promo?.code ?? null,
      promoName: w.promo?.name ?? null,
      promoType: w.promo?.type ?? null,
      kitBonusExcluded: !!w.promo?.excludesKitBonus,
    };
  });
  const totalDiscount = roundMoney(
    out.reduce((s, l) => s + l.discountAmount, 0),
  );
  return { lines: out, gifts, applied, totalDiscount };
}

/** Texto corto del tipo para tickets y listados ("3x2", "20% de descuento"…). */
export function seasonalPromoTypeLabel(
  type: SeasonalPromoType,
  config?: SeasonalPromoConfig | null,
): string {
  switch (type) {
    case 'nxm': {
      const c = config as NxmConfig | undefined;
      return c && c.buy && c.pay ? `${c.buy}x${c.pay}` : 'NxM';
    }
    case 'percent_off': {
      const c = config as PercentOffConfig | undefined;
      return c && c.percent ? `${c.percent}% de descuento` : '% de descuento';
    }
    case 'fixed_price':
      return 'Precio especial';
    case 'gift_with_purchase':
      return 'Regalo por compra';
    default:
      return String(type);
  }
}

/**
 * Grupos capturados en el admin, limpios: nombre recortado (obligatorio), ids
 * sin repetir y solo grupos de 2 o más productos (uno solo no combina nada).
 * Lanza si un producto está en dos grupos, si falta el nombre o si se repite.
 */
function normalizeNxmGroups(raw: unknown): NxmGroup[] {
  if (raw == null) return [];
  if (!Array.isArray(raw))
    throw new Error('nxm: "groups" debe ser una lista de grupos');
  const out: NxmGroup[] = [];
  const taken = new Map<string, string>();
  const names = new Set<string>();
  for (const item of raw as unknown[]) {
    const g = (item && typeof item === 'object' ? item : {}) as Record<
      string,
      unknown
    >;
    const ids: string[] = [];
    for (const v of Array.isArray(g.productIds) ? g.productIds : []) {
      const id = typeof v === 'string' ? v.trim() : '';
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length < 2) continue;
    const name = (typeof g.name === 'string' ? g.name : '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NXM_GROUP_NAME_MAX);
    if (!name) throw new Error('nxm: ponle nombre a cada grupo de productos');
    const nameKey = name.toLowerCase();
    if (names.has(nameKey))
      throw new Error(`nxm: hay dos grupos con el nombre "${name}"`);
    names.add(nameKey);
    for (const id of ids) {
      const other = taken.get(id);
      if (other)
        throw new Error(
          `nxm: un producto no puede estar en dos grupos ("${other}" y "${name}")`,
        );
      taken.set(id, name);
    }
    out.push({ name, productIds: ids });
  }
  if (out.length > NXM_MAX_GROUPS)
    throw new Error(`nxm: máximo ${NXM_MAX_GROUPS} grupos por promoción`);
  return out;
}

/**
 * Normaliza y valida la config según el tipo. Regresa la config limpia o lanza
 * Error con el motivo (el controlador lo convierte en 400).
 */
export function normalizeSeasonalPromoConfig(
  type: SeasonalPromoType,
  raw: unknown,
): SeasonalPromoConfig {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  switch (type) {
    case 'nxm': {
      const buy = asInt(cfg.buy);
      const pay = asInt(cfg.pay);
      if (buy < 2 || buy > 50)
        throw new Error('nxm: "buy" debe ser entre 2 y 50');
      if (pay < 1 || pay >= buy)
        throw new Error('nxm: "pay" debe ser al menos 1 y menor que "buy"');
      const sameProductOnly = cfg.sameProductOnly !== false;
      const groups = sameProductOnly ? normalizeNxmGroups(cfg.groups) : [];
      // Sin grupos la config queda como siempre (sin la llave `groups`).
      return groups.length > 0
        ? { buy, pay, sameProductOnly, groups }
        : { buy, pay, sameProductOnly };
    }
    case 'percent_off': {
      const percent = Number(cfg.percent);
      if (!(percent > 0) || percent > 100)
        throw new Error(
          'percent_off: "percent" debe ser mayor que 0 y hasta 100',
        );
      return { percent: roundMoney(percent) };
    }
    case 'fixed_price': {
      const prices = (
        cfg.prices && typeof cfg.prices === 'object' ? cfg.prices : {}
      ) as Record<string, unknown>;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(prices)) {
        const code = String(k).trim().toUpperCase();
        const price = Number(v);
        if (!code || v === '' || v == null) continue;
        if (!(price >= 0))
          throw new Error(`fixed_price: precio inválido para ${code}`);
        clean[code] = roundMoney(price);
      }
      if (Object.keys(clean).length === 0)
        throw new Error(
          'fixed_price: captura el precio especial de al menos un país',
        );
      return { prices: clean };
    }
    case 'gift_with_purchase': {
      const minQuantity =
        cfg.minQuantity == null || cfg.minQuantity === ''
          ? null
          : asInt(cfg.minQuantity);
      const minAmount =
        cfg.minAmount == null || cfg.minAmount === ''
          ? null
          : roundMoney(Number(cfg.minAmount));
      if (
        (minQuantity == null || minQuantity <= 0) &&
        (minAmount == null || !(minAmount > 0))
      ) {
        throw new Error(
          'gift_with_purchase: indica piezas mínimas o monto mínimo de compra',
        );
      }
      return {
        minQuantity:
          minQuantity != null && minQuantity > 0 ? minQuantity : null,
        minAmount: minAmount != null && minAmount > 0 ? minAmount : null,
        repeat: cfg.repeat === true,
      };
    }
    default:
      throw new Error(`Tipo de promoción desconocido: ${String(type)}`);
  }
}
