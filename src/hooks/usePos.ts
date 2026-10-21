// usePos.ts - Hooks de React Query para el POS.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '@/lib/posApi';
import type {
  CreateSaleInput,
  CancelSaleInput,
  ProcessPaymentInput,
  CreateCashMovementInput,
  KitEnrollmentRequest,
  PosRegisterDistributorRequest,
  PosRegisterPreferredRequest, ReceiveTransferPayload } from '@/types/pos';

export const posKeys = {
  all: ['pos'] as const,
  catalog: (branchId: string, priceTypeId: string) =>
    [...posKeys.all, 'catalog', branchId, priceTypeId] as const,
  search: (branchId: string, query: string) =>
    [...posKeys.all, 'search', branchId, query] as const,
  customers: (query: string) => [...posKeys.all, 'customers', query] as const,
  customerByNumber: (num: string) =>
    [...posKeys.all, 'customer-by-number', num] as const,
  sponsorSearch: (query: string) =>
    [...posKeys.all, 'sponsor-search', query] as const,
  sponsorByNumber: (num: string) =>
    [...posKeys.all, 'sponsor-by-number', num] as const,
  activeSession: (branchId: string) =>
    [...posKeys.all, 'active-session', branchId] as const,
  sales: (
    branchId: string,
    from: string,
    to: string,
    posLicenseId = '',
    capturedVia = '',
  ) =>
    [
      ...posKeys.all,
      'sales',
      branchId,
      from,
      to,
      posLicenseId,
      capturedVia,
    ] as const,
  globalDays: (branchId: string, from: string, to: string) =>
    [...posKeys.all, 'global-days', branchId, from, to] as const,
  dailySummary: (
    branchId: string,
    from: string,
    to: string,
    posLicenseId = '',
    capturedVia = '',
  ) =>
    [
      ...posKeys.all,
      'daily-summary',
      branchId,
      from,
      to,
      posLicenseId,
      capturedVia,
    ] as const,
  balance: (sessionId: string) => [...posKeys.all, 'balance', sessionId] as const,
  movements: (sessionId: string) =>
    [...posKeys.all, 'movements', sessionId] as const,
  fiscalCatalogs: () => [...posKeys.all, 'fiscal-catalogs'] as const,
  incomingTransfers: (branchId: string) =>
    [...posKeys.all, 'incoming-transfers', branchId] as const,
  salesByProduct: (branchId: string, from: string, to: string, search: string) =>
    [...posKeys.all, 'sales-by-product', branchId, from, to, search] as const,
};

/**
 * Catalogo completo de productos para una sucursal. Si se pasa priceTypeId
 * (cliente distribuidor seleccionado), el catalogo refleja ese tier de precio.
 */
export const usePosCatalog = (
  branchId: string | undefined,
  priceTypeId?: string,
) =>
  useQuery({
    queryKey: posKeys.catalog(branchId ?? '', priceTypeId ?? 'public'),
    queryFn: () => posApi.getCatalog(branchId!, priceTypeId),
    enabled: !!branchId,
    staleTime: 2 * 60 * 1000,
  });

/** Busqueda en vivo por nombre. Solo dispara con query >= 2 chars. */
export const usePosProductSearch = (
  branchId: string | undefined,
  query: string,
) =>
  useQuery({
    queryKey: posKeys.search(branchId ?? '', query),
    queryFn: () => posApi.searchProducts(query, branchId!),
    enabled: !!branchId && query.trim().length >= 2,
    staleTime: 30 * 1000,
  });

/** Ventas por producto con folio de la sucursal (corte): cada producto vendido
 *  con la venta a la que pertenece, para resurtir "lo mismo que vendí". */
export const usePosSalesByProduct = (
  branchId: string | undefined,
  from: string,
  to: string,
  enabled = true,
  search = '',
) =>
  useQuery({
    queryKey: posKeys.salesByProduct(branchId ?? '', from, to, search),
    queryFn: () => posApi.getSalesByProduct(branchId!, from, to, search || undefined),
    enabled: enabled && !!branchId && !!from && !!to,
    staleTime: 60 * 1000,
  });

/** Busqueda de clientes/distribuidores. Dispara desde 1 char (permite buscar
 *  por ID corto, ej. el socio #1). */
export const usePosCustomerSearch = (query: string) =>
  useQuery({
    queryKey: posKeys.customers(query),
    queryFn: () => posApi.searchCustomers(query),
    enabled: query.trim().length >= 1,
    staleTime: 30 * 1000,
  });

/** Busqueda EXACTA por numero de distribuidor: "2" trae SOLO al socio #2
 *  (la busqueda general es parcial y puede enterrar el numero corto). */
export const usePosCustomerByNumber = (customerNumber: string) =>
  useQuery({
    queryKey: posKeys.customerByNumber(customerNumber.trim().toUpperCase()),
    queryFn: () => posApi.searchCustomerByNumber(customerNumber),
    enabled: customerNumber.trim().length >= 1,
    staleTime: 30 * 1000,
  });

/** Busqueda de patrocinadores (distribuidores) por nombre o numero, para el
 *  alta desde POS. Dispara desde 1 char (numeros cortos, ej. el socio #2). */
export const useSponsorSearch = (query: string) =>
  useQuery({
    queryKey: posKeys.sponsorSearch(query.trim()),
    queryFn: () => posApi.searchSponsors(query.trim()),
    enabled: query.trim().length >= 1,
    staleTime: 30 * 1000,
  });

/** Patrocinador por numero EXACTO (endpoint pos-sponsor/:number). "2" trae
 *  SOLO al socio #2. retry:false — el 404 significa "no existe", no fallo. */
export const useSponsorByNumber = (customerNumber: string) =>
  useQuery({
    queryKey: posKeys.sponsorByNumber(customerNumber.trim().toUpperCase()),
    queryFn: () => posApi.lookupSponsor(customerNumber),
    enabled: customerNumber.trim().length >= 1,
    staleTime: 30 * 1000,
    retry: false,
  });

/** Sesion de caja activa de la sucursal (la del usuario de sistema terminal). */
export const usePosActiveSession = (branchId: string | undefined) =>
  useQuery({
    queryKey: posKeys.activeSession(branchId ?? ''),
    queryFn: () => posApi.getActiveSession(branchId!),
    enabled: !!branchId,
    staleTime: 15 * 1000,
  });

/** Ventas de la sucursal en un rango de días locales (from..to, YYYY-MM-DD;
 *  un solo día = from === to). opts.posLicenseId filtra por terminal y
 *  opts.capturedVia por canal ('usuario' = sin terminal), ambos en el API. */
export const usePosSales = (
  branchId: string | undefined,
  from: string,
  to: string,
  opts?: {
    posLicenseId?: string;
    capturedVia?: 'terminal' | 'usuario';
    limit?: number;
  },
) => {
  // 5000 = tope del API. Con 100, sucursales de alto volumen como Zacatelco
  // (140 ventas el 17-ago) dejaban de VER sus ventas de la mañana en
  // corte/recientes/CSV; con rangos de hasta 31 días hace falta el tope.
  const limit = opts?.limit ?? 5000;
  const posLicenseId = opts?.posLicenseId;
  const capturedVia = opts?.capturedVia;
  return useQuery({
    queryKey: posKeys.sales(
      branchId ?? '',
      from,
      to,
      posLicenseId ?? '',
      capturedVia ?? '',
    ),
    queryFn: () =>
      posApi.getSales({
        branchId,
        fromDate: from,
        toDate: to,
        ...(posLicenseId ? { posLicenseId } : {}),
        ...(capturedVia ? { capturedVia } : {}),
        limit,
      }),
    enabled: !!branchId && !!from && !!to,
    staleTime: 15 * 1000,
  });
};

/** Estado de la factura global de la sucursal por día local (from..to). */
export const useGlobalDays = (
  branchId: string | undefined,
  from: string,
  to: string,
  enabled = true,
  /** true = mientras algún día se esté timbrando en segundo plano, consulta cada 5 s. */
  pollInProgress = false,
) =>
  useQuery({
    queryKey: posKeys.globalDays(branchId ?? '', from, to),
    queryFn: () => posApi.getGlobalDays(from, to, branchId),
    enabled: !!branchId && !!from && !!to && enabled,
    staleTime: 30 * 1000,
    refetchInterval: pollInProgress
      ? (query) =>
          query.state.data?.some(
            (d) =>
              d.status === 'blocked' &&
              d.blockReason === 'attempt_in_progress' &&
              d.providerStatus !== 'error',
          )
            ? 5000
            : false
      : false,
    // 403/404 (terminal sin facturación, API viejo) no se reintentan.
    retry: false,
  });

/** Detalle completo de una venta (items + pagos). */
export const usePosSale = (saleId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...posKeys.all, 'sale', saleId ?? ''],
    queryFn: () => posApi.getSaleById(saleId!),
    enabled: !!saleId && enabled,
    staleTime: 10 * 1000,
  });

/** Resumen del corte de la sucursal para un rango de días locales (un solo
 *  día = from === to), con filtro opcional por caja. */
export const usePosDailySummary = (
  branchId: string | undefined,
  params: {
    from: string;
    to: string;
    posLicenseId?: string;
    capturedVia?: 'terminal' | 'usuario';
  },
  enabled = true,
) =>
  useQuery({
    queryKey: posKeys.dailySummary(
      branchId ?? '',
      params.from,
      params.to,
      params.posLicenseId ?? '',
      params.capturedVia ?? '',
    ),
    queryFn: () => posApi.getDailySummary(branchId!, params),
    enabled: !!branchId && !!params.from && !!params.to && enabled,
    staleTime: 15 * 1000,
  });

// ----------------------------------------------------------------------------
// MOVIMIENTOS DE CAJA
// ----------------------------------------------------------------------------

export const usePosBalance = (
  sessionId: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: posKeys.balance(sessionId ?? ''),
    queryFn: () => posApi.getBalance(sessionId!),
    enabled: !!sessionId && enabled,
    staleTime: 10 * 1000,
  });

export const usePosMovements = (
  sessionId: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: posKeys.movements(sessionId ?? ''),
    queryFn: () => posApi.getMovements(sessionId!),
    enabled: !!sessionId && enabled,
    staleTime: 10 * 1000,
  });

export const useCreateMovement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCashMovementInput) =>
      posApi.createMovement(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: posKeys.all });
    },
  });
};

// ----------------------------------------------------------------------------
// KIT DE INSCRIPCION
// ----------------------------------------------------------------------------

export const useEnrollKit = () =>
  useMutation({
    mutationFn: (input: KitEnrollmentRequest) => posApi.enrollKit(input),
  });

/** Alta de distribuidor desde POS (patrocinador por numero, kit opcional). */
export const useRegisterDistributor = () =>
  useMutation({
    mutationFn: (input: PosRegisterDistributorRequest) =>
      posApi.registerDistributor(input),
  });

/** Alta de cliente preferente desde POS (patrocinador por numero, sin kit). */
export const useRegisterPreferred = () =>
  useMutation({
    mutationFn: (input: PosRegisterPreferredRequest) =>
      posApi.registerPreferred(input),
  });

// ----------------------------------------------------------------------------
// CFDI / CATALOGOS SAT
// ----------------------------------------------------------------------------

/** Catalogos SAT (regimenes, usos CFDI, formas de pago) — cargados una vez. */
export const useFiscalCatalogs = (enabled = true) =>
  useQuery({
    queryKey: posKeys.fiscalCatalogs(),
    queryFn: async () => {
      const [regimes, cfdiUses, paymentForms] = await Promise.all([
        posApi.getFiscalRegimes(),
        posApi.getCfdiUses(),
        posApi.getPaymentForms(),
      ]);
      return { regimes, cfdiUses, paymentForms };
    },
    enabled,
    staleTime: 60 * 60 * 1000, // 1h — catalogos SAT casi no cambian
  });

/** Datos fiscales guardados de un cliente (para pre-llenar el formulario). */
export const usePosCustomerFiscalData = (
  customerId: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: [...posKeys.all, 'fiscal-data', customerId ?? ''],
    queryFn: () => posApi.getFiscalDataByCustomer(customerId!),
    enabled: !!customerId && enabled,
    staleTime: 60 * 1000,
  });

export const useCreateSale = () =>
  useMutation({
    mutationFn: (input: CreateSaleInput) => posApi.createSale(input),
  });

export const useCancelSale = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      saleId,
      input,
    }: {
      saleId: string;
      input: CancelSaleInput;
    }) => posApi.cancelSale(saleId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: posKeys.all });
      // Las promos canjeables pueden cambiar si la cancelacion regresa
      // puntos al periodo del distribuidor.
      qc.invalidateQueries({ queryKey: ['promotions'] });
      // Cancelar una venta con campaña de membresía la revierte: el
      // distribuidor vuelve a ser candidato.
      qc.invalidateQueries({ queryKey: ['membership'] });
    },
  });
};

/** Progreso de puntos del distribuidor en el periodo activo. */
export const useCustomerPeriodStats = (customerId: string | undefined) =>
  useQuery({
    queryKey: [...posKeys.all, 'period-stats', customerId ?? ''],
    queryFn: () => posApi.getCustomerPeriodStats(customerId!),
    enabled: !!customerId,
    staleTime: 60 * 1000,
  });

export const useProcessPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcessPaymentInput) => posApi.processPayment(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: posKeys.all });
      // Refrescar promos canjeables: la venta pudo haber sumado puntos que
      // desbloquean nuevas promos, o canjeado una con consumes_points=true.
      qc.invalidateQueries({ queryKey: ['promotions'] });
      // Una venta con campaña de membresía la consume (y cambia la posición
      // del distribuidor): las ofertas ya no aplican.
      qc.invalidateQueries({ queryKey: ['membership'] });
    },
  });
};

// ============================================================================
// TRASPASOS — ENTRADAS A LA SUCURSAL
// ============================================================================

/** Traspasos En Tránsito dirigidos a esta sucursal, pendientes de aceptar. */
/** Histórico de movimientos de inventario de la sucursal (modal Entradas). */
export const useBranchInventoryMovements = (
  branchId: string | undefined,
  page = 1,
) =>
  useQuery({
    queryKey: [...posKeys.all, 'inventory-movements', branchId ?? '', page],
    queryFn: () => posApi.getBranchInventoryMovements(branchId!, page),
    enabled: !!branchId,
    staleTime: 30 * 1000,
  });

export const useIncomingTransfers = (branchId: string | undefined) =>
  useQuery({
    queryKey: posKeys.incomingTransfers(branchId ?? ''),
    queryFn: () => posApi.getIncomingTransfers(branchId),
    enabled: !!branchId,
    staleTime: 30 * 1000,
    // Respaldo por si el evento de socket no llega (red intermitente).
    refetchInterval: 60 * 1000,
  });

/** Acepta la entrada de un traspaso (aplica e ingresa stock al destino). */
export const useReceiveTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload?: ReceiveTransferPayload }) =>
      posApi.receiveTransfer(args.id, args.payload),
    onSuccess: () => {
      // El stock del destino cambió: refrescar entradas pendientes y catálogo.
      qc.invalidateQueries({ queryKey: posKeys.all });
    },
  });
};
