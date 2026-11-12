// pickupOrders.test.ts - "Pedidos en línea · Recoger en sucursal"
// (11-nov-2026): lectura de la respuesta del API, pestañas, globito y franja,
// aviso de pedido nuevo, palomeo al surtir, buscador, errores al guardar y la
// hoja que se imprime.

import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  applyPickupOrderUpdate,
  buildPickupReceiptPayload,
  defaultPickupTab,
  defaultReceivedBy,
  describePickupPatchError,
  filterPickupOrders,
  groupPickupOrders,
  handoffBlockedReason,
  isPickupFullyChecked,
  matchesPickupSearch,
  newPickupOrders,
  newPickupOrdersToast,
  normalizeSearchText,
  parsePickupOrderDetail,
  parsePickupOrdersResponse,
  pickupBadgeText,
  pickupBannerText,
  pickupBuyerLabel,
  pickupButtonTitle,
  pickupCheckKeys,
  pickupCheckProgress,
  pickupItemCheckKeys,
  pickupStatusLabel,
  pickupSummary,
  pickupTabOf,
  unitsLabel,
} from './pickupOrders';
import type {
  PickupOrder,
  PickupOrderDetail,
  PickupOrderItem,
  PickupOrdersResponse,
} from '@/types/pickupOrders';

const order = (over: Partial<PickupOrder> = {}): PickupOrder => ({
  id: 'e-1',
  status: 'pending',
  statusLabel: 'Por surtir',
  kind: 'order',
  deliveryMode: 'pickup',
  orderId: 'o-1',
  orderNumber: 'TL2611110001',
  saleNumber: 'TL2611110001',
  saleTotal: 1197,
  currencyCode: 'MXN',
  customerId: 'c-1',
  customerNumber: '132681',
  customerName: 'María Pérez Núñez',
  recipientName: 'María Pérez Núñez',
  recipientPhone: '+52 477 123 4567',
  notes: null,
  warehouseNotes: null,
  // 11-nov-2026 13:13 hora Centro
  requestedAt: '2026-11-11T19:13:00.000Z',
  readyAt: null,
  readyByName: null,
  deliveredAt: null,
  deliveredByName: null,
  receivedByName: null,
  handoffTerminal: null,
  cancelledAt: null,
  cancelReason: null,
  itemsCount: 2,
  itemsUnits: 3,
  ...over,
});

const item = (over: Partial<PickupOrderItem> = {}): PickupOrderItem => ({
  id: 'r-1',
  productId: 'p-1',
  productSku: '8012',
  productName: 'TONIC LIFE',
  productType: 'simple',
  quantity: 2,
  unitPrice: 399,
  total: 798,
  ...over,
});

const KIT = item({
  id: 'r-2',
  productId: 'p-kit',
  productSku: 'KPM13',
  productName: 'KIT PREMIUM',
  productType: 'kit',
  quantity: 1,
  unitPrice: 399,
  total: 399,
  components: [
    { productId: 'p-9', sku: '9019', name: 'JIMMY COFFEE', quantityPerUnit: 2, quantityTotal: 2 },
    { productId: 'p-1', sku: '8012', name: 'TONIC LIFE', quantityPerUnit: 1, quantityTotal: 1 },
  ],
});

const detail = (over: Partial<PickupOrderDetail> = {}): PickupOrderDetail => ({
  ...order(),
  items: [item(), KIT],
  ...over,
});

const response = (
  orders: PickupOrder[],
  over: Partial<PickupOrdersResponse> = {},
): PickupOrdersResponse => ({
  branchId: 'b-427',
  stockHold: true,
  counts: {
    toPrepare: orders.filter((o) => o.status === 'pending' || o.status === 'production').length,
    ready: orders.filter((o) => o.status === 'ready').length,
    awaitingPayment: 0,
    deliveredRecent: orders.filter((o) => o.status === 'delivered').length,
  },
  orders,
  awaitingPayment: [],
  ...over,
});

describe('lectura de la respuesta del API', () => {
  it('lee la respuesta del contrato tal cual', () => {
    const parsed = parsePickupOrdersResponse({
      branchId: 'b-427',
      stockHold: true,
      counts: { toPrepare: 1, ready: 2, awaitingPayment: 1, deliveredRecent: 3 },
      orders: [order()],
      awaitingPayment: [
        {
          orderId: 'o-9',
          orderNumber: 'TL2611110002',
          createdAt: '2026-11-11T20:00:00.000Z',
          expiresAt: '2026-11-12T20:00:00.000Z',
          customerNumber: '132681',
          customerName: 'Nombre Apellido',
          total: 435,
          currencyCode: 'MXN',
          itemsUnits: 1,
        },
      ],
    });
    expect(parsed.counts).toEqual({ toPrepare: 1, ready: 2, awaitingPayment: 1, deliveredRecent: 3 });
    expect(parsed.orders).toEqual([order()]);
    expect(parsed.awaitingPayment[0].orderNumber).toBe('TL2611110002');
    expect(parsed.stockHold).toBe(true);
  });

  it('tolera números como texto, listas ausentes y filas sin id', () => {
    const parsed = parsePickupOrdersResponse({
      branchId: 'b-427',
      orders: [
        { ...order(), saleTotal: '1197.00', itemsUnits: '3', customerName: '  ' },
        { ...order({ id: 'e-2', status: 'ready' }) },
        { ...order(), id: '' },
      ],
    });
    expect(parsed.orders).toHaveLength(2);
    expect(parsed.orders[0].saleTotal).toBe(1197);
    expect(parsed.orders[0].itemsUnits).toBe(3);
    expect(parsed.orders[0].customerName).toBeNull();
    expect(parsed.awaitingPayment).toEqual([]);
    expect(parsed.stockHold).toBe(false);
    // Sin contadores se cuentan de la lista.
    expect(parsed.counts).toEqual({ toPrepare: 1, ready: 1, awaitingPayment: 0, deliveredRecent: 0 });
  });

  it('una respuesta que no es un objeto es un error (se conserva el último dato bueno)', () => {
    expect(() => parsePickupOrdersResponse('<html>')).toThrow();
    expect(() => parsePickupOrdersResponse(null)).toThrow();
    expect(() => parsePickupOrderDetail(undefined)).toThrow();
  });

  it('lee el detalle con sus renglones y calcula las piezas del kit si faltan', () => {
    const parsed = parsePickupOrderDetail({
      ...order(),
      items: [
        { id: 'r-1', productId: 'p-1', productSku: '8012', productName: 'TONIC LIFE', quantity: '2', unitPrice: '399', total: '798' },
        {
          id: 'r-2',
          productId: 'p-kit',
          productSku: 'KPM13',
          productName: 'KIT PREMIUM',
          productType: 'kit',
          quantity: 3,
          unitPrice: 399,
          total: 1197,
          madeToOrder: true,
          personalization: 'Talla 26',
          components: [{ productId: 'p-9', sku: '9019', name: 'JIMMY COFFEE', quantityPerUnit: 2 }],
        },
      ],
    });
    expect(parsed.items[0]).toMatchObject({ quantity: 2, unitPrice: 399, total: 798, madeToOrder: false });
    expect(parsed.items[0].components).toBeUndefined();
    expect(parsed.items[1].components).toEqual([
      { productId: 'p-9', sku: '9019', name: 'JIMMY COFFEE', quantityPerUnit: 2, quantityTotal: 6 },
    ]);
    expect(parsed.items[1]).toMatchObject({ madeToOrder: true, personalization: 'Talla 26' });
  });

  it('un detalle sin renglones queda con la lista vacía', () => {
    expect(parsePickupOrderDetail({ ...order() }).items).toEqual([]);
  });
});

describe('pestañas', () => {
  it('reparte por estado: en elaboración cuenta como por surtir; cancelado va con los entregados', () => {
    expect(pickupTabOf('pending')).toBe('toPrepare');
    expect(pickupTabOf('production')).toBe('toPrepare');
    expect(pickupTabOf('ready')).toBe('ready');
    expect(pickupTabOf('delivered')).toBe('done');
    expect(pickupTabOf('cancelled')).toBe('done');
  });

  it('un estado desconocido se deja a la vista en por surtir', () => {
    expect(pickupTabOf('empacando')).toBe('toPrepare');
    expect(pickupStatusLabel({ status: 'empacando' as never, statusLabel: 'Empacando' })).toBe('Empacando');
    expect(pickupStatusLabel({ status: 'pending', statusLabel: 'Pendiente' })).toBe('Por surtir');
  });

  it('ordena: por surtir el más antiguo arriba y los de elaboración al final', () => {
    const groups = groupPickupOrders(
      response([
        order({ id: 'nuevo', requestedAt: '2026-11-11T19:00:00.000Z' }),
        order({ id: 'elaboracion', status: 'production', requestedAt: '2026-11-10T10:00:00.000Z' }),
        order({ id: 'viejo', requestedAt: '2026-11-11T15:00:00.000Z' }),
        order({ id: 'listo-2', status: 'ready', readyAt: '2026-11-11T18:00:00.000Z' }),
        order({ id: 'listo-1', status: 'ready', readyAt: '2026-11-11T16:00:00.000Z' }),
        order({ id: 'entregado', status: 'delivered', deliveredAt: '2026-11-09T16:00:00.000Z' }),
        order({ id: 'cancelado', status: 'cancelled', cancelledAt: '2026-11-10T16:00:00.000Z' }),
      ]),
    );
    expect(groups.toPrepare.map((o) => o.id)).toEqual(['viejo', 'nuevo', 'elaboracion']);
    expect(groups.ready.map((o) => o.id)).toEqual(['listo-1', 'listo-2']);
    // Entregados y cancelados: lo más reciente arriba.
    expect(groups.done.map((o) => o.id)).toEqual(['cancelado', 'entregado']);
  });

  it('sin datos (cargando o sección no disponible) todas las pestañas quedan vacías', () => {
    expect(groupPickupOrders(null)).toEqual({ toPrepare: [], ready: [], done: [], awaitingPayment: [] });
    expect(groupPickupOrders(undefined).toPrepare).toEqual([]);
  });

  it('sin pagar: lo más reciente arriba', () => {
    const base = { customerNumber: null, customerName: 'X', total: 1, currencyCode: 'MXN', itemsUnits: 1, expiresAt: null };
    const groups = groupPickupOrders(
      response([], {
        awaitingPayment: [
          { ...base, orderId: 'a', orderNumber: 'TL1', createdAt: '2026-11-11T10:00:00.000Z' },
          { ...base, orderId: 'b', orderNumber: 'TL2', createdAt: '2026-11-11T12:00:00.000Z' },
        ],
      }),
    );
    expect(groups.awaitingPayment.map((o) => o.orderId)).toEqual(['b', 'a']);
  });
});

describe('globito del botón y franja', () => {
  it('null cuando la sección no está disponible o no ha cargado', () => {
    expect(pickupSummary(null)).toBeNull();
    expect(pickupSummary(undefined)).toBeNull();
  });

  it('el globito suma por surtir + listos (contadores del API)', () => {
    const data = response([order()], {
      counts: { toPrepare: 2, ready: 1, awaitingPayment: 4, deliveredRecent: 7 },
    });
    expect(pickupSummary(data)).toEqual({ toPrepare: 2, inProduction: 0, ready: 1, badge: 3 });
    expect(pickupBadgeText(3)).toBe('3');
    expect(pickupBadgeText(120)).toBe('99+');
  });

  it('los que siguen en elaboración cuentan en el globito pero no como por surtir', () => {
    const data = response([
      order({ id: 'a' }),
      order({ id: 'b', status: 'production' }),
      order({ id: 'c', status: 'ready' }),
    ]);
    expect(data.counts.toPrepare).toBe(2);
    expect(pickupSummary(data)).toEqual({ toPrepare: 1, inProduction: 1, ready: 1, badge: 3 });
    // Solo en elaboración: nada por surtir todavía (el botón no se pone ámbar).
    expect(pickupSummary(response([order({ status: 'production' })]))).toEqual({
      toPrepare: 0,
      inProduction: 1,
      ready: 0,
      badge: 1,
    });
  });

  it('si el contador del API y la lista no coinciden, no se pierde ningún pedido', () => {
    const orders = [
      order({ id: 'a' }),
      order({ id: 'b', status: 'production' }),
      order({ id: 'c', status: 'ready' }),
    ];
    // Contador que no incluye los de elaboración (o que llegó en ceros).
    expect(
      pickupSummary(response(orders, { counts: { toPrepare: 1, ready: 0, awaitingPayment: 0, deliveredRecent: 0 } })),
    ).toEqual({ toPrepare: 1, inProduction: 1, ready: 1, badge: 3 });
    // Lista recortada: el contador trae más de los que se ven.
    expect(
      pickupSummary(response(orders, { counts: { toPrepare: 6, ready: 4, awaitingPayment: 0, deliveredRecent: 0 } })),
    ).toEqual({ toPrepare: 5, inProduction: 1, ready: 4, badge: 10 });
  });

  it('texto de la franja', () => {
    const n = (toPrepare: number, ready: number, inProduction = 0) => ({ toPrepare, ready, inProduction });
    expect(pickupBannerText(n(2, 1))).toBe(
      'Tienes 2 pedidos en línea por surtir y 1 listo para entregar.',
    );
    expect(pickupBannerText(n(1, 2))).toBe(
      'Tienes 1 pedido en línea por surtir y 2 listos para entregar.',
    );
    expect(pickupBannerText(n(1, 0))).toBe('Tienes 1 pedido en línea por surtir.');
    expect(pickupBannerText(n(0, 1))).toBe('Tienes 1 pedido en línea listo para entregar.');
    expect(pickupBannerText(n(0, 3))).toBe('Tienes 3 pedidos en línea listos para entregar.');
    expect(pickupBannerText(n(0, 0))).toBeNull();
    // Con pedidos en elaboración.
    expect(pickupBannerText(n(0, 0, 1))).toBe(
      'Tienes 1 pedido en línea en elaboración: todavía no se surte.',
    );
    expect(pickupBannerText(n(0, 0, 2))).toBe(
      'Tienes 2 pedidos en línea en elaboración: todavía no se surten.',
    );
    expect(pickupBannerText(n(0, 2, 1))).toBe(
      'Tienes 2 pedidos en línea listos para entregar y 1 en elaboración.',
    );
    expect(pickupBannerText(n(1, 0, 3))).toBe('Tienes 1 pedido en línea por surtir.');
  });

  it('title del botón', () => {
    expect(pickupButtonTitle({ toPrepare: 0, inProduction: 0, ready: 0 })).toBe(
      'Pedidos en línea para recoger en sucursal',
    );
    expect(pickupButtonTitle({ toPrepare: 2, inProduction: 0, ready: 1 })).toBe(
      'Pedidos en línea para recoger en sucursal: 2 por surtir, 1 listo para entregar',
    );
    expect(pickupButtonTitle({ toPrepare: 1, inProduction: 1, ready: 2 })).toBe(
      'Pedidos en línea para recoger en sucursal: 1 por surtir, 1 en elaboración, 2 listos para entregar',
    );
  });

  it('la hoja abre donde hay trabajo', () => {
    expect(defaultPickupTab({ toPrepare: 1, ready: 5 })).toBe('toPrepare');
    expect(defaultPickupTab({ toPrepare: 0, ready: 2 })).toBe('ready');
    expect(defaultPickupTab({ toPrepare: 0, ready: 0 })).toBe('toPrepare');
    expect(defaultPickupTab(null)).toBe('toPrepare');
  });
});

describe('aviso de pedido nuevo', () => {
  const a = order({ id: 'a' });
  const b = order({ id: 'b', orderNumber: 'TL2611110002' });

  it('no avisa en la primera carga ni cuando la sección no está disponible', () => {
    expect(newPickupOrders(undefined, response([a]))).toEqual([]);
    expect(newPickupOrders(null, response([a]))).toEqual([]);
    expect(newPickupOrders(response([a]), null)).toEqual([]);
  });

  it('avisa cuando aparece un pedido por surtir que no venía antes', () => {
    expect(newPickupOrders(response([a]), response([a, b])).map((o) => o.id)).toEqual(['b']);
    expect(newPickupOrders(response([a]), response([a]))).toEqual([]);
  });

  it('avisa aunque el contador quede igual (se surtió uno y llegó otro)', () => {
    const prev = response([a]);
    const next = response([{ ...a, status: 'ready' }, b]);
    expect(prev.counts.toPrepare).toBe(next.counts.toPrepare);
    expect(newPickupOrders(prev, next).map((o) => o.id)).toEqual(['b']);
  });

  it('no avisa cuando uno conocido regresa de listo a por surtir', () => {
    const prev = response([{ ...a, status: 'ready' }]);
    const next = response([a]);
    expect(next.counts.toPrepare).toBeGreaterThan(prev.counts.toPrepare);
    expect(newPickupOrders(prev, next)).toEqual([]);
  });

  it('un pedido nuevo que llega directo a listo o entregado no cuenta como por surtir', () => {
    expect(newPickupOrders(response([a]), response([a, { ...b, status: 'ready' }]))).toEqual([]);
  });

  it('avisa cuando termina la elaboración y el pedido queda por surtir', () => {
    const making = { ...b, status: 'production' as const };
    // Llega en elaboración: se avisa que llegó.
    expect(newPickupOrders(response([a]), response([a, making])).map((o) => o.id)).toEqual(['b']);
    // Sigue en elaboración: nada.
    expect(newPickupOrders(response([a, making]), response([a, making]))).toEqual([]);
    // Ya se puede surtir: se avisa aunque el contador no cambió.
    const prev = response([a, making]);
    const next = response([a, b]);
    expect(prev.counts.toPrepare).toBe(next.counts.toPrepare);
    expect(newPickupOrders(prev, next).map((o) => o.id)).toEqual(['b']);
    expect(newPickupOrdersToast([making]).description).toBe(
      'TL2611110002 · #132681 María Pérez Núñez · 3 pzas · en elaboración',
    );
  });

  it('no avisa al cambiar de sucursal (modo staff)', () => {
    expect(newPickupOrders(response([a]), response([b], { branchId: 'b-otra' }))).toEqual([]);
  });

  it('textos del aviso', () => {
    expect(newPickupOrdersToast([b])).toEqual({
      title: 'Nuevo pedido en línea para recoger',
      description: 'TL2611110002 · #132681 María Pérez Núñez · 3 pzas',
    });
    expect(newPickupOrdersToast([a, b])).toEqual({
      title: 'Nuevos pedidos en línea para recoger',
      description: 'Llegaron 2 pedidos por surtir.',
    });
  });
});

describe('palomeo al surtir', () => {
  const simple = item();

  it('un renglón normal se palomea él; un kit, sus piezas', () => {
    expect(pickupItemCheckKeys(simple)).toEqual(['r-1']);
    expect(pickupItemCheckKeys(KIT)).toEqual(['r-2::pieza-1', 'r-2::pieza-2']);
    expect(pickupCheckKeys([simple, KIT])).toEqual(['r-1', 'r-2::pieza-1', 'r-2::pieza-2']);
  });

  it('un kit sin piezas (prearmado) se palomea como renglón normal', () => {
    expect(pickupItemCheckKeys({ ...KIT, components: [] })).toEqual(['r-2']);
    expect(pickupItemCheckKeys({ ...KIT, components: undefined })).toEqual(['r-2']);
  });

  it('todo palomeado solo cuando están todas las casillas', () => {
    const items = [simple, KIT];
    expect(isPickupFullyChecked(items, new Set())).toBe(false);
    expect(isPickupFullyChecked(items, new Set(['r-1', 'r-2::pieza-1']))).toBe(false);
    // Palomear el kit completo no cuenta: se palomean sus piezas.
    expect(isPickupFullyChecked(items, new Set(['r-1', 'r-2']))).toBe(false);
    expect(isPickupFullyChecked(items, new Set(['r-1', 'r-2::pieza-1', 'r-2::pieza-2']))).toBe(true);
  });

  it('avance del palomeo; las palomas de otro pedido no cuentan', () => {
    expect(pickupCheckProgress([simple, KIT], new Set(['r-1', 'otro']))).toEqual({ done: 1, total: 3 });
  });

  it('un pedido sin renglones no se bloquea', () => {
    expect(isPickupFullyChecked([], new Set())).toBe(true);
    expect(pickupCheckProgress([], new Set())).toEqual({ done: 0, total: 0 });
  });
});

describe('buscador', () => {
  const o = order();

  it('quita acentos, mayúsculas y espacios de más', () => {
    expect(normalizeSearchText('  María   PÉREZ Núñez ')).toBe('maria perez nunez');
  });

  it('busca por folio, nombre, número de distribuidor y teléfono', () => {
    expect(matchesPickupSearch(o, 'tl2611110001')).toBe(true);
    expect(matchesPickupSearch(o, '0001')).toBe(true);
    expect(matchesPickupSearch(o, 'maria perez')).toBe(true);
    expect(matchesPickupSearch(o, 'NUÑEZ')).toBe(true);
    expect(matchesPickupSearch(o, '132681')).toBe(true);
    expect(matchesPickupSearch(o, '#132681')).toBe(true);
    expect(matchesPickupSearch(o, '4771234567')).toBe(true);
    expect(matchesPickupSearch(o, '477-123-4567')).toBe(true);
    expect(matchesPickupSearch(o, '(477) 123 45')).toBe(true);
  });

  it('varias palabras: todas, en cualquier orden', () => {
    expect(matchesPickupSearch(o, 'perez maria')).toBe(true);
    expect(matchesPickupSearch(o, 'maria lopez')).toBe(false);
  });

  it('también encuentra a quien recoge cuando no es el comprador', () => {
    expect(matchesPickupSearch({ ...o, recipientName: 'José Ramírez' }, 'jose ramirez')).toBe(true);
    // Y, ya entregado, a quien lo recogió.
    expect(matchesPickupSearch({ ...o, receivedByName: 'Lucía Robles' }, 'lucia')).toBe(true);
  });

  it('lo que no coincide no aparece; sin texto aparecen todos', () => {
    expect(matchesPickupSearch(o, 'zzz')).toBe(false);
    expect(matchesPickupSearch(o, '9999999999')).toBe(false);
    const all = [o, order({ id: 'e-2', orderNumber: 'TL2611110002', customerName: 'Juan Soto', recipientName: 'Juan Soto', customerNumber: '88197', recipientPhone: null })];
    expect(filterPickupOrders(all, '   ')).toHaveLength(2);
    expect(filterPickupOrders(all, 'soto').map((x) => x.id)).toEqual(['e-2']);
  });

  it('sirve igual con los pedidos sin pagar (no traen teléfono ni quien recoge)', () => {
    const unpaid = {
      orderId: 'o-9',
      orderNumber: 'TL2611110009',
      createdAt: '2026-11-11T20:00:00.000Z',
      expiresAt: null,
      customerNumber: '88197',
      customerName: 'Nancy Ávila',
      total: 435,
      currencyCode: 'MXN',
      itemsUnits: 1,
    };
    expect(filterPickupOrders([unpaid], 'avila')).toHaveLength(1);
    expect(filterPickupOrders([unpaid], '88197')).toHaveLength(1);
    expect(filterPickupOrders([unpaid], '4771234567')).toHaveLength(0);
  });
});

describe('cambios de estado', () => {
  it('mueve el pedido en la lista y ajusta los contadores', () => {
    const data = response([order({ id: 'a' }), order({ id: 'b' })]);
    const next = applyPickupOrderUpdate(data, { ...detail({ id: 'a', status: 'ready', readyAt: '2026-11-11T20:00:00.000Z' }) });
    expect(next.counts.toPrepare).toBe(1);
    expect(next.counts.ready).toBe(1);
    expect(next.orders.find((o) => o.id === 'a')?.status).toBe('ready');
    // La fila de la lista no lleva los renglones del detalle.
    expect(next.orders.find((o) => o.id === 'a')).not.toHaveProperty('items');
    // El original no se toca.
    expect(data.orders[0].status).toBe('pending');
    expect(data.counts.toPrepare).toBe(2);
  });

  it('entregar: sale de listos y entra a entregados', () => {
    const data = response([order({ id: 'a', status: 'ready' })]);
    const next = applyPickupOrderUpdate(data, order({ id: 'a', status: 'delivered' }));
    expect(next.counts).toMatchObject({ toPrepare: 0, ready: 0, deliveredRecent: 1 });
  });

  it('un pedido que no está en la lista no cambia nada', () => {
    const data = response([order({ id: 'a' })]);
    expect(applyPickupOrderUpdate(data, order({ id: 'zzz', status: 'ready' }))).toBe(data);
  });

  const httpError = (status: number, message?: string | string[]) => ({
    isAxiosError: true,
    response: { status, data: message === undefined ? {} : { message } },
  });

  it('409: el pedido cambió mientras lo veías', () => {
    expect(describePickupPatchError(httpError(409, 'Conflicto'))).toEqual({
      kind: 'conflict',
      message: 'El pedido cambió mientras lo veías; ya se actualizó.',
    });
  });

  it('400 y 403: el mensaje del API', () => {
    expect(describePickupPatchError(httpError(400, 'Falta quién recoge el pedido'))).toEqual({
      kind: 'rejected',
      message: 'Falta quién recoge el pedido',
    });
    expect(describePickupPatchError(httpError(403, 'El pedido no es de tu sucursal')).message).toBe(
      'El pedido no es de tu sucursal',
    );
    // ValidationPipe manda un arreglo de textos.
    expect(describePickupPatchError(httpError(400, ['uno', 'dos'])).message).toBe('uno · dos');
    expect(describePickupPatchError(httpError(400)).message).toBe('El servidor no permitió el cambio.');
    expect(describePickupPatchError(httpError(404)).message).toBe('Este pedido ya no está disponible.');
  });

  it('sin respuesta del servidor: revisar la conexión', () => {
    expect(describePickupPatchError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' })).toEqual({
      kind: 'network',
      message: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.',
    });
    expect(describePickupPatchError({ isAxiosError: true, code: 'ECONNABORTED' }).kind).toBe('network');
  });

  it('otros errores no culpan a la conexión', () => {
    expect(describePickupPatchError(new Error('algo raro'))).toEqual({
      kind: 'other',
      message: 'No se pudo guardar. Intenta de nuevo.',
    });
    // Un 5xx no enseña el texto técnico del servidor.
    expect(describePickupPatchError(httpError(500, 'Internal server error'))).toEqual({
      kind: 'other',
      message: 'No se pudo guardar por un error del servidor. Intenta de nuevo.',
    });
    expect(describePickupPatchError({ isAxiosError: true, response: { status: 502, data: '<html>Bad Gateway</html>' } }).message).toBe(
      'No se pudo guardar por un error del servidor. Intenta de nuevo.',
    );
    expect(describePickupPatchError(undefined).kind).toBe('other');
  });
});

describe('textos de un pedido', () => {
  it('comprador con su número', () => {
    expect(pickupBuyerLabel(order())).toBe('#132681 María Pérez Núñez');
    expect(pickupBuyerLabel(order({ customerNumber: null }))).toBe('María Pérez Núñez');
    expect(pickupBuyerLabel(order({ customerName: null, recipientName: 'José Ramírez' }))).toBe(
      '#132681 José Ramírez',
    );
  });

  it('piezas en singular y plural', () => {
    expect(unitsLabel(1)).toBe('1 pza');
    expect(unitsLabel(3)).toBe('3 pzas');
  });

  it('"¿Quién recoge?" arranca con quien recibe y, si no viene, el comprador', () => {
    expect(defaultReceivedBy(order({ recipientName: 'José Ramírez' }))).toBe('José Ramírez');
    expect(defaultReceivedBy(order({ recipientName: '  ' }))).toBe('María Pérez Núñez');
    expect(defaultReceivedBy(order({ recipientName: '', customerName: null }))).toBe('');
  });

  it('la entrega pide nombre y confirmar la identidad', () => {
    expect(handoffBlockedReason('  ', true)).toBe('Escribe el nombre de quien recoge.');
    expect(handoffBlockedReason('José Ramírez', false)).toBe('Marca que confirmaste su identidad.');
    expect(handoffBlockedReason('x'.repeat(256), true)).toContain('255');
    expect(handoffBlockedReason('José Ramírez', true)).toBeNull();
  });

  it('"hace …" para lo de las últimas 24 horas; después, la fecha', () => {
    const now = Date.parse('2026-11-11T20:00:00.000Z');
    expect(agoLabel('2026-11-11T19:59:40.000Z', now)).toBe('hace un momento');
    expect(agoLabel('2026-11-11T19:48:00.000Z', now)).toBe('hace 12 min');
    expect(agoLabel('2026-11-11T17:00:00.000Z', now)).toBe('hace 3 h');
    expect(agoLabel('2026-11-10T19:00:00.000Z', now)).toBeNull();
    // Reloj del equipo atrasado: no dice "hace -3 min".
    expect(agoLabel('2026-11-11T20:03:00.000Z', now)).toBe('hace un momento');
    expect(agoLabel('', now)).toBeNull();
    expect(agoLabel(null, now)).toBeNull();
  });
});

describe('hoja que se imprime', () => {
  const branch = { branchName: 'CEDEA León Centro', ticketName: 'Tonic Life León' };

  it('hoja de surtido: renglones, piezas de los kits y nota del comprador', () => {
    const payload = buildPickupReceiptPayload(
      detail({ notes: 'Paso después de las 5', recipientName: 'José Ramírez' }),
      'picking',
      branch,
    );
    expect(payload).toEqual({
      branchName: 'CEDEA León Centro',
      ticketName: 'Tonic Life León',
      mode: 'picking',
      orderNumber: 'TL2611110001',
      statusLabel: 'Por surtir',
      customerName: 'María Pérez Núñez',
      customerNumber: '132681',
      recipientName: 'José Ramírez',
      phone: '+52 477 123 4567',
      paidAt: '2026-11-11T19:13:00.000Z',
      buyerNotes: 'Paso después de las 5',
      items: [
        { sku: '8012', name: 'TONIC LIFE', quantity: 2 },
        {
          sku: 'KPM13',
          name: 'KIT PREMIUM',
          quantity: 1,
          components: [
            { sku: '9019', name: 'JIMMY COFFEE', quantity: 2 },
            { sku: '8012', name: 'TONIC LIFE', quantity: 1 },
          ],
        },
      ],
      totalUnits: 3,
      branchNotes: undefined,
    });
  });

  it('"Recoge" solo va cuando es otra persona que el comprador', () => {
    expect(buildPickupReceiptPayload(detail(), 'picking', branch).recipientName).toBeUndefined();
    expect(
      buildPickupReceiptPayload(detail({ recipientName: 'MARIA PEREZ NUÑEZ' }), 'picking', branch).recipientName,
    ).toBeUndefined();
  });

  it('bajo pedido y personalización viajan con su renglón', () => {
    const payload = buildPickupReceiptPayload(
      detail({ items: [item({ madeToOrder: true, personalization: 'Talla 26' })] }),
      'picking',
      { branchName: 'Sucursal', ticketName: null },
    );
    expect(payload.items).toEqual([
      { sku: '8012', name: 'TONIC LIFE', quantity: 2, madeToOrder: true, personalization: 'Talla 26' },
    ]);
    expect(payload.ticketName).toBeUndefined();
    expect(payload.totalUnits).toBe(2);
  });

  it('comprobante de entrega: quién recogió, cuándo, terminal y quién entregó', () => {
    const payload = buildPickupReceiptPayload(
      detail({
        status: 'delivered',
        statusLabel: 'Entregado',
        receivedByName: 'José Ramírez',
        deliveredAt: '2026-11-11T22:30:00.000Z',
        deliveredByName: 'Caja León',
        handoffTerminal: 'Caja 1',
        warehouseNotes: 'Recogió con INE',
      }),
      'handoff',
      branch,
    );
    expect(payload).toMatchObject({
      mode: 'handoff',
      statusLabel: 'Entregado',
      receivedByName: 'José Ramírez',
      deliveredAt: '2026-11-11T22:30:00.000Z',
      deliveredByName: 'Caja León',
      handoffTerminal: 'Caja 1',
      branchNotes: 'Recogió con INE',
    });
  });

  it('la hoja de surtido no lleva datos de entrega', () => {
    const payload = buildPickupReceiptPayload(
      detail({ status: 'ready', receivedByName: 'Alguien', handoffTerminal: 'Caja 1' }),
      'picking',
      branch,
    );
    expect(payload.receivedByName).toBeUndefined();
    expect(payload.handoffTerminal).toBeUndefined();
    expect(payload.statusLabel).toBe('Listo para recoger');
  });

  it('sin renglones usa las piezas que reporta el pedido', () => {
    expect(buildPickupReceiptPayload(detail({ items: [], itemsUnits: 4 }), 'picking', branch).totalUnits).toBe(4);
  });
});
