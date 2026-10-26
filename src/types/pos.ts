// POS Types - portados de toniclife-next/src/types/pos.ts
// Mantienen 1:1 con los DTOs del backend (toniclife-api/src/modules/pos/dto/).

// ============================================================================
// ENUMS
// ============================================================================

export enum CashRegisterStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  SUSPENDED = 'suspended',
}

export enum SessionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum PosSaleStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PARTIAL_REFUND = 'partial_refund',
}

export enum PosPaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  TRANSFER = 'transfer',
  CREDIT = 'credit',
  MIXED = 'mixed',
  CASHBACK = 'cashback',
  PROMOTION = 'promotion',
  MERCADO_PAGO = 'mercado_pago',
  USD_CASH = 'usd_cash',
  DEPOSIT = 'deposit',
  UNDEFINED = 'undefined',
}

export enum CashMovementType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

// ============================================================================
// CASH REGISTER
// ============================================================================

export interface CashRegister {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  code: string;
  status: CashRegisterStatus;
  currentSessionId?: string;
  allowNegativeBalance: boolean;
  requireOpeningAmount: boolean;
  autoPrintTicket: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface OpenSessionInput {
  cashRegisterId: string;
  openingAmount: number;
  openingNotes?: string;
  currencyId?: string;
}

// ============================================================================
// SESSION
// ============================================================================

export interface SessionSummary {
  totalSales: number;
  totalCash: number;
  totalCard: number;
  totalTransfer: number;
  totalRefunds: number;
  totalDeposits: number;
  totalWithdrawals: number;
  salesCount: number;
  refundsCount: number;
}

export interface Session {
  id: string;
  cashRegisterId: string;
  cashRegisterName: string;
  branchId: string;
  branchName: string;
  openedBy: string;
  openedByName: string;
  closedBy?: string;
  closedByName?: string;
  openingAmount: number;
  openingNotes?: string;
  expectedClosingAmount?: number;
  actualClosingAmount?: number;
  difference?: number;
  closingNotes?: string;
  summary: SessionSummary;
  openedAt: string;
  closedAt?: string;
  status: SessionStatus;
  currencyId?: string;
  currencyCode?: string;
}

export interface ActiveSession {
  session: Session;
  cashRegister: {
    id: string;
    name: string;
    code: string;
    branchName: string;
  };
}

// ============================================================================
// SALE
// ============================================================================

export interface SaleItem {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  lotId?: string;
  lotNumber?: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  discountPercent?: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  notes?: string;
  points: number;
  businessValue: number;
  /** Tipo del producto vendido (kit | pack | promotional | ...). AUSENTE en
   *  APIs anteriores: la reimpresión entonces consulta el contenido de todos
   *  los productos de la venta. */
  productType?: string;
  /** true = regalo a $0 de una campaña de membresía (lo agregó el servidor;
   *  descuenta existencia). Ausente en APIs anteriores. */
  membershipGift?: boolean;
}

export interface SalePayment {
  id: string;
  paymentMethod: PosPaymentMethod;
  amount: number;
  amountReceived?: number;
  changeGiven?: number;
  cardType?: string;
  cardLast4?: string;
  authorizationCode?: string;
  referenceNumber?: string;
  status: string;
  processedAt: string;
}

export interface Sale {
  id: string;
  saleNumber: string;
  sessionId: string;
  cashRegisterId: string;
  cashRegisterName: string;
  branchId: string;
  branchName: string;
  customerId?: string;
  customerName?: string;
  customerNumber?: string;
  customerRfc?: string;
  sellerId: string;
  sellerName: string;
  /** Canal de captura: 'terminal' = caja de la sucursal; 'usuario' = cuenta
   *  personal (modo staff/call center o admin web). Migradas del legacy
   *  (folio M-%) no aplican. */
  capturedVia?: 'terminal' | 'usuario';
  /** Licencia (terminal POS) que cobró la venta; vacío en modo staff / call
   *  center y en migradas. Etiqueta y clave las resuelve el API. */
  posLicenseId?: string;
  posLicenseLabel?: string;
  posLicenseKey?: string;
  status: PosSaleStatus;
  subtotal: number;
  discountAmount: number;
  discountPercent?: number;
  discountReason?: string;
  taxAmount: number;
  total: number;
  paymentMethod: PosPaymentMethod;
  currencyId?: string;
  currencyCode?: string;
  requiresInvoice: boolean;
  invoiceId?: string;
  invoiceUuid?: string;
  /** Resumen de la factura nominativa viva (GET /pos/sales/:id y respuesta
   *  de POST /pos/sales/:id/stamp): folio, estado y envío por correo. */
  invoice?: InvoiceSummary;
  /** Factura GLOBAL viva que incluye esta venta (pos_sales.global_invoice_id).
   *  Con valor, la venta ya no admite CFDI nominativa. Ausente en APIs
   *  anteriores. */
  globalInvoiceId?: string | null;
  notes?: string;
  cancelledAt?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  itemsCount?: number;
  items: SaleItem[];
  payments: SalePayment[];
  createdAt: string;
  accumulatedPoints?: number;
  /** Entrega a domicilio ligada (mig 161); null = mostrador. Ausente en APIs
   *  anteriores. */
  delivery?: import('./deliveries').SaleDeliverySummary | null;
  /** Campaña de membresía aplicada a la venta (mig 168); null = ninguna.
   *  Ausente en APIs anteriores. */
  membership?: SaleMembership | null;
}

export interface CreateSaleItemInput {
  productId: string;
  quantity: number;
  lotId?: string;
  discountPercent?: number;
  discountAmount?: number;
  notes?: string;
}

export interface CreateSaleInput {
  sessionId: string;
  customerId?: string;
  customerName?: string;
  customerRfc?: string;
  items: CreateSaleItemInput[];
  discountPercent?: number;
  discountAmount?: number;
  discountReason?: string;
  /** Código de cupón (el API lo valida y calcula el descuento server-side). */
  couponCode?: string;
  requiresInvoice?: boolean;
  notes?: string;
  currencyId?: string;
  /**
   * Clave de idempotencia (UUID) por intento de cobro: si el cobro falla por
   * timeout/red y el cajero reintenta, el API devuelve la venta ya creada en
   * vez de duplicarla.
   */
  clientRequestId?: string;
  /** Cola local (2.0.81): hora real de la venta en la caja, solo al sincronizar
   *  una venta guardada sin conexión; el API la registra con esa hora. */
  soldAt?: string;
  /** Cola local: la venta se guardó sin conexión; si ya no hay existencia el
   *  API la acepta de todos modos (el producto ya se entregó) y avisa. */
  queuedOffline?: boolean;
  /** Boletos de evento: asistente/correo al que se mandan (si no, el cliente). */
  attendeeName?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
  /** Entrega a domicilio (mig 161): destinatario y domicilio confirmados por
   *  Call Center; el API la liga a la venta en la misma transacción y Almacén
   *  la surte desde el admin. Ausente = venta de mostrador. */
  delivery?: import('./deliveries').CreateSaleDeliveryInput;
  /** Campaña de membresía que el ticket cumple (GET /pos/membership-campaigns/
   *  offers). El servidor vuelve a validar público, sucursal y puntos; si no
   *  está de acuerdo responde 400 con el motivo en español. */
  membershipCampaignId?: string;
}

export interface CancelSaleInput {
  cancellationReason: string;
  /** Motivo de cancelacion CFDI (si la venta estaba facturada). */
  cfdiMotive?: '01' | '02' | '03' | '04';
}

/** Progreso del distribuidor hacia la calificacion del periodo (3,300 pts). */
export interface CustomerPeriodStats {
  personalPoints: number;
  qualificationThreshold: number;
  status: 'qualified' | 'in_progress' | 'inactive';
  periodName: string | null;
}

export interface DailySalesSummary {
  /** Día del corte; con rango, el "Desde" (compatibilidad con clientes viejos). */
  date: string;
  /** Rango efectivo (días locales de la sucursal) y filtro de caja aplicado.
   *  AUSENTES en APIs anteriores: el corte usa su ausencia para avisar que el
   *  servidor ignoró rango y caja y mostró solo un día. */
  fromDate?: string;
  toDate?: string;
  posLicenseId?: string | null;
  capturedVia?: 'terminal' | 'usuario' | null;
  totalSales: number;
  totalAmount: number;
  totalCash: number;
  totalCard: number;
  totalCredit: number;
  totalTransfer: number;
  totalCashback: number;
  totalPromotion: number;
  totalMercadoPago: number;
  totalUsdCash: number;
  totalDeposit?: number;
  totalMixed: number;
  totalRefunds: number;
  refundsCount: number;
  averageTicket: number;
  itemsSold: number;
  /** Desglose del día por terminal (licencia POS): sucursales con varias
   *  cajas separan su corte. posLicenseId null = sin licencia (modo staff /
   *  call center). Ausente en APIs anteriores. */
  byTerminal?: DailySalesTerminalRow[];
}

export interface DailySalesTerminalRow {
  posLicenseId: string | null;
  label: string | null;
  licenseKey: string | null;
  salesCount: number;
  totalAmount: number;
  cancelledCount: number;
}

// ============================================================================
// PAYMENT
// ============================================================================

export interface CreatePaymentInput {
  paymentMethod: PosPaymentMethod;
  amount: number;
  amountReceived?: number;
  cardType?: string;
  cardLast4?: string;
  authorizationCode?: string;
  terminalId?: string;
  referenceNumber?: string;
  bankName?: string;
  notes?: string;
  currencyId?: string;
}

export interface ProcessPaymentInput {
  saleId: string;
  payments: CreatePaymentInput[];
}

export interface PaymentResult {
  success: boolean;
  saleId: string;
  saleNumber: string;
  totalPaid: number;
  changeGiven: number;
  payments: Array<{
    id: string;
    method: string;
    amount: number;
    status: string;
  }>;
  message?: string;
  /** Saldo de puntos del periodo DESPUÉS de esta venta. */
  accumulatedPoints?: number;
  /** Puntos generados por ESTA venta (API 04-ago-2026+). */
  salePoints?: number;
}

// ============================================================================
// COMPONENTES DE KIT / PAQUETE / PROMO (contenido que se entrega)
// ============================================================================

/** Un renglón del contenido de un kit/paquete/promo. `quantity` es POR
 *  UNIDAD del kit (el ticket la multiplica por la cantidad de la línea).
 *  Viene de GET /pos/products/:id/components, de las promos canjeables
 *  (`items`) o del endpoint público viejo; `code` puede faltar en las
 *  fuentes antiguas. */
export interface KitComponent {
  componentProductId?: string;
  code?: string | null;
  name: string;
  quantity: number;
  sortOrder?: number;
}

// ============================================================================
// POS CART (estado local)
// ============================================================================

export interface PosCartItem {
  productId: string;
  productSku: string;
  productName: string;
  productImage?: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  isIncludedInPrice: boolean;
  discountPercent?: number;
  discountAmount?: number;
  subtotal: number;
  total: number;
  stock?: number;
  points: number;
  businessVolume: number;
  /** Tipo de producto (ej. 'promotional'); usado para retirar promos al cambiar/quitar el distribuidor. */
  productType?: string;
  /** Kit de inscripción real (gate autoritativo): sus puntos NO cuentan para
   *  las campañas de membresía. */
  isEnrollmentKit?: boolean;
  /** Tope de cantidad: para promos = derechos disponibles (default 1). */
  maxQuantity?: number;
  /** Evento del que la clave es boleto (se emiten al cobrar). */
  event?: PosEventInfo;
  /** Productos que incluye (BoM) — para mostrar/imprimir "qué incluye".
   *  undefined = aún no se consultó (PosScreen lo completa en segundo plano
   *  para kit/pack/promocional); [] = se consultó y no tiene contenido. */
  components?: KitComponent[];
  lotId?: string;
  notes?: string;
}

export interface PosCart {
  items: PosCartItem[];
  customerId?: string;
  customerName?: string;
  customerNumber?: string;
  customerRfc?: string;
  /** Correo del cliente asignado (para proponerlo en los boletos de evento). */
  customerEmail?: string;
  /** Correo capturado en caja para los boletos de evento (vacío = el del cliente). */
  attendeeEmail?: string;
  priceTypeId?: string;
  isPublicPrice?: boolean;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  discountReason?: string;
  /** Cupón aplicado (validado server-side). El descuento del cupón NO pasa
   *  por discountAmount: se resta del total SIN recalcular impuestos, para
   *  que el total del cliente coincida exactamente con el de la venta. */
  couponCode?: string;
  couponDiscount?: number;
  couponDescription?: string;
  taxAmount: number;
  total: number;
  totalPoints: number;
  totalBusinessVolume: number;
  requiresInvoice: boolean;
  notes?: string;
  /** Campaña de membresía que el ticket cumple y que viajará al crear la
   *  venta (la fija MembershipOfferBanner); null = ninguna. Se limpia al
   *  vaciar el carrito o cambiar de cliente. */
  membershipCampaignId: string | null;
  /** "Aplicar en esta venta" (default true): apagado = aunque el ticket
   *  califique, no se manda la campaña. */
  applyMembership: boolean;
  /** "Bolsa" de membresía que el cajero eligió desde el catálogo (por código
   *  de campaña): guía el ticket hasta juntar los puntos y bloquea el cobro
   *  mientras no se cumpla. null = sin bolsa. Se limpia al vaciar el carrito. */
  membershipSelectedId: string | null;
}

// ============================================================================
// CAMPAÑAS DE MEMBRESÍA (mig 168) — espejo de membership-campaign.dto.ts
// "Compra N puntos en producto y tu membresía de inscripción es GRATIS".
// ============================================================================

/** Regalo de una campaña (producto a $0 que descuenta existencia). */
export interface PosMembershipOfferGift {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  sortOrder?: number;
  /** false = producto inactivo (no se entregará). */
  productActive?: boolean;
}

/** Campaña que HOY aplica al cliente en la sucursal (ya filtrada por público
 *  y no usada). */
export interface PosMembershipOffer {
  campaignId: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Puntos EN PRODUCTO que debe juntar el ticket (ver lib/membership.ts). */
  minPoints: number;
  /** 'premium' | 'basic' */
  grantPosition: string;
  /** Cupón de primera recompra (%); null = sin cupón. */
  couponPercent: number | null;
  couponValidDays: number;
  gifts: PosMembershipOfferGift[];
  /** Por qué aplica: nuevo (pendiente sin kit) o básico que sube. */
  audience?: 'new' | 'basic' | null;
}

export interface PosMembershipCustomer {
  status: string | null;
  kitType: string | null;
  audience: 'new' | 'basic' | null;
  /** Por qué no aplica ninguna campaña. */
  reason: string | null;
}

/** GET /pos/membership-campaigns/offers. Con un API sin la ruta (404) el
 *  cliente devuelve `{ offers: [], customer: null }`. */
export interface PosMembershipOffersResponse {
  offers: PosMembershipOffer[];
  customer: PosMembershipCustomer | null;
}

export type SaleMembershipStatus = 'pending' | 'applied' | 'reverted' | 'failed';

export interface SaleMembershipGift {
  productId?: string;
  sku: string;
  name: string;
  quantity: number;
  /** false = sin existencia en la sucursal al vender (no se entregó). */
  delivered: boolean;
}

/** Lo que viaja dentro de la venta (`Sale.membership`). */
export interface SaleMembership {
  campaignId: string;
  code: string;
  name: string;
  status: SaleMembershipStatus;
  grantPosition: string;
  pointsCounted: number;
  minPoints: number;
  gifts: SaleMembershipGift[];
  couponCode: string | null;
  couponPercent: number | null;
  /** YYYY-MM-DD */
  couponValidUntil: string | null;
  kitTypeBefore: string | null;
  kitTypeAfter: string | null;
  error: string | null;
}

/** Respuesta de POST /pos/coupons/validate. */
export interface PosCouponValidation {
  valid: boolean;
  reason?: string;
  discount: number;
  coupon?: {
    id: string;
    code: string;
    description: string | null;
    discountType: string;
    discountValue: number;
    employeeOnly: boolean;
  };
}

// ============================================================================
// QUICK PRODUCT
// ============================================================================

/** Evento del que la clave es boleto (GET /products con branchId → `event`). */
export interface PosEventInfo {
  id: string;
  code: string;
  name: string;
  /** YYYY-MM-DD (fecha de negocio, sin zona horaria). */
  eventDate: string;
  startTime?: string | null;
  /** draft | active | closed | cancelled */
  status: string;
  /** Titular / Invitado (se imprime en el boleto). */
  label?: string | null;
  /** Boletos que emite cada unidad vendida. */
  ticketsPerUnit: number;
}

/** POST /pos/sales/:id/tickets/email */
export interface TicketEmailResult {
  sentTo: string;
  tickets: number;
  emailedAt: string;
}

/** Boleto emitido por una venta (GET /pos/sales/:id/tickets). */
export interface SaleEventTicket {
  id: string;
  eventName: string;
  ticketNumber: string;
  label: string | null;
  attendeeName?: string | null;
  attendeeEmail: string | null;
  attendeePhone?: string | null;
  status?: string;
  emailStatus: string;
  /** Último correo al que se envió (puede diferir del asistente tras un reenvío). */
  emailedTo?: string | null;
  /** Página pública del boleto (QR + datos): es el boleto digital que se manda por WhatsApp. */
  publicUrl?: string | null;
  token?: string | null;
}

export interface QuickProduct {
  id: string;
  sku: string;
  name: string;
  slug: string;
  imageUrl?: string;
  basePrice: number;
  categoryName?: string;
  /** Descripción del producto (modal informativo ⓘ del catálogo). */
  description?: string;
  shortName?: string;
  stock?: number;
  isActive: boolean;
  taxRate?: number;
  isIncludedInPrice?: boolean;
  points?: number;
  businessVolume?: number;
  productType?: string;
  kitPosition?: string;
  /** Productos que incluye (BoM) — para promos/kits, mostrar "qué incluye". */
  components?: KitComponent[];
  /** Tope de cantidad en el carrito. Para promos canjeables = derechos
   *  disponibles del distribuidor (availableCount); sin dato, promo = 1. */
  maxQuantity?: number;
  /**
   * TRUE solo para kits de inscripción reales (gate autoritativo, mig 037).
   * Dispara el flujo de enrolamiento de distribuidor en POS.
   */
  isEnrollmentKit?: boolean;
  /** Evento del que la clave es boleto: la tarjeta y el carrito lo marcan. */
  event?: PosEventInfo;
  /**
   * Solo kit/pack: TRUE = se ARMA al vender (descuenta componentes; su `stock`
   * es cuántos se pueden armar en la sucursal, 0 si falta cualquier
   * componente). FALSE = prearmado (su `stock` es la pieza propia).
   */
  kitDeductsInventory?: boolean;
  /**
   * Solo kit/pack que se arma, con sucursal: el componente que limita cuántos
   * se pueden armar (el que menos alcanza). Con stock 0 es "lo que falta".
   */
  limitingComponent?: KitLimitingComponent | null;
}

/** Componente que limita un kit en la sucursal (GET /products?branchId=). */
export interface KitLimitingComponent {
  code: string;
  name: string;
  /** Piezas que pide UN kit. */
  need: number;
  /** Piezas disponibles en la sucursal. */
  available: number;
}

/** GET /pos/reports/sales-by-product — cada producto vendido con el folio de su venta. */
export interface PosProductSaleLine {
  saleId: string;
  saleNumber: string;
  /** Día local de la sucursal (YYYY-MM-DD). */
  saleDate: string;
  /** Hora local (HH:mm). */
  saleTime: string;
  customerNumber: string | null;
  customerName: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  points: number;
  paymentMethod: string;
  sellerName: string;
}

export interface PosProductSalesSummary {
  productId: string;
  productSku: string;
  productName: string;
  salesCount: number;
  units: number;
  amount: number;
  points: number;
  lines: PosProductSaleLine[];
}

export interface PosSalesByProductResponse {
  startDate: string;
  endDate: string;
  branchLabel: string;
  totals: { sales: number; lines: number; units: number; amount: number; points: number };
  products: PosProductSalesSummary[];
}

/** GET /pos/kits/:id/availability — desglose por componente en la sucursal. */
export interface PosKitAvailability {
  productId: string;
  code: string;
  branchId: string;
  sellable: number;
  stockMode: 'assemble_on_sale' | 'prebuilt';
  reason: 'recipe_empty' | 'component_inactive' | null;
  components: Array<{
    code: string;
    name: string;
    perKit: number;
    available: number;
    missing: number;
  }>;
}

// ============================================================================
// CASH MOVEMENTS (depositos / retiros)
// ============================================================================

export interface CreateCashMovementInput {
  sessionId: string;
  movementType: CashMovementType; // deposit | withdrawal
  amount: number;
  description: string;
  reference?: string;
}

export interface CashMovement {
  id: string;
  sessionId: string;
  movementType: string; // sale | refund | deposit | withdrawal | adjustment
  saleId?: string;
  saleNumber?: string;
  amount: number;
  direction: 'in' | 'out';
  balanceAfter?: number;
  description?: string;
  reference?: string;
  createdBy: string;
  createdByName: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface CashBalance {
  sessionId: string;
  openingAmount: number;
  currentBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalSalesCash: number;
  totalRefundsCash: number;
  pendingWithdrawals: number;
}

// ============================================================================
// KIT DE INSCRIPCION (enrolamiento de distribuidor)
// ============================================================================

export interface KitEnrollmentRequest {
  sponsorCustomerId: string;
  kitProductId: string;
  firstName: string;
  lastName: string;
  mothersLastName?: string;
  email: string;
  phone: string;
  rfc?: string;
  branchId?: string;
  /** País de residencia: define portal, catálogo y precios. Omitido = país de la sucursal. */
  countryId?: string;
  sendCredentialsByEmail?: boolean;
}

export interface KitEnrollmentResponse {
  customerId: string;
  customerNumber: string;
  fullName: string;
  userId: string;
  status: string;
  kitPosition: string;
  /** Tipo de precio con el que nace (distribuidor); ausente con un API anterior. */
  priceTypeId?: string | null;
  sponsor: {
    id: string;
    customerNumber: string;
    name: string;
  };
  tempPassword: string;
  emailSent?: boolean;
  /** Bono que se debe pagar al sponsor por la inscripcion. NULL si no hay regla configurada. */
  sponsorBonus?: {
    ruleId: string;
    amount: number;
    currencyCode: string;
    countryCode: string;
  } | null;
}

/** Alta de distribuidor desde POS con patrocinador por NUMERO de cliente. */
export interface PosRegisterDistributorRequest {
  sponsorCustomerNumber: string;
  firstName: string;
  lastName: string;
  mothersLastName?: string;
  email: string;
  phone: string;
  rfc?: string;
  /** Obligatoria en la UI (YYYY-MM-DD). */
  birthDate?: string;
  /** Solo México/Frontera. */
  curp?: string;
  nationality?: string;
  maritalStatus?: string;
  postalCode?: string;
  identificationType?: string;
  branchId?: string;
  /** País de residencia: define portal, catálogo y precios. Omitido = país de la sucursal. */
  countryId?: string;
  /** Si se incluye, se cobra el kit en el momento; si no, queda pendiente. */
  kitProductId?: string;
  sendCredentialsByEmail?: boolean;
  /** Domicilio ESTRUCTURADO por país (ver lib/address-forms.ts). */
  address?: import('../lib/address-forms').RegistrationAddress;
}

/** Alta de cliente preferente desde POS con patrocinador por NUMERO. */
export interface PosRegisterPreferredRequest {
  sponsorCustomerNumber: string;
  firstName: string;
  lastName: string;
  mothersLastName?: string;
  email: string;
  phone: string;
  rfc?: string;
  branchId?: string;
  /** País de residencia: define portal, catálogo y precios. Omitido = país de la sucursal. */
  countryId?: string;
  sendCredentialsByEmail?: boolean;
}

/** País activo del catálogo (selector de país en las altas). */
export interface ActiveCountry {
  id: string;
  code: string;
  name: string;
  currencyCode?: string;
}

/** Resultado de validar un patrocinador por numero de cliente. */
export interface SponsorLookup {
  id: string;
  customerNumber: string;
  name: string;
  customerType: string;
  status: string;
  /** true solo si es distribuidor activo (apto para patrocinar). */
  isValid: boolean;
}

// ============================================================================
// CFDI / DATOS FISCALES
// ============================================================================

/** Item de catalogo SAT (regimenes, usos CFDI, formas de pago). */
export interface SatCatalogItem {
  Value: string;
  Name: string;
}

export interface FiscalData {
  id: string;
  customerId: string;
  rfc: string;
  legalName: string;
  taxRegime: string;
  postalCode: string;
  email?: string;
  defaultCfdiUse?: string;
  paymentFormCode?: string;
  isDefault?: boolean;
  isValidated?: boolean;
}

export interface CreateFiscalDataInput {
  customerId: string;
  rfc: string;
  legalName: string;
  fiscalRegime: string;
  postalCode: string;
  cfdiUse?: string;
  email?: string;
  paymentFormCode?: string;
}

/** Datos fiscales capturados en el PaymentModal para una venta con factura. */
export interface InvoiceRequest {
  fiscalData: CreateFiscalDataInput;
  /** PUE = pago en una sola exhibicion, PPD = parcialidades/diferido. */
  invoicePaymentMethod: 'PUE' | 'PPD';
}

/** Cuerpo de error del módulo de facturación (BillingErrorFilter). */
export interface BillingErrorBody {
  statusCode: number;
  code: string;
  message: string;
  field?: string;
  details?: unknown;
  invoiceId?: string;
}

// ============================================================================
// FACTURA GLOBAL (público en general) — espejo de billing-global.dto.ts
// ============================================================================

export const GLOBAL_DAY_STATUSES = [
  'not_eligible',
  'no_sales',
  'ready',
  'blocked',
  'open',
  'emitted',
  'cancelled',
  'pending_reissue',
] as const;
export type GlobalDayStatus = (typeof GLOBAL_DAY_STATUSES)[number];

/** Etiqueta en español de cada estado del día (GlobalDayStatus). */
export const GLOBAL_DAY_STATUS_LABELS: Record<GlobalDayStatus, string> = {
  not_eligible: 'No aplica',
  no_sales: 'Sin ventas que declarar',
  ready: 'Lista para emitir',
  blocked: 'Bloqueada',
  open: 'Día en curso',
  emitted: 'Factura global emitida',
  cancelled: 'Global cancelada',
  pending_reissue: 'Pendiente de reexpedir',
};

/** Motivos de bloqueo del día (GlobalDayStatusDto.blockReason). */
export const GLOBAL_BLOCK_REASON_LABELS: Record<string, string> = {
  tickets:
    'Hay tickets del día con bloqueos (p. ej. forma de pago sin clave SAT); revísalos en la vista previa.',
  terminals_off:
    'Alguna terminal de la sucursal tiene la facturación apagada; todas deben estar encendidas.',
  attempt_in_progress:
    'La factura global se está generando en segundo plano; en cuanto el PAC la timbre aparecerá aquí.',
  stale_error:
    'El último intento quedó en error; Contabilidad debe revisarlo desde el admin.',
  uncovered_tickets:
    'La global emitida no incluye todas las ventas del día; Contabilidad debe reexpedirla desde el admin.',
};

/** Motivos por los que un ticket queda FUERA de la global (excluded.reason). */
export const GLOBAL_EXCLUDED_REASON_LABELS: Record<string, string> = {
  nominative_invoiced: 'Ya tiene factura nominativa',
  zero_total: 'Ticket en $0',
  credit_sale: 'Venta a crédito (PPD)',
  already_in_global: 'Ya está en otra global',
  // Contabilidad (20-oct-2026): estos cobros no se globalizan.
  cashback: 'Pagado con cashback (no se globaliza)',
  promotion: 'Pagado con promoción (no se globaliza)',
  usd: 'Pagado en dólares (no se globaliza)',
};

export type GlobalConceptMode = 'ticket' | 'product';

/** Respuesta de POST /pos/billing/global con background=true (API >= 14-oct-2026). */
export interface GlobalEmitAccepted {
  accepted: true;
  invoiceId: string;
  localDate: string;
  providerStatus: string;
}

export type GlobalProcessState = 'none' | 'processing' | 'emitted' | 'error' | 'cancelled';

/** GET /pos/billing/global/status: estado de la emisión en segundo plano. */
export interface GlobalDayProcess {
  state: GlobalProcessState;
  localDate: string;
  /** Mig 164: forma de pago de la global sondeada. */
  paymentForm?: string | null;
  invoiceId: string | null;
  providerStatus: string | null;
  folioDisplay: string | null;
  satUuid: string | null;
  total: number;
  error: string | null;
  updatedAt: string | null;
}

export interface GlobalDayStatusRow {
  localDate: string;
  status: GlobalDayStatus;
  invoiceId: string | null;
  providerStatus: string | null;
  providerFolio: string | null;
  ticketCount: number;
  total: number;
  blockers: number;
  blockReason: string | null;
  lateEmission: boolean;
  uncoveredCount: number;
  uncoveredTotal: number;
  /** Mig 164: globales vivas del día (una por forma de pago) y formas aún sin global. */
  emittedForms?: GlobalDayForm[];
  pendingForms?: GlobalPendingForm[];
}

export interface GlobalTax {
  rate: number;
  factor: string;
  base: number;
  tax: number;
}

export interface GlobalPreviewIncluded {
  kind: 'pos_sale' | 'order';
  id: string;
  folio: string;
  /** HH:mm en la zona de la sucursal. */
  time: string;
  customerName: string | null;
  paymentFormCode: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  taxBreakdown: GlobalTax[];
}

export interface GlobalPreviewExcluded {
  kind: 'pos_sale' | 'order';
  id: string;
  folio: string;
  total: number;
  reason: string;
  detail: string;
}

export interface GlobalPreviewBlocker {
  code: string;
  message: string;
  folio?: string | null;
  sku?: string | null;
  method?: string | null;
}

export interface GlobalEligibilityError {
  code: string;
  message: string;
}

export interface GlobalPreviewTotals {
  documents: number;
  subtotal: number;
  taxes: number;
  total: number;
  byRate: GlobalTax[];
  paymentForm: string | null;
}

export interface GlobalExisting {
  invoiceId: string;
  providerStatus: string | null;
  folioDisplay: string;
  satUuid: string | null;
  /** Mig 164: forma de pago de esa global. */
  paymentForm?: string | null;
  total?: number;
  ticketCount?: number;
}

/**
 * Una global por FORMA DE PAGO (Contabilidad, 20-oct-2026 / API mig 164): el
 * grupo de tickets de esa forma y el previewHash que se confirma al emitirla.
 */
export interface GlobalPreviewGroup {
  paymentForm: string;
  included: GlobalPreviewIncluded[];
  totals: GlobalPreviewTotals;
  items: unknown[];
  blockers: GlobalPreviewBlocker[];
  existing: GlobalExisting[];
  canStamp: boolean;
  previewHash: string;
}

export interface GlobalDayForm {
  paymentForm: string;
  invoiceId: string;
  providerStatus: string | null;
  folioDisplay: string;
  satUuid: string | null;
  ticketCount: number;
  total: number;
}

export interface GlobalPendingForm {
  paymentForm: string;
  ticketCount: number;
  total: number;
}

export interface GlobalPreview {
  branch: {
    id: string;
    code: string | null;
    name: string | null;
    timezone: string;
    expeditionZip: string | null;
    v2InvoicingSince: string | null;
    terminalsOff: string[];
  };
  localDate: string;
  conceptMode: GlobalConceptMode;
  eligible: boolean;
  eligibilityErrors: GlobalEligibilityError[];
  lateEmission: boolean;
  included: GlobalPreviewIncluded[];
  excluded: GlobalPreviewExcluded[];
  blockers: GlobalPreviewBlocker[];
  totals: GlobalPreviewTotals;
  /** Conceptos como se enviarán al PAC (vacío si hay bloqueadores). */
  items: unknown[];
  existingGlobal: GlobalExisting | null;
  /** Compatibilidad: true solo si el día tiene UNA forma de pago emitible. */
  canStamp: boolean;
  /** Compatibilidad: hash del único grupo, o del conjunto si hay varios. */
  previewHash: string;
  /** API con mig 164: un grupo por forma de pago (ausente en un API viejo). */
  groups?: GlobalPreviewGroup[];
  multiplePaymentForms?: boolean;
  existingGlobals?: GlobalExisting[];
}

/** Resumen de una factura (InvoiceSummaryDto): campos que usa el POS. */
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string | null;
  providerSerie: string | null;
  providerFolio: string | null;
  /** "serie-folio" | folio | invoiceNumber. */
  folioDisplay: string;
  satUuid: string | null;
  invoiceType: string;
  cfdiType: string | null;
  providerStatus: string | null;
  satStatus: string | null;
  receiverRfc: string | null;
  receiverName: string;
  total: number;
  currencyCode: string;
  branchId: string | null;
  branchName: string | null;
  stampedAt: string | null;
  createdAt: string;
  globalLocalDate: string | null;
  providerError: string | null;
  /** Último envío por correo (invoices.emailed_at); null = nunca enviada. */
  emailedAt: string | null;
  /** Destinatarios del último envío tal como se guardaron (separados por
   *  coma). null = nunca enviada. */
  emailedTo: string | null;
  /** Veces que se ha enviado (invoices.email_count). */
  emailCount: number;
}

/** Respuesta de POST /pos/sales/:id/invoice-email (InvoiceEmailResultDto). */
export interface InvoiceEmailResult {
  sentTo: string[];
  emailedAt: string;
  emailCount: number;
}

/** Detalle de una factura (InvoiceDetailDto): lo que el POS consume. */
export interface InvoiceDetail extends InvoiceSummary {
  totals: {
    subtotal: number;
    discount: number;
    taxes: number;
    total: number;
  };
  satStampDate: string | null;
  providerErrorMapped: {
    message: string;
    providerCode: string | null;
    field: string | null;
  } | null;
}

// ============================================================================
// CUSTOMER (busqueda en POS)
// ============================================================================

export interface PosCustomer {
  /** Patrocinador (para distinguir homónimos en la búsqueda del POS). */
  sponsorName?: string;
  sponsorNumber?: string;
  id: string;
  customerNumber?: string;
  firstName: string;
  lastName: string;
  mothersLastName?: string;
  fullName: string;
  email?: string;
  rfc?: string;
  /** Tipo de precio del cliente (distribuidor). Si existe, el POS resuelve
   *  precios con ese tier; si no, usa precio publico. */
  priceTypeId?: string;
  status?: string;
}

// ============================================================================
// TRASPASOS — ENTRADAS A LA SUCURSAL
// ============================================================================

export interface IncomingTransferItem {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  /** Piezas realmente recibidas (solo traspasos ya aplicados). */
  quantityReceived?: number;
}

export interface IncomingTransfer {
  id: string;
  movementNumber: string;
  status: string;
  /** Sucursal origen (quien envia). */
  branch: { id: string; name: string; code: string };
  /** Sucursal destino (esta terminal). */
  destinationBranch: { id: string; name: string; code: string };
  items: IncomingTransferItem[];
  totalItems: number;
  totalQuantity: number;
  reason: string;
  notes?: string;
  requestedBy?: { id: string; name: string };
  requestedAt?: string;
  approvedBy?: { id: string; name: string };
  approvedAt?: string;
  /** Quién aceptó la entrada y cuándo (solo traspasos ya aplicados). */
  appliedBy?: { id: string; name: string };
  appliedAt?: string;
}

/** Recepcion parcial: cantidades realmente recibidas por linea. */
export interface ReceiveTransferItem {
  detailId: string;
  quantityReceived: number;
  discrepancyType?: 'missing' | 'damaged' | 'excess' | 'wrong_product';
  notes?: string;
}

export interface ReceiveTransferPayload {
  items?: ReceiveTransferItem[];
  notes?: string;
}

/** Aviso de socket cuando llega un traspaso nuevo a la sucursal. */
export interface TransferIncomingEvent {
  transferId: string;
  movementNumber: string;
  originBranchName: string;
  totalItems: number;
  totalQuantity: number;
}

/** Movimiento de inventario del histórico de la sucursal (POS). */
export interface BranchInventoryMovement {
  id: string;
  movementNumber: string;
  movementType: string;
  movementCategory?: string;
  /** Código de razón (purchase, other…) en entradas/salidas; texto libre (motivo) en traspasos. */
  reason?: string;
  /** No. de referencia capturado al crear el movimiento ("Pedido Mochis octubre"). */
  referenceNumber?: string;
  notes?: string;
  status: string;
  totalItems?: number;
  totalQuantity?: number;
  createdAt: string;
  requestedByName?: string;
}

export interface BranchInventoryMovementList {
  data: BranchInventoryMovement[];
  total: number;
  page: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// CHECADOR DE ASISTENCIA (empleados de sucursal)
// ---------------------------------------------------------------------------

/** Los cuatro toques del checador (réplica del checador legacy v1). */
export type AttendanceEventType =
  | 'check_in'
  | 'break_out'
  | 'break_in'
  | 'check_out';

/** Resolución del número de empleado + siguiente movimiento sugerido. */
export interface AttendanceLookupResponse {
  employee: {
    id: string;
    employeeNumber: string;
    /** Puede venir null si el expediente no tiene nombre (mig 065). */
    name: string | null;
    /** Sucursal del expediente del empleado (puede diferir de la terminal). */
    branchId?: string | null;
    branchName?: string | null;
  };
  /** Último movimiento del día local del empleado (en cualquier sucursal). */
  lastEvent: {
    eventType: AttendanceEventType;
    occurredAt: string;
    localTime: string;
  } | null;
  suggestedType: AttendanceEventType;
}

/** Movimiento registrado por el checador del POS. */
export interface AttendanceEventResponse {
  id: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  /** Fecha y hora LOCALES de la sucursal, calculadas por el API. */
  localDate: string;
  localTime: string;
  timezone: string;
  employee: { id: string; employeeNumber: string; name: string | null };
  branch: { id: string; name: string };
  /** false = el evento se guardó pero la foto no se pudo subir. */
  photoUploaded: boolean;
}
