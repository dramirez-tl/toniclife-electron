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
  PosRegisterPreferredRequest,
} from '@/types/pos';

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
  activeSession: (branchId: string) =>
    [...posKeys.all, 'active-session', branchId] as const,
  sales: (branchId: string, date: string) =>
    [...posKeys.all, 'sales', branchId, date] as const,
  dailySummary: (branchId: string, date: string) =>
    [...posKeys.all, 'daily-summary', branchId, date] as const,
  balance: (sessionId: string) => [...posKeys.all, 'balance', sessionId] as const,
  movements: (sessionId: string) =>
    [...posKeys.all, 'movements', sessionId] as const,
  fiscalCatalogs: () => [...posKeys.all, 'fiscal-catalogs'] as const,
  incomingTransfers: (branchId: string) =>
    [...posKeys.all, 'incoming-transfers', branchId] as const,
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

/** Sesion de caja activa de la sucursal (la del usuario de sistema terminal). */
export const usePosActiveSession = (branchId: string | undefined) =>
  useQuery({
    queryKey: posKeys.activeSession(branchId ?? ''),
    queryFn: () => posApi.getActiveSession(branchId!),
    enabled: !!branchId,
    staleTime: 15 * 1000,
  });

/** Ventas de la sucursal en una fecha (YYYY-MM-DD). */
export const usePosSales = (
  branchId: string | undefined,
  date: string,
  limit = 100,
) =>
  useQuery({
    queryKey: posKeys.sales(branchId ?? '', date),
    queryFn: () =>
      posApi.getSales({ branchId, fromDate: date, toDate: date, limit }),
    enabled: !!branchId,
    staleTime: 15 * 1000,
  });

/** Detalle completo de una venta (items + pagos). */
export const usePosSale = (saleId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...posKeys.all, 'sale', saleId ?? ''],
    queryFn: () => posApi.getSaleById(saleId!),
    enabled: !!saleId && enabled,
    staleTime: 10 * 1000,
  });

/** Resumen del corte del dia para la sucursal. */
export const usePosDailySummary = (
  branchId: string | undefined,
  date: string,
  enabled = true,
) =>
  useQuery({
    queryKey: posKeys.dailySummary(branchId ?? '', date),
    queryFn: () => posApi.getDailySummary(branchId!, date),
    enabled: !!branchId && enabled,
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
    },
  });
};

// ============================================================================
// TRASPASOS — ENTRADAS A LA SUCURSAL
// ============================================================================

/** Traspasos En Tránsito dirigidos a esta sucursal, pendientes de aceptar. */
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
    mutationFn: (id: string) => posApi.receiveTransfer(id),
    onSuccess: () => {
      // El stock del destino cambió: refrescar entradas pendientes y catálogo.
      qc.invalidateQueries({ queryKey: posKeys.all });
    },
  });
};
