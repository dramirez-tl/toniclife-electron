// lib/pickupOrders.ts — Lógica pura de "Pedidos en línea · Recoger en
// sucursal" (sin React ni Electron; pruebas en pickupOrders.test.ts). La usan
// la hoja (PickupOrdersSheet), el encabezado y la franja de PosScreen:
// lectura tolerante de lo que manda el API, pestañas, globito y texto de la
// franja, aviso de "llegó uno nuevo", palomeo al surtir, buscador, errores al
// guardar y armado de la hoja que se imprime.

import type { PickupOrderReceiptPayload } from '@/types';
import {
  PICKUP_STATUS_LABELS,
  type AwaitingPaymentOrder,
  type PickupOrder,
  type PickupOrderComponent,
  type PickupOrderDetail,
  type PickupOrderItem,
  type PickupOrdersResponse,
  type PickupOrderStatus,
} from '@/types/pickupOrders';

// ============================================================================
// LECTURA DE LA RESPUESTA DEL API
// ============================================================================
// El POS se programó contra el contrato sin poder llamar al API: aquí se
// toleran números que lleguen como texto, listas ausentes y textos vacíos,
// para que un detalle así no tumbe la sección.

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback = 0): number {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function textOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

const text = (v: unknown): string => textOrNull(v) ?? '';

/** Fila de un pedido (lista o detalle) tal como la usa el POS. */
export function parsePickupOrder(raw: unknown): PickupOrder {
  const r = isObject(raw) ? raw : {};
  const orderNumber = text(r.orderNumber) || text(r.saleNumber);
  return {
    id: text(r.id),
    status: text(r.status) as PickupOrderStatus,
    statusLabel: text(r.statusLabel),
    kind: 'order',
    deliveryMode: 'pickup',
    orderId: text(r.orderId),
    orderNumber,
    saleNumber: text(r.saleNumber) || orderNumber,
    saleTotal: num(r.saleTotal),
    currencyCode: text(r.currencyCode) || 'MXN',
    customerId: textOrNull(r.customerId),
    customerNumber: textOrNull(r.customerNumber),
    customerName: textOrNull(r.customerName),
    recipientName: text(r.recipientName),
    recipientPhone: textOrNull(r.recipientPhone),
    notes: textOrNull(r.notes),
    warehouseNotes: textOrNull(r.warehouseNotes),
    requestedAt: text(r.requestedAt),
    readyAt: textOrNull(r.readyAt),
    readyByName: textOrNull(r.readyByName),
    deliveredAt: textOrNull(r.deliveredAt),
    deliveredByName: textOrNull(r.deliveredByName),
    receivedByName: textOrNull(r.receivedByName),
    handoffTerminal: textOrNull(r.handoffTerminal),
    cancelledAt: textOrNull(r.cancelledAt),
    cancelReason: textOrNull(r.cancelReason),
    itemsCount: num(r.itemsCount),
    itemsUnits: num(r.itemsUnits),
  };
}

function parseComponent(raw: unknown, itemQuantity: number): PickupOrderComponent {
  const r = isObject(raw) ? raw : {};
  const perUnit = num(r.quantityPerUnit, 1);
  return {
    productId: text(r.productId),
    sku: textOrNull(r.sku),
    name: text(r.name) || text(r.sku) || 'Pieza',
    quantityPerUnit: perUnit,
    quantityTotal: num(r.quantityTotal, perUnit * itemQuantity),
  };
}

function parseItem(raw: unknown, index: number): PickupOrderItem {
  const r = isObject(raw) ? raw : {};
  const quantity = num(r.quantity);
  const components = Array.isArray(r.components)
    ? r.components.map((c) => parseComponent(c, quantity))
    : [];
  return {
    // Sin id (no debería pasar) el palomeo usa la posición del renglón.
    id: text(r.id) || `renglon-${index + 1}`,
    productId: text(r.productId),
    productSku: text(r.productSku),
    productName: text(r.productName) || text(r.productSku) || 'Producto',
    productType: textOrNull(r.productType),
    quantity,
    unitPrice: num(r.unitPrice),
    total: num(r.total),
    personalization: textOrNull(r.personalization),
    madeToOrder: r.madeToOrder === true,
    ...(components.length > 0 ? { components } : {}),
  };
}

/** Detalle de un pedido (GET /pos/pickup-orders/:id y respuesta del PATCH). */
export function parsePickupOrderDetail(raw: unknown): PickupOrderDetail {
  if (!isObject(raw)) {
    throw new Error('El servidor respondió algo inesperado al pedir el pedido.');
  }
  return {
    ...parsePickupOrder(raw),
    items: Array.isArray(raw.items) ? raw.items.map(parseItem) : [],
  };
}

function parseAwaitingPayment(raw: unknown): AwaitingPaymentOrder {
  const r = isObject(raw) ? raw : {};
  return {
    orderId: text(r.orderId),
    orderNumber: text(r.orderNumber),
    createdAt: text(r.createdAt),
    expiresAt: textOrNull(r.expiresAt),
    customerNumber: textOrNull(r.customerNumber),
    customerName: textOrNull(r.customerName),
    total: num(r.total),
    currencyCode: text(r.currencyCode) || 'MXN',
    itemsUnits: num(r.itemsUnits),
  };
}

/** Respuesta de GET /pos/pickup-orders. Si faltan los contadores, se cuentan
 *  de la propia lista. */
export function parsePickupOrdersResponse(raw: unknown): PickupOrdersResponse {
  if (!isObject(raw)) {
    throw new Error('El servidor respondió algo inesperado al pedir los pedidos en línea.');
  }
  const orders = (Array.isArray(raw.orders) ? raw.orders : [])
    .map(parsePickupOrder)
    .filter((o) => o.id);
  const awaitingPayment = (
    Array.isArray(raw.awaitingPayment) ? raw.awaitingPayment : []
  )
    .map(parseAwaitingPayment)
    .filter((o) => o.orderId || o.orderNumber);
  const c = isObject(raw.counts) ? raw.counts : {};
  const countOf = (tab: PickupListTab) =>
    orders.filter((o) => pickupTabOf(o.status) === tab).length;
  return {
    branchId: text(raw.branchId),
    stockHold: raw.stockHold === true,
    counts: {
      toPrepare: num(c.toPrepare, countOf('toPrepare')),
      ready: num(c.ready, countOf('ready')),
      awaitingPayment: num(c.awaitingPayment, awaitingPayment.length),
      deliveredRecent: num(
        c.deliveredRecent,
        orders.filter((o) => o.status === 'delivered').length,
      ),
    },
    orders,
    awaitingPayment,
  };
}

// ============================================================================
// PESTAÑAS
// ============================================================================

export type PickupTab = 'toPrepare' | 'ready' | 'done' | 'awaitingPayment';
/** Pestañas que salen de la lista de pedidos pagados. */
export type PickupListTab = Exclude<PickupTab, 'awaitingPayment'>;

export const PICKUP_TABS: ReadonlyArray<{
  id: PickupTab;
  label: string;
  /** Texto cuando la pestaña no tiene pedidos. */
  empty: string;
}> = [
  { id: 'toPrepare', label: 'Por surtir', empty: 'No hay pedidos por surtir.' },
  {
    id: 'ready',
    label: 'Listos para entregar',
    empty: 'No hay pedidos listos para entregar.',
  },
  {
    id: 'done',
    label: 'Entregados',
    empty: 'No hay pedidos entregados ni cancelados en los últimos 7 días.',
  },
  {
    id: 'awaitingPayment',
    label: 'Sin pagar',
    empty: 'No hay pedidos sin pagar.',
  },
];

/**
 * Pestaña de un pedido según su estado. "Por surtir" incluye los que traen
 * producto bajo pedido en elaboración (production). Un estado que esta versión
 * no conozca se deja a la vista en "Por surtir" (la hoja lo muestra sin
 * botones) en lugar de esconderlo.
 */
export function pickupTabOf(status: PickupOrderStatus | string): PickupListTab {
  if (status === 'delivered' || status === 'cancelled') return 'done';
  if (status === 'ready') return 'ready';
  return 'toPrepare';
}

/** Texto del estado: el del POS y, para uno desconocido, el que mande el API. */
export function pickupStatusLabel(
  order: Pick<PickupOrder, 'status' | 'statusLabel'>,
): string {
  return (
    PICKUP_STATUS_LABELS[order.status] ?? (order.statusLabel || order.status || 'Sin estado')
  );
}

const timeOf = (iso?: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export interface PickupGroups {
  toPrepare: PickupOrder[];
  ready: PickupOrder[];
  done: PickupOrder[];
  awaitingPayment: AwaitingPaymentOrder[];
}

/**
 * Reparte los pedidos por pestaña y los ordena:
 *  - Por surtir: primero los que ya se pueden surtir y, entre ellos, el que
 *    se pagó antes (el que lleva más tiempo esperando va arriba).
 *  - Listos: el que lleva más tiempo listo va arriba.
 *  - Entregados (y cancelados) y Sin pagar: lo más reciente arriba.
 */
export function groupPickupOrders(
  data: PickupOrdersResponse | null | undefined,
): PickupGroups {
  const groups: PickupGroups = {
    toPrepare: [],
    ready: [],
    done: [],
    awaitingPayment: [],
  };
  if (!data) return groups;
  for (const o of data.orders) groups[pickupTabOf(o.status)].push(o);
  const waiting = (o: PickupOrder) => (o.status === 'pending' ? 0 : 1);
  groups.toPrepare.sort(
    (a, b) =>
      waiting(a) - waiting(b) || timeOf(a.requestedAt) - timeOf(b.requestedAt),
  );
  groups.ready.sort(
    (a, b) =>
      timeOf(a.readyAt ?? a.requestedAt) - timeOf(b.readyAt ?? b.requestedAt),
  );
  const closedAt = (o: PickupOrder) =>
    timeOf(o.deliveredAt ?? o.cancelledAt ?? o.requestedAt);
  groups.done.sort((a, b) => closedAt(b) - closedAt(a));
  groups.awaitingPayment = [...data.awaitingPayment].sort(
    (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
  );
  return groups;
}

// ============================================================================
// GLOBITO DEL BOTÓN Y FRANJA DE AVISO
// ============================================================================

export interface PickupSummary {
  /** Por surtir ya: pagados que hay que juntar y apartar. Con estos el botón
   *  se pone ámbar y la franja no se puede cerrar. */
  toPrepare: number;
  /** Con producto bajo pedido en elaboración: todavía no se pueden surtir, así
   *  que no encienden la alarma. */
  inProduction: number;
  /** Listos para entregar. */
  ready: number;
  /** Globito del botón: por surtir (con los que siguen en elaboración) +
   *  listos. */
  badge: number;
}

const count = (n: unknown): number =>
  Math.max(0, Math.trunc(typeof n === 'number' && Number.isFinite(n) ? n : 0));

/** Resumen para el encabezado; null = la sección no está disponible (API
 *  anterior o sin acceso) o todavía no carga: no se muestra botón ni franja. */
export function pickupSummary(
  data: PickupOrdersResponse | null | undefined,
): PickupSummary | null {
  if (!data) return null;
  const rows = { pending: 0, production: 0, ready: 0 };
  for (const o of data.orders) {
    if (o.status === 'pending') rows.pending += 1;
    else if (o.status === 'production') rows.production += 1;
    else if (o.status === 'ready') rows.ready += 1;
  }
  // El API cuenta juntos los que ya se pueden surtir y los que siguen en
  // elaboración; aquí se separan para no alarmar por algo que todavía no se
  // puede hacer. Si el contador y la lista no coinciden, gana el mayor: es
  // preferible avisar de más que dejar un pedido sin ver.
  const all = Math.max(count(data.counts?.toPrepare), rows.pending + rows.production);
  const ready = Math.max(count(data.counts?.ready), rows.ready);
  const inProduction = rows.production;
  return { toPrepare: all - inProduction, inProduction, ready, badge: all + ready };
}

/** Texto del globito (cabe en el encabezado). */
export function pickupBadgeText(badge: number): string {
  return badge > 99 ? '99+' : String(badge);
}

const pedidos = (n: number) => (n === 1 ? '1 pedido' : `${n} pedidos`);
const listos = (n: number) => (n === 1 ? 'listo' : 'listos');

type PickupSummaryCounts = Pick<PickupSummary, 'toPrepare' | 'inProduction' | 'ready'>;

/** Texto de la franja; null cuando no hay nada por surtir, en elaboración ni
 *  listo. */
export function pickupBannerText(summary: PickupSummaryCounts): string | null {
  const { toPrepare, inProduction, ready } = summary;
  if (toPrepare > 0 && ready > 0) {
    return `Tienes ${pedidos(toPrepare)} en línea por surtir y ${ready} ${listos(ready)} para entregar.`;
  }
  if (toPrepare > 0) return `Tienes ${pedidos(toPrepare)} en línea por surtir.`;
  if (ready > 0 && inProduction > 0) {
    return `Tienes ${pedidos(ready)} en línea ${listos(ready)} para entregar y ${inProduction} en elaboración.`;
  }
  if (ready > 0) {
    return `Tienes ${pedidos(ready)} en línea ${listos(ready)} para entregar.`;
  }
  if (inProduction > 0) {
    return `Tienes ${pedidos(inProduction)} en línea en elaboración: todavía no se ${inProduction === 1 ? 'surte' : 'surten'}.`;
  }
  return null;
}

/** Texto de ayuda (title) del botón del encabezado. */
export function pickupButtonTitle(summary: PickupSummaryCounts): string {
  const base = 'Pedidos en línea para recoger en sucursal';
  const parts: string[] = [];
  if (summary.toPrepare > 0) parts.push(`${summary.toPrepare} por surtir`);
  if (summary.inProduction > 0) parts.push(`${summary.inProduction} en elaboración`);
  if (summary.ready > 0) {
    parts.push(`${summary.ready} ${listos(summary.ready)} para entregar`);
  }
  return parts.length > 0 ? `${base}: ${parts.join(', ')}` : base;
}

/** Pestaña con la que abre la hoja: donde hay trabajo pendiente (por surtir;
 *  si no hay, los listos para entregar). */
export function defaultPickupTab(
  summary: Pick<PickupSummary, 'toPrepare' | 'ready'> | null | undefined,
): 'toPrepare' | 'ready' {
  if (summary && summary.toPrepare === 0 && summary.ready > 0) return 'ready';
  return 'toPrepare';
}

// ============================================================================
// AVISO "LLEGÓ UNO NUEVO"
// ============================================================================

/**
 * Pedidos que llegaron desde la consulta anterior de la misma sucursal: los
 * que no venían antes y ahora están por surtir (o en elaboración), y los que
 * ya se conocían en elaboración y acaban de quedar por surtir. Vacío en la
 * primera carga (no hay consulta anterior), al cambiar de sucursal y cuando
 * la sección no está disponible.
 *
 * Se compara por pedido y no solo el contador: así no avisa "pedido nuevo"
 * cuando alguien regresa uno de "listo" a "por surtir" (el contador también
 * sube) y sí avisa cuando en el mismo minuto se surtió uno y llegó otro, o
 * cuando termina la elaboración de un producto bajo pedido (el contador queda
 * igual).
 */
export function newPickupOrders(
  prev: PickupOrdersResponse | null | undefined,
  next: PickupOrdersResponse | null | undefined,
): PickupOrder[] {
  if (!prev || !next) return [];
  if (prev.branchId !== next.branchId) return [];
  const before = new Map(prev.orders.map((o) => [o.id, o.status]));
  return next.orders.filter((o) => {
    if (pickupTabOf(o.status) !== 'toPrepare') return false;
    if (!before.has(o.id)) return true;
    return before.get(o.id) === 'production' && o.status === 'pending';
  });
}

/** Textos del aviso (toast) de pedidos nuevos. */
export function newPickupOrdersToast(orders: readonly PickupOrder[]): {
  title: string;
  description: string;
} {
  if (orders.length === 1) {
    const o = orders[0];
    return {
      title: 'Nuevo pedido en línea para recoger',
      description: [
        o.orderNumber,
        pickupBuyerLabel(o),
        unitsLabel(o.itemsUnits),
        o.status === 'production' ? 'en elaboración' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  return {
    title: 'Nuevos pedidos en línea para recoger',
    description: `Llegaron ${orders.length} pedidos por surtir.`,
  };
}

// ============================================================================
// TEXTOS DE UN PEDIDO
// ============================================================================

/** "#132681 Nombre Apellido" (sin número: solo el nombre). */
export function pickupBuyerLabel(order: {
  customerNumber?: string | null;
  customerName?: string | null;
  recipientName?: string | null;
}): string {
  const name = (order.customerName ?? '').trim() || (order.recipientName ?? '').trim();
  return [order.customerNumber ? `#${order.customerNumber}` : '', name]
    .filter(Boolean)
    .join(' ');
}

/** "3 pzas" / "1 pza". */
export function unitsLabel(units: number): string {
  return `${units} ${units === 1 ? 'pza' : 'pzas'}`;
}

/** Nombre con el que arranca "¿Quién recoge?": quien recibe según el pedido
 *  y, si no viene, el comprador. */
export function defaultReceivedBy(
  order: Pick<PickupOrder, 'recipientName' | 'customerName'>,
): string {
  return (order.recipientName ?? '').trim() || (order.customerName ?? '').trim();
}

/** Máximo que acepta el API en receivedByName. */
export const RECEIVED_BY_MAX_LENGTH = 255;

/** Por qué todavía no se puede confirmar la entrega; null = ya se puede. */
export function handoffBlockedReason(
  receivedByName: string,
  identityConfirmed: boolean,
): string | null {
  const name = receivedByName.trim();
  if (name.length < 2) return 'Escribe el nombre de quien recoge.';
  if (name.length > RECEIVED_BY_MAX_LENGTH) {
    return `El nombre de quien recoge no puede pasar de ${RECEIVED_BY_MAX_LENGTH} letras.`;
  }
  if (!identityConfirmed) return 'Marca que confirmaste su identidad.';
  return null;
}

/**
 * "hace un momento" / "hace 12 min" / "hace 3 h" para algo que pasó en las
 * últimas 24 horas; null si pasó antes (se muestra la fecha) o la fecha no
 * sirve.
 */
export function agoLabel(iso: string | null | undefined, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const minutes = Math.floor(Math.max(0, now - t) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return null;
}

// ============================================================================
// PALOMEO AL SURTIR
// ============================================================================
// Cada renglón se palomea al apartarlo. Si el renglón es un kit/paquete/promo
// con piezas, se palomean las piezas y no el kit.

/** Claves de palomeo de un renglón: una por pieza si trae piezas; si no, la
 *  del propio renglón. */
export function pickupItemCheckKeys(item: PickupOrderItem): string[] {
  const components = item.components ?? [];
  if (components.length === 0) return [item.id];
  return components.map((_, index) => pickupComponentCheckKey(item, index));
}

/** Clave de palomeo de la pieza número `index` de un kit. */
function pickupComponentCheckKey(item: PickupOrderItem, index: number): string {
  return `${item.id}::pieza-${index + 1}`;
}

/** Todas las claves de palomeo del pedido. */
export function pickupCheckKeys(items: readonly PickupOrderItem[]): string[] {
  return items.flatMap(pickupItemCheckKeys);
}

/** Avance del palomeo: cuántas casillas van y cuántas son. */
export function pickupCheckProgress(
  items: readonly PickupOrderItem[],
  checked: ReadonlySet<string>,
): { done: number; total: number } {
  const keys = pickupCheckKeys(items);
  return { done: keys.filter((k) => checked.has(k)).length, total: keys.length };
}

/** true cuando todo el pedido está palomeado. Un pedido sin renglones no
 *  tiene nada que palomear y no se bloquea. */
export function isPickupFullyChecked(
  items: readonly PickupOrderItem[],
  checked: ReadonlySet<string>,
): boolean {
  return pickupCheckKeys(items).every((k) => checked.has(k));
}

// ============================================================================
// BUSCADOR
// ============================================================================

/** Minúsculas, sin acentos y con un solo espacio entre palabras. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo que el buscador revisa de un pedido (pagado o sin pagar). */
export interface PickupSearchable {
  orderNumber: string;
  customerName?: string | null;
  customerNumber?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  /** Quién lo recogió (pedidos ya entregados). */
  receivedByName?: string | null;
}

/**
 * ¿El pedido coincide con lo que se escribió? Busca por folio, nombre (del
 * comprador, de quien recoge y de quien ya lo recogió), número de
 * distribuidor y teléfono, sin importar acentos ni mayúsculas. Varias
 * palabras: deben estar todas, en cualquier orden. El teléfono también
 * coincide aunque se escriba con espacios, guiones o paréntesis.
 */
export function matchesPickupSearch(order: PickupSearchable, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const doc = normalizeSearchText(
    [
      order.orderNumber,
      order.customerName,
      order.recipientName,
      order.receivedByName,
      order.customerNumber,
      order.customerNumber ? `#${order.customerNumber}` : '',
      order.recipientPhone,
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (q.split(' ').every((word) => doc.includes(word))) return true;
  // Teléfono escrito con separadores: se comparan solo los dígitos.
  const queryDigits = q.replace(/\D/g, '');
  if (queryDigits.length >= 4 && /^[\d\s()+.-]+$/.test(q)) {
    const phoneDigits = (order.recipientPhone ?? '').replace(/\D/g, '');
    return phoneDigits.includes(queryDigits);
  }
  return false;
}

export function filterPickupOrders<T extends PickupSearchable>(
  orders: readonly T[],
  query: string,
): T[] {
  if (!normalizeSearchText(query)) return [...orders];
  return orders.filter((o) => matchesPickupSearch(o, query));
}

// ============================================================================
// CAMBIOS DE ESTADO
// ============================================================================

/**
 * Deja la lista como queda después de mover un pedido (respuesta del PATCH),
 * para que el globito, la franja y las pestañas cambien al instante sin
 * esperar la siguiente consulta. Los contadores se ajustan por diferencia.
 */
export function applyPickupOrderUpdate(
  data: PickupOrdersResponse,
  updated: PickupOrder,
): PickupOrdersResponse {
  const previous = data.orders.find((o) => o.id === updated.id);
  if (!previous) return data;
  // La fila de la lista no lleva los renglones del detalle.
  const row: PickupOrder & { items?: unknown } = { ...updated };
  delete row.items;
  const counts = { ...data.counts };
  const bump = (status: string, by: number) => {
    const tab = pickupTabOf(status);
    if (tab === 'toPrepare') counts.toPrepare = Math.max(0, counts.toPrepare + by);
    else if (tab === 'ready') counts.ready = Math.max(0, counts.ready + by);
    else if (status === 'delivered') {
      counts.deliveredRecent = Math.max(0, counts.deliveredRecent + by);
    }
  };
  bump(previous.status, -1);
  bump(updated.status, 1);
  return {
    ...data,
    counts,
    orders: data.orders.map((o) => (o.id === updated.id ? row : o)),
  };
}

export interface PickupPatchError {
  /** conflict = 409 (cambió mientras lo veías); rejected = el API no lo
   *  permite (400/403/404); network = el servidor no respondió (red caída o
   *  tardó demasiado); other = lo demás. */
  kind: 'conflict' | 'rejected' | 'network' | 'other';
  /** Texto para el aviso al cajero. */
  message: string;
}

/** Aviso para el cajero cuando falla el cambio de estado de un pedido. */
export function describePickupPatchError(err: unknown): PickupPatchError {
  const e = (err ?? {}) as {
    isAxiosError?: boolean;
    response?: { status?: number };
  };
  const status = e.response?.status;
  if (status === 409) {
    return {
      kind: 'conflict',
      message: 'El pedido cambió mientras lo veías; ya se actualizó.',
    };
  }
  if (status === undefined) {
    // Petición sin respuesta = red caída o servidor lento. Cualquier otra
    // falla sin respuesta es del propio POS y no se le achaca a la conexión.
    return e.isAxiosError === true
      ? {
          kind: 'network',
          message: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.',
        }
      : { kind: 'other', message: 'No se pudo guardar. Intenta de nuevo.' };
  }
  const apiMessage = apiMessageOf(err);
  if (status === 400 || status === 403 || status === 404) {
    return {
      kind: 'rejected',
      message:
        apiMessage ||
        (status === 404
          ? 'Este pedido ya no está disponible.'
          : 'El servidor no permitió el cambio.'),
    };
  }
  if (status >= 500) {
    // Un 5xx trae textos técnicos (o la página del proxy): no se muestran.
    return {
      kind: 'other',
      message: 'No se pudo guardar por un error del servidor. Intenta de nuevo.',
    };
  }
  return {
    kind: 'other',
    message: apiMessage || 'No se pudo guardar. Intenta de nuevo.',
  };
}

/** `message` de la respuesta de error del API (texto o arreglo de textos del
 *  ValidationPipe); '' si no trae uno que se pueda mostrar. */
function apiMessageOf(err: unknown): string {
  const data = (err as { response?: { data?: unknown } } | null | undefined)
    ?.response?.data;
  const message = isObject(data) ? data.message : data;
  if (Array.isArray(message)) {
    return message
      .map((m) => String(m).trim())
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof message !== 'string') return '';
  const t = message.trim();
  // Una página HTML del proxy o un texto enorme no son un aviso para el cajero.
  return t && !t.startsWith('<') && t.length <= 300 ? t : '';
}

// ============================================================================
// HOJA QUE SE IMPRIME
// ============================================================================

/** Hoja de un pedido: de surtido ('picking') o comprobante de entrega
 *  ('handoff'). */
export type PickupReceiptMode = PickupOrderReceiptPayload['mode'];

/** Por dónde sale la hoja: a la impresora o a un PDF. */
export type PickupPrintVia = 'print' | 'pdf';

/**
 * Datos de la hoja de surtido ('picking') o del comprobante de entrega
 * ('handoff') de un pedido. El comprobante agrega quién recogió, cuándo, en
 * qué terminal y quién entregó.
 */
export function buildPickupReceiptPayload(
  order: PickupOrderDetail,
  mode: PickupReceiptMode,
  branch: { branchName: string; ticketName?: string | null },
): PickupOrderReceiptPayload {
  const customerName =
    (order.customerName ?? '').trim() || (order.recipientName ?? '').trim();
  const recipient = (order.recipientName ?? '').trim();
  // "Recoge" solo se imprime si es otra persona que el comprador.
  const otherRecipient =
    !!recipient &&
    normalizeSearchText(recipient) !== normalizeSearchText(customerName);
  const items = order.items.map((it) => ({
    sku: it.productSku || undefined,
    name: it.productName,
    quantity: it.quantity,
    ...(it.madeToOrder ? { madeToOrder: true } : {}),
    ...(it.personalization ? { personalization: it.personalization } : {}),
    ...(it.components && it.components.length > 0
      ? {
          components: it.components.map((c) => ({
            sku: c.sku || undefined,
            name: c.name,
            quantity: c.quantityTotal,
          })),
        }
      : {}),
  }));
  const payload: PickupOrderReceiptPayload = {
    branchName: branch.branchName,
    ticketName: branch.ticketName || undefined,
    mode,
    orderNumber: order.orderNumber,
    statusLabel: pickupStatusLabel(order),
    customerName: customerName || undefined,
    customerNumber: order.customerNumber ?? undefined,
    recipientName: otherRecipient ? recipient : undefined,
    phone: order.recipientPhone ?? undefined,
    paidAt: order.requestedAt || undefined,
    buyerNotes: order.notes ?? undefined,
    items,
    totalUnits:
      items.length > 0
        ? items.reduce((sum, it) => sum + it.quantity, 0)
        : order.itemsUnits,
    branchNotes: order.warehouseNotes ?? undefined,
  };
  if (mode === 'handoff') {
    payload.receivedByName = order.receivedByName ?? undefined;
    payload.deliveredAt = order.deliveredAt ?? undefined;
    payload.deliveredByName = order.deliveredByName ?? undefined;
    payload.handoffTerminal = order.handoffTerminal ?? undefined;
  }
  return payload;
}
