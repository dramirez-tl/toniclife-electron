// types/deliveries.ts — Entregas a domicilio de ventas POS (API mig 161).
// Call Center (modo staff) confirma destinatario, teléfono y domicilio al
// cobrar; la entrega viaja dentro de POST /pos/sales (delivery) y Almacén la
// surte desde el admin. Aquí también viven los domicilios guardados del
// cliente (GET/POST/PATCH /customers/:id/addresses).

export type PosDeliveryStatus =
  | 'pending'
  | 'ready'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export const DELIVERY_STATUS_LABELS: Record<PosDeliveryStatus, string> = {
  pending: 'Pendiente de surtir',
  ready: 'Listo para envío',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

/** Lo que se manda dentro de CreateSaleInput.delivery (CreateSaleDeliveryDto). */
export interface CreateSaleDeliveryInput {
  recipientName: string;
  recipientPhone?: string;
  /** Dirección guardada del cliente a copiar (gana sobre los campos sueltos). */
  addressId?: string;
  street?: string;
  extNumber?: string;
  intNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  countryId?: string;
  reference?: string;
  notes?: string;
  fulfillBranchId?: string;
}

/** Borrador confirmado en el POS antes de cobrar (vive en PosScreen). */
export interface DeliveryDraft extends CreateSaleDeliveryInput {
  /** Cliente para el que se confirmó: si cambia el cliente, el borrador no aplica. */
  customerId: string;
  /** Domicilio en una línea para mostrar en el carrito. */
  addressText: string;
}

/** Dirección guardada del cliente (AddressResponseDto del API). */
export interface CustomerAddress {
  id: string;
  customerId: string;
  type: string;
  alias: string | null;
  street: string | null;
  exteriorNumber: string | null;
  interiorNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryId: string | null;
  phone: string | null;
  reference: string | null;
  isDefault: boolean;
  isActive: boolean;
}

/** Payload de POST/PATCH /customers/:id/addresses (CreateAddressDto). */
export interface CustomerAddressInput {
  alias?: string;
  street?: string;
  exteriorNumber?: string;
  interiorNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryId?: string;
  reference?: string;
  isDefault?: boolean;
}

/** Datos de contacto del cliente (GET /customers/:id, recortado). */
export interface CustomerContact {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  countryId: string | null;
}

/** Fila de GET /pos/deliveries (DeliveryDto del API, recortado a lo que usa el POS). */
export interface PosDelivery {
  id: string;
  status: PosDeliveryStatus;
  statusLabel: string;
  saleId: string;
  saleNumber: string;
  saleStatus: string;
  saleCreatedAt: string;
  saleTotal: number;
  currencyCode: string;
  customerNumber: string | null;
  customerName: string | null;
  recipientName: string;
  recipientPhone: string | null;
  addressText: string;
  reference: string | null;
  notes: string | null;
  warehouseNotes: string | null;
  fulfillBranchCode: string;
  fulfillBranchName: string;
  carrier: string | null;
  trackingNumber: string | null;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  readyAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  itemsCount: number;
  itemsUnits: number;
}

export interface PosDeliveryList {
  data: PosDelivery[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<PosDeliveryStatus, number>;
}
