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
  notes?: string;
  cancelledAt?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  itemsCount?: number;
  items: SaleItem[];
  payments: SalePayment[];
  createdAt: string;
  accumulatedPoints?: number;
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
  requiresInvoice?: boolean;
  notes?: string;
  currencyId?: string;
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
  date: string;
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
  totalMixed: number;
  totalRefunds: number;
  refundsCount: number;
  averageTicket: number;
  itemsSold: number;
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
  accumulatedPoints?: number;
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
  lotId?: string;
  notes?: string;
}

export interface PosCart {
  items: PosCartItem[];
  customerId?: string;
  customerName?: string;
  customerRfc?: string;
  priceTypeId?: string;
  isPublicPrice?: boolean;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  discountReason?: string;
  taxAmount: number;
  total: number;
  totalPoints: number;
  totalBusinessVolume: number;
  requiresInvoice: boolean;
  notes?: string;
}

// ============================================================================
// QUICK PRODUCT
// ============================================================================

export interface QuickProduct {
  id: string;
  sku: string;
  name: string;
  slug: string;
  imageUrl?: string;
  basePrice: number;
  categoryName?: string;
  stock?: number;
  isActive: boolean;
  taxRate?: number;
  isIncludedInPrice?: boolean;
  points?: number;
  businessVolume?: number;
  productType?: string;
  kitPosition?: string;
  /**
   * TRUE solo para kits de inscripción reales (gate autoritativo, mig 037).
   * Dispara el flujo de enrolamiento de distribuidor en POS.
   */
  isEnrollmentKit?: boolean;
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
  sendCredentialsByEmail?: boolean;
}

export interface KitEnrollmentResponse {
  customerId: string;
  customerNumber: string;
  fullName: string;
  userId: string;
  status: string;
  kitPosition: string;
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

// ============================================================================
// CUSTOMER (busqueda en POS)
// ============================================================================

export interface PosCustomer {
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
