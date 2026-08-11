// posApi.ts - Cliente HTTP del modulo POS contra toniclife-api.
// Portado de toniclife-next/src/services/pos.service.ts, adaptado al cliente
// `api` del Electron (Bearer = deviceToken de licencia).

import { api } from './api';
import type {
  CashRegister,
  Session,
  ActiveSession,
  OpenSessionInput,
  Sale,
  CreateSaleInput,
  CancelSaleInput,
  DailySalesSummary,
  ProcessPaymentInput,
  PaymentResult,
  QuickProduct,
  PosCustomer,
  CustomerPeriodStats,
  CreateCashMovementInput,
  CashMovement,
  CashBalance,
  KitEnrollmentRequest,
  KitEnrollmentResponse,
  PosRegisterDistributorRequest,
  PosRegisterPreferredRequest,
  SponsorLookup,
  PosCouponValidation,
  ActiveCountry,
  SatCatalogItem,
  FiscalData,
  CreateFiscalDataInput,
  IncomingTransfer,
  BranchInventoryMovementList,
} from '@/types/pos';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';
// Origen sin /api/v1 — para resolver rutas de imagenes servidas como estaticos.
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');

/** Resuelve una imageUrl que puede venir relativa desde el API. */
export function resolveImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapApiProduct(p: any): QuickProduct {
  // Los paquetes ('pack') se arman con componentes igual que los kits:
  // su stock propio no aplica cuando descuentan componentes.
  const isKit = p.productType === 'kit' || p.productType === 'pack';
  return {
    id: p.id,
    sku: p.code,
    name: p.name,
    slug: p.slug,
    imageUrl: resolveImageUrl(p.imageUrl),
    basePrice: parseFloat(p.price || '0'),
    categoryName: p.categoryName,
    description: p.description ?? undefined,
    shortName: p.shortName ?? undefined,
    stock: isKit ? undefined : p.stock,
    isActive: p.isActive,
    taxRate: p.taxRate != null ? Number(p.taxRate) : undefined,
    isIncludedInPrice: p.taxIncludedInPrice,
    points: p.pricePoints != null ? Number(p.pricePoints) : 0,
    businessVolume:
      p.priceBusinessValue != null ? Number(p.priceBusinessValue) : 0,
    productType: p.productType,
    kitPosition: p.kitPosition,
    isEnrollmentKit: p.isEnrollmentKit === true,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

class PosApi {
  // --------------------------------------------------------------------------
  // PRODUCTOS
  // --------------------------------------------------------------------------

  /** Catalogo completo para el POS (productos activos disponibles en POS). */
  async getCatalog(
    branchId: string,
    priceTypeId?: string,
    countryId?: string,
  ): Promise<QuickProduct[]> {
    const { data } = await api.get('/products', {
      params: {
        isActive: true,
        availableInPos: true,
        limit: 500,
        branchId,
        ...(priceTypeId && { priceTypeId }),
        ...(countryId && { countryId }),
      },
    });
    return (data.data ?? []).map(mapApiProduct);
  }

  /** Busqueda rapida por nombre. */
  async searchProducts(
    query: string,
    branchId: string,
    priceTypeId?: string,
    countryId?: string,
  ): Promise<QuickProduct[]> {
    const { data } = await api.get('/products', {
      params: {
        search: query || undefined,
        isActive: true,
        availableInPos: true,
        limit: 20,
        branchId,
        ...(priceTypeId && { priceTypeId }),
        ...(countryId && { countryId }),
      },
    });
    return (data.data ?? []).map(mapApiProduct);
  }

  /** Busqueda por SKU/codigo exacto (lector de codigo de barras). */
  async getProductBySku(
    sku: string,
    branchId?: string,
    priceTypeId?: string,
    countryId?: string,
  ): Promise<QuickProduct | null> {
    try {
      const params: Record<string, string> = {};
      if (branchId) params.branchId = branchId;
      if (priceTypeId) params.priceTypeId = priceTypeId;
      if (countryId) params.countryId = countryId;
      const { data } = await api.get(`/products/code/${encodeURIComponent(sku)}`, {
        params: Object.keys(params).length ? params : undefined,
      });
      if (!data || data.availableInPos === false) return null;
      return mapApiProduct(data);
    } catch {
      return null;
    }
  }

  /**
   * Resuelve precios para un lote de productos segun tipo de precio.
   * Sin priceTypeId el backend usa el precio público. branchId resuelve el país
   * (mismo criterio que el catálogo), garantizando que carrito y grid coincidan.
   */
  async resolveProductPrices(
    productIds: string[],
    priceTypeId?: string,
    branchId?: string,
    countryId?: string,
  ): Promise<
    Array<{
      productId: string;
      price: number;
      points: number;
      businessValue: number;
    }>
  > {
    const { data } = await api.post('/products/resolve-prices', {
      productIds,
      ...(priceTypeId && { priceTypeId }),
      ...(branchId && { branchId }),
      ...(countryId && { countryId }),
    });
    return data;
  }

  // --------------------------------------------------------------------------
  // CLIENTES
  // --------------------------------------------------------------------------

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private mapCustomer(c: any): PosCustomer {
    return {
      id: c.id,
      customerNumber: c.customerNumber ?? c.customer_number,
      firstName: c.firstName ?? c.first_name ?? '',
      lastName: c.lastName ?? c.last_name ?? '',
      mothersLastName: c.mothersLastName ?? c.mothers_last_name,
      fullName:
        c.fullName ??
        c.full_name ??
        [c.firstName ?? c.first_name, c.lastName ?? c.last_name, c.mothersLastName ?? c.mothers_last_name]
          .filter(Boolean)
          .join(' '),
      email: c.email,
      rfc: c.rfc,
      priceTypeId: c.priceTypeId ?? c.price_type_id,
      status: c.status,
      sponsorName:
        c.sponsor?.fullName ??
        (c.sponsor
          ? [c.sponsor.firstName, c.sponsor.lastName].filter(Boolean).join(' ')
          : undefined),
      sponsorNumber: c.sponsor?.customerNumber,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** Busqueda de clientes/distribuidores por nombre o numero (parcial). */
  async searchCustomers(query: string, limit = 12): Promise<PosCustomer[]> {
    const { data } = await api.get('/customers', {
      params: { search: query, limit, status: 'active' },
    });
    return (data.data ?? []).map((c: unknown) => this.mapCustomer(c));
  }

  /** Busqueda EXACTA por numero de distribuidor (customer_number).
   *  SIN filtro de status a proposito: si el cliente existe pero esta
   *  inactivo, el POS lo muestra con aviso (explica el "no aparece" de la
   *  busqueda general, que solo lista activos) — la seleccion se bloquea en
   *  la UI. toUpperCase: los numeros con letras (codigos hex de respaldo) se
   *  guardan en mayusculas. */
  async searchCustomerByNumber(customerNumber: string, limit = 5): Promise<PosCustomer[]> {
    const { data } = await api.get('/customers', {
      params: { customerNumber: customerNumber.trim().toUpperCase(), limit },
    });
    return (data.data ?? []).map((c: unknown) => this.mapCustomer(c));
  }

  /** Progreso de puntos del distribuidor en el periodo activo. */
  async getCustomerPeriodStats(
    customerId: string,
  ): Promise<CustomerPeriodStats> {
    const { data } = await api.get(`/customers/${customerId}/period-stats`);
    return data;
  }

  // --------------------------------------------------------------------------
  // CAJAS / SESIONES
  // --------------------------------------------------------------------------

  async getAvailableRegisters(branchId?: string): Promise<CashRegister[]> {
    const { data } = await api.get('/pos/registers/available', {
      params: branchId ? { branchId } : undefined,
    });
    return data;
  }

  async getActiveSession(branchId?: string): Promise<ActiveSession | null> {
    const { data } = await api.get('/pos/sessions/active', {
      params: branchId ? { branchId } : undefined,
    });
    return data;
  }

  async openSession(input: OpenSessionInput): Promise<Session> {
    const { data } = await api.post('/pos/sessions/open', input);
    return data;
  }

  // --------------------------------------------------------------------------
  // VENTAS
  // --------------------------------------------------------------------------

  async createSale(input: CreateSaleInput): Promise<Sale> {
    const { data } = await api.post('/pos/sales', input);
    return data;
  }

  async processPayment(input: ProcessPaymentInput): Promise<PaymentResult> {
    const { data } = await api.post('/pos/sales/pay', input);
    return data;
  }

  async getSales(params: {
    branchId?: string;
    sessionId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }): Promise<{ data: Sale[]; total: number }> {
    const { data } = await api.get('/pos/sales', { params });
    return data;
  }

  async getSaleById(id: string): Promise<Sale> {
    const { data } = await api.get(`/pos/sales/${id}`);
    return data;
  }

  async cancelSale(saleId: string, input: CancelSaleInput): Promise<Sale> {
    const { data } = await api.patch(`/pos/sales/${saleId}/cancel`, input);
    return data;
  }

  async getDailySummary(
    branchId: string,
    date?: string,
  ): Promise<DailySalesSummary> {
    const { data } = await api.get(`/pos/sales/summary/${branchId}`, {
      params: date ? { date } : undefined,
    });
    return data;
  }

  async stampSale(
    saleId: string,
    invoicePaymentMethod: 'PUE' | 'PPD' = 'PUE',
  ): Promise<Sale> {
    const { data } = await api.post(`/pos/sales/${saleId}/stamp`, {
      paymentMethod: invoicePaymentMethod,
    });
    return data;
  }

  // --------------------------------------------------------------------------
  // CUPONES
  // --------------------------------------------------------------------------

  /** Valida un cupón para la venta en curso. El API resuelve la sucursal por
   *  el device token; branchId viaja solo como fallback (pruebas web). El
   *  subtotal es la BASE del descuento: subtotal + impuestos (lo que paga el
   *  cliente), y el API recalcula/verifica al crear la venta. */
  async validateCoupon(input: {
    code: string;
    subtotal: number;
    customerId?: string;
    branchId?: string;
  }): Promise<PosCouponValidation> {
    const { data } = await api.post('/pos/coupons/validate', input);
    return data;
  }

  // --------------------------------------------------------------------------
  // MOVIMIENTOS DE CAJA
  // --------------------------------------------------------------------------

  async createMovement(
    input: CreateCashMovementInput,
  ): Promise<CashMovement> {
    const { data } = await api.post('/pos/movements', input);
    return data;
  }

  async getMovements(sessionId: string): Promise<CashMovement[]> {
    const { data } = await api.get('/pos/movements', {
      params: { sessionId, limit: 100 },
    });
    return data.data ?? [];
  }

  async getBalance(sessionId: string): Promise<CashBalance> {
    const { data } = await api.get(`/pos/movements/balance/${sessionId}`);
    return data;
  }

  // --------------------------------------------------------------------------
  // KIT DE INSCRIPCION
  // --------------------------------------------------------------------------

  async enrollKit(
    input: KitEnrollmentRequest,
  ): Promise<KitEnrollmentResponse> {
    const { data } = await api.post('/customers/kit-enrollment', input);
    return data;
  }

  /** Países activos del catálogo (endpoint público) para el selector de país. */
  async getActiveCountries(): Promise<ActiveCountry[]> {
    const { data } = await api.get('/config/countries/active');
    return data;
  }

  /** Estados/departamentos del país (endpoint público, catálogo tonic.states)
   *  para el domicilio estructurado del alta. */
  async getStates(
    countryId: string,
  ): Promise<Array<{ id: string; name: string; code?: string }>> {
    const { data } = await api.get('/states', { params: { countryId } });
    return data;
  }

  /** Valida un patrocinador por numero de cliente (para mostrar su nombre). */
  async lookupSponsor(customerNumber: string): Promise<SponsorLookup> {
    const { data } = await api.get(
      `/customers/pos-sponsor/${encodeURIComponent(customerNumber.trim())}`,
    );
    return data;
  }

  /** Busqueda de patrocinadores por nombre o numero (parcial). Incluye
   *  inactivos con isValid=false para poder explicar por que no aplican. */
  async searchSponsors(query: string, limit = 10): Promise<SponsorLookup[]> {
    const { data } = await api.get('/customers/pos-sponsor/search', {
      params: { q: query, limit },
    });
    return data ?? [];
  }

  /** Alta de distribuidor desde POS (patrocinador por numero, kit opcional). */
  async registerDistributor(
    input: PosRegisterDistributorRequest,
  ): Promise<KitEnrollmentResponse> {
    const { data } = await api.post('/customers/pos-register-distributor', input);
    return data;
  }

  /** Alta de cliente preferente desde POS (patrocinador por numero, sin kit). */
  async registerPreferred(
    input: PosRegisterPreferredRequest,
  ): Promise<KitEnrollmentResponse> {
    const { data } = await api.post('/customers/pos-register-preferred', input);
    return data;
  }

  // --------------------------------------------------------------------------
  // TRASPASOS — ENTRADAS A LA SUCURSAL
  // --------------------------------------------------------------------------

  /** Traspasos En Tránsito dirigidos a la sucursal de esta terminal. El backend
   *  ignora branchId del cliente y usa el del device token; lo enviamos solo
   *  como fallback para pruebas desde web. */
  /** Histórico de movimientos de inventario de la sucursal (entradas de
   *  Operación, salidas, traspasos, ajustes, conteos), recientes primero. */
  async getBranchInventoryMovements(
    branchId: string,
    page = 1,
  ): Promise<BranchInventoryMovementList> {
    const { data } = await api.get('/pos/inventory/movements', {
      params: { branchId, page },
    });
    return {
      data: (data.data ?? []).map((m: any) => ({
        id: m.id,
        movementNumber: m.movementNumber,
        movementType: m.movementType,
        movementCategory: m.movementCategory,
        reason: m.reason,
        status: m.status,
        totalItems: m.totalItems != null ? Number(m.totalItems) : undefined,
        totalQuantity:
          m.totalQuantity != null ? Number(m.totalQuantity) : undefined,
        createdAt: m.createdAt,
        requestedByName: m.requestedByName ?? m.requestedBy?.name,
      })),
      total: data.total ?? 0,
      page: data.page ?? page,
      totalPages: data.totalPages ?? 1,
    };
  }

  async getIncomingTransfers(branchId?: string): Promise<IncomingTransfer[]> {
    const { data } = await api.get('/pos/transfers/incoming', {
      params: branchId ? { branchId } : undefined,
    });
    return data ?? [];
  }

  /** Acepta la entrada de un traspaso: aplica el movimiento e ingresa el stock
   *  al destino. */
  async receiveTransfer(id: string): Promise<IncomingTransfer> {
    const { data } = await api.post(`/pos/transfers/${id}/receive`);
    return data;
  }

  // --------------------------------------------------------------------------
  // CFDI / DATOS FISCALES
  // --------------------------------------------------------------------------

  async getFiscalRegimes(): Promise<SatCatalogItem[]> {
    const { data } = await api.get('/billing/catalogs/fiscal-regimes');
    return data;
  }

  async getCfdiUses(): Promise<SatCatalogItem[]> {
    const { data } = await api.get('/billing/catalogs/cfdi-uses');
    return data;
  }

  async getPaymentForms(): Promise<SatCatalogItem[]> {
    const { data } = await api.get('/billing/catalogs/payment-forms');
    return data;
  }

  async getFiscalDataByCustomer(customerId: string): Promise<FiscalData[]> {
    const { data } = await api.get(
      `/billing/customers/${customerId}/fiscal-data`,
    );
    return data;
  }

  /** Crea o actualiza los datos fiscales de un cliente. */
  async saveFiscalData(input: CreateFiscalDataInput): Promise<FiscalData> {
    const { data } = await api.post('/billing/fiscal-data', input);
    return data;
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  formatCurrency(amount: number, currencySymbol = '$'): string {
    return `${currencySymbol}${amount.toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

export const posApi = new PosApi();
