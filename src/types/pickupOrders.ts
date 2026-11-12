// types/pickupOrders.ts — Pedidos de la tienda en línea para RECOGER EN
// SUCURSAL (contrato del 11-nov-2026, rutas /pos/pickup-orders). El comprador
// paga en la tienda y elige la sucursal; aquí la sucursal lo surte (junta y
// aparta las piezas), lo marca "listo para recoger" y lo entrega anotando
// quién lo recogió. Las entregas a domicilio viven en types/deliveries.ts:
// son otra cosa.

/** Estado de la entrega del pedido para la sucursal. */
export type PickupOrderStatus =
  | 'production'
  | 'pending'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export const PICKUP_STATUS_LABELS: Record<PickupOrderStatus, string> = {
  production: 'En elaboración',
  pending: 'Por surtir',
  ready: 'Listo para recoger',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

/** Fila de GET /pos/pickup-orders (misma forma que DeliveryDto del API). */
export interface PickupOrder {
  /** Id de la entrega: el que se usa en las rutas. */
  id: string;
  status: PickupOrderStatus;
  /** Texto del API ("Por surtir", "Listo para recoger", "Entregado"…). */
  statusLabel: string;
  kind: 'order';
  deliveryMode: 'pickup';
  orderId: string;
  /** Folio del pedido (TL2611110001). */
  orderNumber: string;
  /** Igual que orderNumber. */
  saleNumber: string;
  saleTotal: number;
  currencyCode: string;
  customerId: string | null;
  /** Número de distribuidor. */
  customerNumber: string | null;
  customerName: string | null;
  recipientName: string;
  recipientPhone: string | null;
  /** Nota que dejó el comprador. */
  notes: string | null;
  /** Nota de la sucursal. */
  warehouseNotes: string | null;
  /** ISO: cuándo se pagó. */
  requestedAt: string;
  readyAt: string | null;
  readyByName: string | null;
  deliveredAt: string | null;
  deliveredByName: string | null;
  /** Quién recogió (lo captura la sucursal al entregar). */
  receivedByName: string | null;
  /** Terminal que entregó (lo llena el API). */
  handoffTerminal: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Renglones. */
  itemsCount: number;
  /** Piezas. */
  itemsUnits: number;
}

/** Pieza de un kit/paquete/promo del pedido. */
export interface PickupOrderComponent {
  productId: string;
  sku: string | null;
  name: string;
  quantityPerUnit: number;
  /** Piezas a juntar: ya multiplicada por la cantidad del renglón. */
  quantityTotal: number;
}

/** Renglón del pedido (GET /pos/pickup-orders/:id). */
export interface PickupOrderItem {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  /** 'kit' | 'pack' | 'promotional' | … */
  productType: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Texto de personalización que pidió el comprador. */
  personalization?: string | null;
  /** Producto bajo pedido (se elabora aparte). */
  madeToOrder?: boolean;
  /** Piezas del kit/paquete/promo: cuando vienen, se surten las piezas. */
  components?: PickupOrderComponent[];
}

/** Detalle del pedido: la fila más sus renglones. */
export interface PickupOrderDetail extends PickupOrder {
  items: PickupOrderItem[];
}

/** Pedido creado en la tienda que todavía no se paga (no tiene entrega). */
export interface AwaitingPaymentOrder {
  orderId: string;
  orderNumber: string;
  /** ISO. */
  createdAt: string;
  /** ISO: hasta cuándo siguen apartadas las piezas si no se paga. */
  expiresAt: string | null;
  customerNumber: string | null;
  customerName: string | null;
  total: number;
  currencyCode: string;
  itemsUnits: number;
}

export interface PickupOrderCounts {
  /** pending + production. */
  toPrepare: number;
  ready: number;
  awaitingPayment: number;
  deliveredRecent: number;
}

/** Respuesta de GET /pos/pickup-orders. */
export interface PickupOrdersResponse {
  branchId: string;
  /** true = las piezas quedan apartadas hasta entregar; false = ya se
   *  descontaron de las existencias al pagarse. */
  stockHold: boolean;
  counts: PickupOrderCounts;
  /** Abiertos (production, pending, ready) + entregados/cancelados de los
   *  últimos 7 días. */
  orders: PickupOrder[];
  awaitingPayment: AwaitingPaymentOrder[];
}

/** Cuerpo de PATCH /pos/pickup-orders/:id/status. */
export interface UpdatePickupOrderStatusBody {
  /** ready = surtido y apartado; delivered = entregado; pending = regresar a
   *  por surtir (solo desde ready). */
  status: 'ready' | 'delivered' | 'pending';
  /** Quién recogió: obligatorio al entregar (máx. 255). */
  receivedByName?: string;
  /** Nota de la sucursal. */
  notes?: string;
}
