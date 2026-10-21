// PosScreen - Pantalla principal del POS.
//
// Phase 4 completa: catalogo + carrito + cliente + cobro + sesiones + corte
// + ventas recientes + movimientos de caja + kits de inscripcion + CFDI.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LogOut,
  Clock,
  Settings,
  PanelLeftOpen,
  Receipt,
  PackageCheck,
  UserPlus,
  RefreshCw,
  CircleHelp,
  BadgePercent,
  ShieldCheck,
  Fingerprint,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { LogoMark } from '@/components/LogoMark';
import { LiveClock } from '@/components/LiveClock';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DeactivateConfirmDialog } from '@/components/DeactivateConfirmDialog';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { AvailablePromotions } from '@/components/pos/AvailablePromotions';
import { MembershipOfferBanner } from '@/components/pos/MembershipOfferBanner';
import { Cart } from '@/components/pos/Cart';
import { ResizeHandle } from '@/components/pos/ResizeHandle';
import {
  TransfersModal,
  TRANSFER_RECEIVE_ROLES,
} from '@/components/pos/TransfersModal';
import { OrderTabsBar } from '@/components/pos/OrderTabsBar';
import {
  usePosOrderTabs,
  isSnapshotEmpty,
  type OrderTabSnapshot,
} from '@/stores/pos-order-tabs.store';
import { DeliveryDialog } from '@/components/pos/DeliveryDialog';
import { DeliveriesSheet } from '@/components/pos/DeliveriesSheet';
import { CustomerPurchasesSheet } from '@/components/pos/CustomerPurchasesSheet';
import { StaffAvatar, StaffPhotoDialog } from '@/components/pos/StaffAvatar';
import { draftToInput } from '@/lib/deliveries';
import type { DeliveryDraft } from '@/types/deliveries';
import { CurrentPromotionsModal } from '@/components/pos/CurrentPromotionsModal';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { RecentSales, type SalesRange } from '@/components/pos/RecentSales';
import { CorteModal } from '@/components/pos/CorteModal';
import { InvoiceSaleModal } from '@/components/pos/InvoiceSaleModal';
import { CashMovementModal } from '@/components/pos/CashMovementModal';
import { KitProspectModal } from '@/components/pos/KitProspectModal';
import { RegisterDistributorModal } from '@/components/pos/RegisterDistributorModal';
import { SaleDetailModal } from '@/components/pos/SaleDetailModal';
import {
  StampRetryModal,
  type StampRetryState,
} from '@/components/pos/StampRetryModal';
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal';
import { AttendanceModal } from '@/components/pos/AttendanceModal';
import { ComingSoonGate } from '@/components/pos/ComingSoonGate';
import { StaffLoginModal } from '@/components/pos/StaffLoginModal';
import { BranchSearchSelect } from '@/components/pos/BranchSearchSelect';
import { hasSeenPosTour, startPosTour } from '@/lib/posTour';
import {
  CashierError,
  getApiErrorMessage,
  toastDurationFor,
} from '@/lib/apiError';
import { isTransientApiError } from '@/lib/api';
import { notifyInvoiceStamped } from '@/lib/invoiceEmail';
import {
  getRegistersWithRetry,
  noCashRegisterMessage,
} from '@/lib/cashRegister';
import { isOutOfStock, outOfStockReason } from '@/lib/kitStock';
import {
  fetchKitComponents,
  isKitLikeType,
  resolveComponentsForLines,
  type ComponentsContext,
} from '@/lib/kitComponents';
import {
  giftReceiptLines,
  membershipPositionLabel,
  membershipStatusLabel,
  toReceiptMembership,
} from '@/lib/membership';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  useStaffSession,
  STAFF_IDLE_TIMEOUT_MS,
} from '@/stores/staff-session.store';
import { staffLogout } from '@/lib/staffApi';
import {
  posKeys,
  useCreateSale,
  useProcessPayment,
  usePosActiveSession,
  useIncomingTransfers,
  usePosCatalog,
  usePosSales,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { APP_VERSION } from '@/lib/version';
import { todayLocal } from '@/lib/date';
import {
  aggregateTerminalRows,
  ALL_TERMINALS,
  terminalOptionsFromRows,
} from '@/lib/terminalRows';
import type { StoredSession } from '@/types';
import type {
  CreatePaymentInput,
  CreateSaleInput,
  InvoiceRequest,
  KitComponent,
  QuickProduct,
  KitEnrollmentResponse,
  Sale,
} from '@/types/pos';

interface PosScreenProps {
  session: StoredSession;
  onLogout: () => Promise<void> | void;
  /** Interruptor global de operación. false = cuerpo bloqueado ("próximamente"). */
  operationsEnabled: boolean;
  operationsMessage?: string | null;
  /** Facturación habilitada en esta terminal. false = ocultar "Requiere
   *  factura" (piloto doble captura: la factura se emite en el legacy). */
  invoicingEnabled?: boolean;
  /** Checador de asistencia habilitado en esta terminal (rollout terminal por
   *  terminal). false/undefined = ocultar el botón "Checador" (el server además
   *  rechaza el checado desde esta terminal con 403). */
  attendanceEnabled?: boolean;
  /** Re-valida contra el server (gate + datos) sin recargar la app. */
  onRefresh?: () => Promise<{
    ok: boolean;
    enabled?: boolean;
    reason?: 'invalid' | 'network';
  }>;
}

// Limites del ancho del panel del carrito (px).
const CART_MIN_WIDTH = 320;
const CART_MAX_WIDTH = 760;
const CART_DEFAULT_WIDTH = 384; // = w-96

/** Simbolo de moneda — MXN/USD usan '$'; el resto cae al propio codigo. */
/** Correo con forma de correo, o undefined: nunca mandar al API algo que bloquee el cobro. */
function validEmailOrUndefined(value?: string | null): string | undefined {
  const v = (value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined;
}

function currencySymbolFor(code?: string): string {
  if (!code) return '$';
  if (code === 'MXN' || code === 'USD') return '$';
  return code + ' ';
}

/** Bandera (emoji) del país ISO-2 de la sucursal. */
const COUNTRY_FLAGS: Record<string, string> = {
  MX: '🇲🇽',
  US: '🇺🇸',
  CO: '🇨🇴',
  GT: '🇬🇹',
};
function countryFlag(code?: string): string {
  return (code && COUNTRY_FLAGS[code.toUpperCase()]) || '🏳️';
}

export function PosScreen({
  session,
  onLogout,
  operationsEnabled,
  operationsMessage,
  invoicingEnabled = true,
  attendanceEnabled = false,
  onRefresh,
}: PosScreenProps) {
  // Rollout: cuerpo bloqueado ("próximamente"). El header sigue vivo para poder
  // configurar la impresora. Se libera solo cuando el super admin habilita.
  // El MODO STAFF (personal autenticado del corporativo) opera aun con la
  // terminal bloqueada — el gate es del rollout de la sucursal, no del staff.
  const staffBypass = useStaffSession(
    (s) => !!s.user && !!s.selectedBranch,
  );
  const posLocked = !operationsEnabled && !staffBypass;
  const [refreshing, setRefreshing] = useState(false);
  const [staffLoginOpen, setStaffLoginOpen] = useState(false);

  // Tour de primera vez: solo cuando la terminal está LIBERADA (con el gate
  // "próximamente" no hay pantalla que recorrer). Espera un tick a que el
  // catálogo/carrito estén en el DOM.
  useEffect(() => {
    if (posLocked || hasSeenPosTour()) return;
    const timer = window.setTimeout(() => {
      if (document.querySelector('[data-tour="pos-catalog"]')) {
        startPosTour();
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [posLocked]);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      const r = await onRefresh();
      if (r.ok) {
        toast.success(
          r.enabled ? 'Punto de venta activo' : 'Aún no se libera esta terminal',
        );
      } else if (r.reason === 'network') {
        toast.warning('Sin conexión con el servidor. Intenta de nuevo.');
      }

      // Además: buscar actualización del POS al momento (sin esperar el
      // ciclo automático de 4h). Si hay versión nueva se descarga sola y
      // aparecerá la pantalla de "Reiniciar y actualizar".
      try {
        const u = await window.toniclife.updater.check();
        if (u.status === 'update-available') {
          toast.info(
            `Actualización v${u.latestVersion} encontrada — descargando…`,
            { description: 'En cuanto termine te pedirá reiniciar.' },
          );
        } else if (u.status === 'up-to-date') {
          toast.success(`El POS está al día (v${u.currentVersion})`);
        } else if (u.status === 'error') {
          toast.warning('No se pudo verificar actualizaciones', {
            description: u.message,
          });
        }
      } catch {
        /* preload viejo o modo dev: sin verificación manual */
      }
    } finally {
      setRefreshing(false);
    }
  };
  const [showConfirm, setShowConfirm] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [corteOpen, setCorteOpen] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [transfersOpen, setTransfersOpen] = useState(false);
  // Promociones vigentes del país de la sucursal (modal informativo).
  const [promosOpen, setPromosOpen] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  // Checador de asistencia del personal de la sucursal. Vive FUERA del gate de
  // rollout: el empleado debe poder checar aunque la terminal no venda todavía.
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [pendingKit, setPendingKit] = useState<QuickProduct | null>(null);
  // Kit agregado con cliente ya asignado: preguntar si es RECOMPRA para el
  // propio cliente o inscripción de un NUEVO distribuidor (ver handleKitDetected).
  const [kitChoice, setKitChoice] = useState<QuickProduct | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  // Venta cobrada que el cajero quiere facturar "a la mera hora".
  const [invoiceSaleId, setInvoiceSaleId] = useState<string | null>(null);
  const [stampRetry, setStampRetry] = useState<StampRetryState | null>(null);
  // "Hoy" y todas las horas se calculan en la zona horaria de la SUCURSAL
  // (no la del equipo): una venta a las 00:26 en Tulsa es del día correcto.
  // Rango De/Hasta del panel de ventas; el corte respeta el MISMO rango y el
  // mismo filtro de caja (un solo estado para los dos).
  const [salesRange, setSalesRange] = useState<SalesRange>(() => {
    const today = todayLocal(session.branch.timezone);
    return { from: today, to: today };
  });
  // Filtro de caja: ALL_TERMINALS | SIN_TERMINAL_KEY | posLicenseId.
  const [salesTerminal, setSalesTerminal] = useState<string>(ALL_TERMINALS);

  // Panel "Ventas recientes" plegable. Se recuerda la preferencia.
  const [salesCollapsed, setSalesCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pos.recentSales.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSalesPanel = (collapsed: boolean) => {
    setSalesCollapsed(collapsed);
    try {
      localStorage.setItem('pos.recentSales.collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  // Ancho del panel del carrito, ajustable por el usuario y recordado.
  const [cartWidth, setCartWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('pos.cart.width'));
      if (Number.isFinite(saved) && saved >= CART_MIN_WIDTH && saved <= CART_MAX_WIDTH) {
        return saved;
      }
    } catch {
      /* ignore */
    }
    return CART_DEFAULT_WIDTH;
  });
  const persistCartWidth = (w: number) => {
    try {
      localStorage.setItem('pos.cart.width', String(w));
    } catch {
      /* ignore */
    }
  };

  const cart = usePosCartStore((s) => s.cart);
  const clearCart = usePosCartStore((s) => s.clearCart);
  const loadCart = usePosCartStore((s) => s.loadCart);
  const setCustomer = usePosCartStore((s) => s.setCustomer);
  const addItem = usePosCartStore((s) => s.addItem);
  const createSale = useCreateSale();
  const processPayment = useProcessPayment();

  // Intento de cobro en curso. Conserva la venta creada y su clave de
  // idempotencia entre reintentos: si processPayment falla por timeout/red,
  // el reintento reutiliza la MISMA venta en vez de crear una segunda (y el
  // API ignora cobros duplicados). El fingerprint invalida el intento si el
  // cajero modifica el carrito antes de reintentar.
  const saleAttemptRef = useRef<{
    clientRequestId: string;
    saleId?: string;
    fingerprint: string;
  } | null>(null);

  // ENTREGA A DOMICILIO (mig 161): borrador confirmado por Call Center para la
  // venta en curso. Va ligado al cliente: si cambia el cliente deja de aplicar
  // (activeDelivery) y se descarta al cobrar. Las hojas de "Compras" y
  // "Entregas" solo consultan.
  const [delivery, setDelivery] = useState<DeliveryDraft | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  // Cada apertura remonta el diálogo (key) para que arranque con el borrador
  // vigente y la ficha fresca del cliente.
  const [deliveryOpenSeq, setDeliveryOpenSeq] = useState(0);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  // Visor (solo ver) de la foto de quien opera en modo staff.
  const [staffPhotoOpen, setStaffPhotoOpen] = useState(false);
  // Agregar entrega a una venta YA cobrada (capturada sin ella): el mismo
  // diálogo, pero el borrador se manda al API de inmediato.
  const [attachSale, setAttachSale] = useState<{
    id: string;
    saleNumber: string;
    customerId?: string;
    customerName?: string;
    customerNumber?: string;
  } | null>(null);
  const queryClient = useQueryClient();
  // El borrador aplica al cliente para el que se confirmó; en envío
  // consolidado aplica a cualquier distribuidor (un paquete, varias ventas).
  const activeDelivery =
    delivery && (delivery.consolidated || delivery.customerId === cart.customerId)
      ? delivery
      : null;

  // MODO STAFF (call center / corporativo con SU cuenta): si hay sesión staff
  // con sucursal elegida, TODO el POS opera con esa sucursal (catálogo,
  // precios, stock, caja, folios, ticket) — un solo punto de re-scope. La
  // identidad de la TERMINAL (licencia, heartbeat, updates) no cambia.
  const staffUser = useStaffSession((s) => s.user);
  const staffBranch = useStaffSession((s) => s.selectedBranch);
  const staffBranches = useStaffSession((s) => s.branches);
  const staffActive = !!staffUser && !!staffBranch;
  const branch = staffActive ? staffBranch! : session.branch;

  // Tipo de venta en MODO STAFF: "Entrega a domicilio" (Call Center) vs
  // mostrador. Solo vive con la sesión staff; fuera de ella no existe.
  const [deliveryMode, setDeliveryMode] = useState(false);
  // Envío consolidado: varios distribuidores, un solo paquete (mig 162).
  const [consolidated, setConsolidated] = useState(false);
  const deliveryModeActive = staffActive && deliveryMode;
  // Al asignar un distribuidor con el modo entrega activo se abre solo el
  // diálogo del domicilio (el paso que no era intuitivo).
  const prevDeliveryCustomerRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevDeliveryCustomerRef.current;
    prevDeliveryCustomerRef.current = cart.customerId;
    if (!deliveryModeActive || !cart.customerId || cart.customerId === prev) return;
    if (delivery && delivery.customerId === cart.customerId) return;
    // Envío consolidado ya confirmado: el domicilio sirve para todos los
    // distribuidores del paquete; no se vuelve a pedir.
    if (delivery?.consolidated) return;
    setDeliveryOpenSeq((n) => n + 1);
    setDeliveryOpen(true);
  }, [cart.customerId, deliveryModeActive, delivery]);

  // PESTAÑAS DE PEDIDOS (modo staff): Call Center atiende varias llamadas a
  // la vez. La pestaña activa vive en el store del carrito + delivery /
  // deliveryMode / consolidated de arriba; las demás se estacionan como
  // snapshot en usePosOrderTabs y se restauran al volver.
  const orderTabs = usePosOrderTabs((s) => s.tabs);
  const activeTabId = usePosOrderTabs((s) => s.activeId);
  const snapshotCurrent = (): OrderTabSnapshot => ({
    cart: usePosCartStore.getState().cart,
    delivery,
    deliveryMode,
    consolidated,
  });
  const restoreSnapshot = (s: OrderTabSnapshot | null) => {
    // El diálogo del domicilio no debe abrirse solo por cambiar de pestaña.
    prevDeliveryCustomerRef.current = s?.cart.customerId;
    if (s) loadCart(s.cart);
    else clearCart();
    setDelivery(s?.delivery ?? null);
    setDeliveryMode(s?.deliveryMode ?? false);
    setConsolidated(s?.consolidated ?? false);
    saleAttemptRef.current = null;
  };
  const handleOpenTab = () => {
    if (!usePosOrderTabs.getState().openTab(snapshotCurrent())) {
      toast.info('Este pedido está vacío: úsalo para la nueva llamada.');
      return;
    }
    restoreSnapshot(null);
  };
  const handleSwitchTab = (id: string) => {
    const restore = usePosOrderTabs.getState().switchTab(id, snapshotCurrent());
    if (restore !== undefined) restoreSnapshot(restore);
  };
  const handleCloseTab = (id: string) => {
    const tab = orderTabs.find((t) => t.id === id);
    if (!tab) return;
    const snap = id === activeTabId ? snapshotCurrent() : tab.parked;
    const units = snap?.cart.items.reduce((n, it) => n + it.quantity, 0) ?? 0;
    if (
      (units > 0 || snap?.delivery) &&
      !window.confirm(
        `Este pedido tiene ${units} pieza(s)${snap?.delivery ? ' y una entrega a domicilio confirmada' : ''}${
          snap?.cart.customerName ? ` (${snap.cart.customerName})` : ''
        }. ¿Cerrarlo y descartarlo?`,
      )
    ) {
      return;
    }
    const restore = usePosOrderTabs.getState().closeTab(id);
    if (restore !== undefined) restoreSnapshot(restore);
  };
  // Fuera del modo staff no hay pestañas: al salir (botón, inactividad o
  // invalidación de la terminal) se descartan las estacionadas.
  useEffect(() => {
    if (!staffActive) usePosOrderTabs.getState().reset();
  }, [staffActive]);

  // Si Sistemas apaga el checador de esta terminal, el siguiente latido (≤60 s)
  // lo refleja: además de ocultar el botón, cerramos el modal si quedó abierto
  // (el server ya rechazaría el checado con 403).
  useEffect(() => {
    if (!attendanceEnabled && !staffActive) setAttendanceOpen(false);
  }, [attendanceEnabled, staffActive]);

  const branchId = branch.id;
  const branchTz = branch.timezone;
  const currencyCode = branch.currencyCode ?? 'MXN';
  const currencySymbol = currencySymbolFor(branch.currencyCode);
  // Facturación efectiva: en MODO STAFF las peticiones viajan con el JWT del
  // usuario (el candado de la terminal no aplica), igual que en el cobro.
  const effectiveInvoicingEnabled = staffActive ? true : invoicingEnabled;

  // Cajas que aparecen en el rango (no hay catálogo de licencias en el POS):
  // misma query SIN filtro que usa el panel (React Query la comparte), para
  // que el corte ofrezca las mismas opciones aunque el panel esté plegado.
  const { data: rangeSalesResp } = usePosSales(
    branchId,
    salesRange.from,
    salesRange.to,
  );
  const terminalOptions = useMemo(
    () =>
      terminalOptionsFromRows(
        aggregateTerminalRows(rangeSalesResp?.data ?? [], 4),
      ),
    [rangeSalesResp],
  );
  // Si la caja elegida ya no aparece en el rango cargado, el filtro cae a
  // "todas" (sin dejar lista y corte vacíos por un filtro invisible). Con la
  // lista aún sin cargar se respeta la elección para no refetchear dos veces.
  const effectiveSalesTerminal =
    salesTerminal !== ALL_TERMINALS &&
    terminalOptions.length > 0 &&
    !terminalOptions.some((o) => o.key === salesTerminal)
      ? ALL_TERMINALS
      : salesTerminal;

  // Cambio de sucursal efectiva (entrar/salir/cambiar en modo staff): el
  // carrito se vacía (precios/stock/moneda de otra sucursal) y el día de
  // ventas se recalcula en la zona horaria nueva. Los queries se refrescan
  // solos: todas las keys llevan branchId.
  const prevBranchIdRef = useRef(branchId);
  useEffect(() => {
    if (prevBranchIdRef.current === branchId) return;
    prevBranchIdRef.current = branchId;
    clearCart();
    saleAttemptRef.current = null;
    // Las pestañas de pedidos y la entrega en curso eran de la otra sucursal.
    usePosOrderTabs.getState().reset();
    setDelivery(null);
    setDeliveryMode(false);
    setConsolidated(false);
    const today = todayLocal(branch.timezone);
    setSalesRange({ from: today, to: today });
    setSalesTerminal(ALL_TERMINALS);
    // Cerrar TODO modal operativo abierto: un modal que sobrevive al cambio
    // (p.ej. el timeout de inactividad disparó con el alta a medias) operaría
    // la sucursal EQUIVOCADA — e incluso por encima del gate de rollout.
    setRegisterOpen(false);
    setKitChoice(null);
    setPendingKit(null);
    setPaymentOpen(false);
    setSelectedSaleId(null);
    setInvoiceSaleId(null);
    setCorteOpen(false);
    setMovementsOpen(false);
    setTransfersOpen(false);
    setPromosOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // Cierre automático del modo staff por inactividad (15 min sin teclado ni
  // clics). El carrito se limpia al salir (efecto de cambio de sucursal).
  useEffect(() => {
    if (!staffActive) return;
    const touch = () => useStaffSession.getState().touch();
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const interval = window.setInterval(() => {
      const last = useStaffSession.getState().lastActivityAt;
      if (Date.now() - last > STAFF_IDLE_TIMEOUT_MS) {
        staffLogout();
        toast.info('Modo staff cerrado por inactividad.');
      }
    }, 30_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.clearInterval(interval);
    };
  }, [staffActive]);

  const { data: activeSession } = usePosActiveSession(branchId);
  const { data: incomingTransfers = [] } = useIncomingTransfers(branchId);
  const incomingCount = incomingTransfers.length;

  // Kits de inscripcion del catalogo (para "Registrar distribuidor" + cobrar kit).
  const { data: catalogProducts = [] } = usePosCatalog(branchId);
  const enrollmentKits = catalogProducts.filter((p) => p.isEnrollmentKit);

  // Re-cotiza los items del carrito cuando cambia el tipo de precio (asignar o
  // quitar distribuidor). Lee el estado fresco del store para no depender de
  // closures y cubre ambos sentidos (distribuidor ⇄ público). Sin priceTypeId
  // el backend usa el precio público; branchId resuelve el país igual que el
  // catálogo, así el carrito y el grid SIEMPRE muestran el mismo precio.
  const cartPriceTypeId = cart.priceTypeId;
  useEffect(() => {
    const items = usePosCartStore.getState().cart.items;
    if (items.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const prices = await posApi.resolveProductPrices(
          items.map((it) => it.productId),
          cartPriceTypeId,
          branchId,
        );
        if (!cancelled && prices.length > 0) {
          usePosCartStore.getState().refreshItemPrices(prices);
        }
      } catch {
        /* si falla, se conservan los precios actuales */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartPriceTypeId, branchId]);

  // Contexto para resolver el contenido de kits/paquetes/promos: en modo
  // staff el API exige la sucursal (JWT de usuario); la terminal se
  // identifica sola. El país solo sirve para el fallback con API anterior.
  const branchCountryCode = branch.country?.code;
  const componentsCtx = useMemo<ComponentsContext>(
    () => ({
      branchId: staffActive ? branchId : undefined,
      branchCountryCode,
    }),
    [staffActive, branchId, branchCountryCode],
  );

  // Líneas kit/pack/promo agregadas SIN contenido (catálogo, SKU, lote,
  // kit de inscripción): se completa en segundo plano para que el carrito
  // lo muestre y el ticket no dependa de una consulta en el cobro. Con []
  // (consultado y vacío) no se vuelve a pedir; un fallo deja undefined y se
  // reintenta en el siguiente cambio del carrito (la caché evita tormentas).
  const cartItems = cart.items;
  useEffect(() => {
    const missing = cartItems.filter(
      (it) => isKitLikeType(it.productType) && it.components === undefined,
    );
    if (missing.length === 0) return;
    let cancelled = false;
    for (const pid of new Set(missing.map((it) => it.productId))) {
      void fetchKitComponents(pid, componentsCtx)
        .then((comps) => {
          if (cancelled) return;
          usePosCartStore.getState().setItemComponents(pid, comps);
        })
        .catch(() => {
          /* la línea queda sin contenido; el cobro lo reintenta */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [cartItems, componentsCtx]);

  // Re-valida el CUPÓN cuando cambia la base del descuento (subtotal +
  // impuestos, antes de cupón): el % cambia con el total y la compra mínima
  // puede dejar de cumplirse. Si ya no aplica, se retira con aviso.
  const couponBase = Math.round((cart.subtotal + cart.taxAmount) * 100) / 100;
  const cartCouponCode = cart.couponCode;
  // El cliente asignado también es dependencia: un cupón personal deja de
  // aplicar si se cambia/quita el distribuidor de la venta.
  const cartCustomerId = cart.customerId;
  useEffect(() => {
    if (!cartCouponCode || couponBase <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await posApi.validateCoupon({
          code: cartCouponCode,
          subtotal: couponBase,
          customerId: cartCustomerId,
        });
        if (cancelled) return;
        const st = usePosCartStore.getState();
        if (st.cart.couponCode !== cartCouponCode) return;
        if (result.valid && result.coupon) {
          if (result.discount !== st.cart.couponDiscount) {
            st.setCoupon(
              result.coupon.code,
              result.discount,
              result.coupon.description || undefined,
            );
          }
        } else {
          st.clearCoupon();
          toast.warning(
            `El cupón ${cartCouponCode} se retiró: ${result.reason ?? 'ya no aplica al carrito actual'}`,
          );
        }
      } catch {
        /* sin red: se conserva el cupón; createSale re-valida en el server */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartCouponCode, couponBase, cartCustomerId]);

  /**
   * Asegura que exista una sesion de caja. Si no hay, auto-abre una con la
   * primera caja disponible y monto de apertura 0.
   *
   * Sin caja en la sucursal (alta desde el admin sin "Caja Principal"): se
   * reintenta la consulta UNA vez tras 1.5 s y, si sigue vacía, se corta ANTES
   * de crear la venta con un aviso que dice qué sucursal es y qué hacer.
   */
  async function ensureSession(): Promise<string> {
    const active = await posApi.getActiveSession(branchId);
    if (active?.session?.id) return active.session.id;

    const registers = await getRegistersWithRetry(() =>
      posApi.getAvailableRegisters(branchId),
    );
    if (registers.length === 0) {
      throw new CashierError(noCashRegisterMessage(branch));
    }
    const newSession = await posApi.openSession({
      cashRegisterId: registers[0].id,
      openingAmount: 0,
      openingNotes: `Apertura automatica desde terminal ${session.license.licenseKey}`,
    });
    return newSession.id;
  }

  async function handlePaymentConfirm(
    payments: CreatePaymentInput[],
    invoice?: InvoiceRequest,
  ) {
    setIsProcessing(true);
    try {
      const sessionId = await ensureSession();

      // CAMPAÑA DE MEMBRESÍA ("compra N puntos en producto y tu membresía es
      // gratis"): la fijó el banner cuando el ticket cumplió los puntos y el
      // cajero dejó "Aplicar en esta venta". Viaja al crear la venta; el
      // servidor vuelve a validar y la aplica AL COBRAR.
      const membershipCampaignId = cart.membershipCampaignId ?? undefined;

      // Si el carrito cambió desde el último intento fallido, el intento
      // anterior ya no aplica (la venta pendiente vieja queda para limpieza
      // del corte); se genera una clave nueva.
      const fingerprint = JSON.stringify({
        customerId: cart.customerId,
        membershipCampaignId: membershipCampaignId ?? null,
        items: cart.items.map((it) => [
          it.productId,
          it.quantity,
          it.discountPercent ?? null,
          it.discountAmount ?? null,
        ]),
        discountPercent: cart.discountPercent ?? null,
        discountAmount: cart.discountAmount ?? null,
        couponCode: cart.couponCode ?? null,
        // El monto del cupón y el total también invalidan el intento: una
        // re-validación puede cambiar el descuento sin cambiar el código.
        couponDiscount: cart.couponDiscount ?? null,
        total: cart.total,
        // Cambiar destinatario/domicilio también es otra venta.
        delivery: activeDelivery
          ? [
              activeDelivery.recipientName,
              activeDelivery.recipientPhone ?? null,
              activeDelivery.addressText,
              activeDelivery.notes ?? null,
            ]
          : null,
      });
      if (
        !saleAttemptRef.current ||
        saleAttemptRef.current.fingerprint !== fingerprint
      ) {
        saleAttemptRef.current = {
          clientRequestId: crypto.randomUUID(),
          fingerprint,
        };
      }
      const attempt = saleAttemptRef.current;

      // Reutiliza la venta del intento anterior si ya se había creado;
      // si la respuesta de createSale se perdió, el API la reencuentra por
      // clientRequestId en vez de duplicarla.
      let saleId = attempt.saleId;
      if (!saleId) {
        const createInput: CreateSaleInput = {
          sessionId,
          customerId: cart.customerId,
          customerName: cart.customerName,
          customerRfc: cart.customerRfc,
          items: cart.items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            discountPercent: it.discountPercent,
            discountAmount: it.discountAmount,
            notes: it.notes,
          })),
          discountPercent: cart.discountPercent,
          discountAmount: cart.discountAmount,
          discountReason: cart.discountReason,
          couponCode: cart.couponCode,
          requiresInvoice: !!invoice,
          notes: cart.notes,
          clientRequestId: attempt.clientRequestId,
          // Boletos de evento: correo capturado en caja o, si no, el del
          // cliente asignado (el API cae al del cliente si va vacío). Solo se
          // manda si tiene forma de correo: el 14-oct un correo mal capturado
          // en la ficha bloqueó el cobro en todas las sucursales.
          attendeeEmail: validEmailOrUndefined(
            cart.attendeeEmail ?? cart.customerEmail,
          ),
          // Entrega a domicilio confirmada (solo si sigue siendo del cliente
          // asignado). El API la liga a la venta en la misma transacción.
          delivery: activeDelivery ? draftToInput(activeDelivery) : undefined,
          // Si el servidor no está de acuerdo (faltan puntos, campaña
          // apagada, ya usada…) responde 400 con el motivo: se muestra tal
          // cual en el catch de abajo.
          membershipCampaignId,
        };
        let sale: Sale;
        try {
          sale = await createSale.mutateAsync(createInput);
        } catch (err) {
          // Sin respuesta del servidor (tiempo agotado / red): la venta pudo
          // haberse creado de todos modos (12-oct-2026, Cancún: el servidor
          // tardó 23 s, el POS se rindió a los 20 y la venta quedó "pendiente"
          // sin cobro). Un reintento con la MISMA clientRequestId es seguro:
          // el API devuelve la venta ya creada en vez de duplicarla.
          if (!isTransientApiError(err)) throw err;
          toast.info('El servidor tardó en responder; reintentando la venta...', {
            duration: 4000,
          });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          sale = await createSale.mutateAsync(createInput);
        }
        attempt.saleId = sale.id;
        saleId = sale.id;
      }

      const result = await processPayment.mutateAsync({
        saleId,
        payments,
      });

      // Cobro exitoso: liberar el intento para que la próxima venta genere
      // su propia clave. La entrega a domicilio ya viajó con la venta.
      saleAttemptRef.current = null;
      if (activeDelivery) {
        if (activeDelivery.consolidated) {
          // El envío sigue abierto para el siguiente distribuidor.
          const sales = [...(activeDelivery.shipmentSales ?? []), result.saleNumber];
          setDelivery({ ...activeDelivery, shipmentSales: sales });
          toast.info(
            `Venta ${result.saleNumber} sumada al envío consolidado para ${activeDelivery.recipientName} (${sales.length} venta(s)). Asigna al siguiente distribuidor o cierra el envío.`,
            { duration: 7000 },
          );
        } else {
          setDelivery(null);
          toast.info(
            `Pedido a domicilio registrado para ${activeDelivery.recipientName}: Almacén lo surte y envía.`,
            { duration: 6000 },
          );
        }
      }

      const changeMsg =
        result.changeGiven > 0
          ? ` — Cambio: ${posApi.formatCurrency(result.changeGiven, currencySymbol)}`
          : '';
      toast.success(`Venta ${result.saleNumber} cobrada${changeMsg}`);

      // CAMPAÑA DE MEMBRESÍA: el servidor la aplica AL COBRAR (posición,
      // regalos a $0 que descuentan existencia y cupón de primera recompra),
      // así que el resultado se lee de la venta ya cobrada: el ticket imprime
      // el bloque MEMBRESÍA y los regalos, y se avisa al cajero. Tolerante:
      // si la lectura falla, el ticket sale sin el bloque y se dice dónde
      // verlo (la venta YA quedó cobrada).
      let membershipSale: Sale | null = null;
      if (membershipCampaignId) {
        membershipSale = await posApi.getSaleById(saleId).catch(() => null);
        const m = membershipSale?.membership;
        if (!m) {
          toast.info(
            'No se pudo leer el resultado de la campaña de membresía; revísalo en el detalle de la venta.',
            { duration: 8000 },
          );
        } else if (m.status === 'applied') {
          const notDelivered = m.gifts.filter((g) => !g.delivered);
          toast.success(
            `Membresía ${m.name}: posición ${membershipPositionLabel(m.grantPosition)} aplicada${
              m.couponCode ? ` · cupón ${m.couponCode}` : ''
            }`,
            { duration: 8000 },
          );
          if (notDelivered.length > 0) {
            toast.warning(
              `Regalos sin existencia en la sucursal (no entregados): ${notDelivered
                .map((g) => `${g.quantity} x ${g.name}`)
                .join(', ')}.`,
              { duration: 10000 },
            );
          }
        } else if (m.status === 'failed') {
          toast.error(
            `La membresía ${m.name} no se pudo aplicar${m.error ? `: ${m.error}` : ''}. Revísala en el admin.`,
            { duration: 12000 },
          );
        } else {
          toast.info(
            `Membresía ${m.name}: ${membershipStatusLabel(m.status).toLowerCase()}.`,
            { duration: 8000 },
          );
        }
      }

      // Boletos de evento: el API los emite al cobrar (claves ligadas a un
      // evento). Se avisa al cajero cuántos salieron y a qué correo se mandan,
      // o que falta el correo (entonces se envían después desde el admin).
      if (cart.items.some((it) => it.event)) {
        void posApi
          .getSaleTickets(saleId)
          .then((tickets) => {
            const issued = tickets.filter((t) => t.status !== 'cancelled');
            if (issued.length === 0) {
              toast.warning(
                'La venta lleva una clave de evento pero no se emitió ningún boleto. Revísalo en el admin: Eventos › Boletos.',
                { duration: 8000 },
              );
              return;
            }
            const emails = Array.from(
              new Set(
                issued
                  .map((t) => t.attendeeEmail)
                  .filter((e): e is string => !!e),
              ),
            );
            const numbers = issued.map((t) => t.ticketNumber).join(', ');
            toast.success(
              emails.length > 0
                ? `${issued.length} boleto(s) de evento emitido(s): ${numbers}. Se envían a ${emails.join(', ')}.`
                : `${issued.length} boleto(s) de evento emitido(s): ${numbers}. El cliente no tiene correo: se envían después desde el admin (Eventos › Boletos).`,
              { duration: 10000 },
            );
          })
          .catch(() => {
            toast.info(
              'Boletos del evento: consúltalos en el admin (Eventos › Boletos).',
            );
          });
      }

      // Ticket de venta + cajón (fire-and-forget: si la impresora falla, la
      // venta YA quedó cobrada; solo se avisa). Snapshot del carrito ANTES de
      // limpiarlo. El cajón solo abre si hubo efectivo.
      const PAYMENT_LABELS: Record<string, string> = {
        cash: 'Efectivo',
        card: 'Tarjeta',
        transfer: 'Transferencia',
        credit: 'Crédito',
        mercado_pago: 'Mercado Pago',
        deposit: 'Depósito',
        usd_cash: 'Efectivo USD',
        cashback: 'Monedero',
        promotion: 'Promoción',
      };
      const hadCash = payments.some((p) => p.paymentMethod === 'cash');
      const cashReceived = payments.reduce(
        (s, p) => s + (p.amountReceived ?? 0),
        0,
      );

      // Contenido de kits/paquetes/promos para el ticket (pedido de las
      // sucursales: al vender un kit el ticket lista lo que INCLUYE para
      // poder armarlo/entregarlo — paridad con el legacy). Se usa lo que ya
      // trae la línea (promos canjeables, o lo resuelto en segundo plano al
      // agregar) y solo se consulta lo que falte. Falla-tolerante: si nada
      // responde, el ticket sale sin "Incluye" pero sale.
      let componentsByProduct = new Map<string, KitComponent[]>();
      try {
        componentsByProduct = await resolveComponentsForLines(
          cart.items,
          componentsCtx,
        );
      } catch {
        // sin componentes: el ticket imprime solo las líneas normales
      }

      void window.toniclife.printer
        .printSale(
          {
            branchName: branch.name,
            ticketName: branch.ticketName,
            saleNumber: result.saleNumber,
            createdAt: new Date().toISOString(),
            customerName: cart.customerName,
            customerNumber: cart.customerNumber,
            currencySymbol,
            items: [
              ...cart.items.map((it) => {
                const comps = componentsByProduct.get(it.productId);
                return {
                  name: it.productName,
                  sku: it.productSku,
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  total: it.total,
                  components: comps?.map((c) => ({
                    name: c.name,
                    quantity: c.quantity * it.quantity,
                  })),
                };
              }),
              // Regalos de la campaña de membresía: los agregó el servidor
              // a $0 (no están en el carrito) y se imprimen como "Regalo".
              ...giftReceiptLines(membershipSale?.items ?? []),
            ],
            subtotal: cart.subtotal,
            // El descuento impreso incluye el del cupón (viaja aparte del
            // manual en el store; sin esto el ticket salía sin descuento).
            discountAmount:
              (cart.couponCode ? cart.couponDiscount : cart.discountAmount) ?? 0,
            taxAmount: cart.taxAmount,
            total: cart.total,
            payments: payments.map((p) => ({
              label: PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod,
              amount: p.amount,
            })),
            amountReceived: cashReceived > 0 ? cashReceived : undefined,
            changeGiven: result.changeGiven,
            currencyCode: branch.currencyCode,
            // Puntos de ESTA venta (API nuevo; fallback: suma del carrito) y
            // saldo del periodo con la compra incluida.
            salePoints:
              result.salePoints ??
              (cart.customerId
                ? cart.items.reduce((s, it) => s + it.points * it.quantity, 0)
                : undefined),
            periodPoints: result.accumulatedPoints,
            // Bloque MEMBRESÍA (posición, regalos entregados o no, cupón).
            membership: membershipSale?.membership
              ? toReceiptMembership(membershipSale.membership)
              : undefined,
          },
          hadCash,
        )
        .then((r) => {
          if (!r.ok) {
            toast.warning('La venta se cobró pero el ticket no se imprimió', {
              description: r.error,
            });
          }
        });

      clearCart();
      setPaymentOpen(false);

      // Facturacion CFDI: guardar datos fiscales del cliente y timbrar.
      // Si falla, abrimos el modal de reintento (la venta YA quedo cobrada).
      if (invoice) {
        try {
          await posApi.saveFiscalData(invoice.fiscalData);
          const stamped = await posApi.stampSale(
            saleId,
            invoice.invoicePaymentMethod,
          );
          // Avisa también si el correo salió o no (el API la manda al timbrar);
          // relee la venta porque la respuesta del timbrado no trae el envío.
          void notifyInvoiceStamped(saleId, result.saleNumber, stamped);
        } catch (stampErr) {
          const se = stampErr as {
            response?: { data?: { message?: string } };
          };
          setStampRetry({
            saleId,
            saleNumber: result.saleNumber,
            fiscalData: invoice.fiscalData,
            invoicePaymentMethod: invoice.invoicePaymentMethod,
            error:
              se.response?.data?.message ??
              'No se pudo timbrar la factura automaticamente.',
          });
        }
      }
    } catch (err) {
      // El API rechaza con 400 + `message` completo (p.ej. "Stock insuficiente
      // para componente "X" del kit Y (requiere 1, hay 0)"). Se muestra
      // íntegro y el tiempo suficiente para leerlo; arreglos de validación
      // se unen con separador.
      const msg = getApiErrorMessage(err, 'Error al procesar la venta');
      toast.error(msg, { duration: toastDurationFor(msg) });
    } finally {
      setIsProcessing(false);
    }
  }

  /**
   * Kit elegido en una inscripción que el catálogo reporta AGOTADO en la
   * sucursal: se avisa (ámbar, D9) y el kit se agrega igual para que el
   * cajero pueda intentar el cobro (el API es quien rechaza) o quitarlo.
   * Se agrega sin el tope de existencia: con stock 0 el carrito no lo
   * aceptaría y el alta ya ocurrió.
   */
  function addEnrollmentKitToCart(kit: QuickProduct, fullName: string) {
    if (isOutOfStock(kit)) {
      addItem({ ...kit, stock: undefined }, 1);
      toast.warning(
        `Registrado, pero el kit ${kit.sku} está agotado en esta sucursal (${outOfStockReason(kit)}). El cobro se rechazará hasta que haya existencia: pide traspaso o cambia el kit.`,
        { duration: 12_000 },
      );
      return;
    }
    addItem(kit, 1);
    toast.success(`Kit ${kit.sku} agregado para ${fullName}`);
  }

  function handleKitDetected(product: QuickProduct) {
    if (!cart.customerId) {
      toast.error(
        'Selecciona primero al cliente en el carrito: el distribuidor que recompra su kit, o el patrocinador si vas a inscribir a alguien nuevo.',
      );
      return;
    }
    // Con cliente asignado el kit tiene DOS destinos válidos: RECOMPRA del
    // propio cliente (p.ej. dado de baja que se reactiva y vuelve a comprar
    // su kit — reporte 07-ago: el POS lo forzaba a "registrar un nuevo
    // distribuidor") o inscripción de un NUEVO patrocinado por él (flujo
    // original). Se pregunta en vez de asumir lo segundo.
    setKitChoice(product);
  }

  function handleKitEnrolled(
    result: KitEnrollmentResponse,
    kit: QuickProduct,
  ) {
    // Cambiar el cliente del POS al nuevo distribuidor inscrito y agregar el
    // kit al carrito para cobrar la inscripcion.
    setCustomer(
      result.customerId,
      result.fullName,
      undefined,
      cart.priceTypeId,
      result.customerNumber,
    );
    addEnrollmentKitToCart(kit, result.fullName);
    setPendingKit(null);
  }

  function handleDistributorRegistered(
    result: KitEnrollmentResponse,
    kit: QuickProduct | null,
  ) {
    if (kit) {
      // Alta + cobro de kit: pasar al nuevo distribuidor como cliente y
      // agregar el kit al carrito para cobrarlo.
      setCustomer(
        result.customerId,
        result.fullName,
        undefined,
        cart.priceTypeId,
        result.customerNumber,
      );
      addEnrollmentKitToCart(kit, result.fullName);
    } else {
      toast.success(`Registro completo: ${result.customerNumber}`);
    }
    setRegisterOpen(false);
  }

  return (
    <div className="h-full w-full flex flex-col bg-muted/30">
      {/* Barra superior */}
      <header className="h-14 bg-primary text-primary-foreground flex items-center px-5 gap-4 shrink-0">
        {/* Acceso OCULTO al modo staff: clic al logo (call center / corporativo). */}
        <button
          type="button"
          onClick={() => {
            if (!staffActive) setStaffLoginOpen(true);
          }}
          className="shrink-0 cursor-default appearance-none border-0 bg-transparent p-0"
          title=""
          aria-label="Tonic Life"
        >
          <LogoMark size={44} variant="icon-blue" avatar />
        </button>
        <div className="flex-1 min-w-0" data-tour="pos-branch">
          <div className="text-sm font-semibold leading-tight">
            Tonic Life POS
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/80">
            {branch.country && (
              <span
                className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                title={branch.country.name}
              >
                {countryFlag(branch.country.code)} {branch.country.name}
              </span>
            )}
            {branch.legacyKey && (
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                Clave {branch.legacyKey}
              </span>
            )}
            <span className="truncate">
              {branch.code} — {branch.name}
            </span>
            {staffActive && (
              <span className="shrink-0 rounded bg-violet-500/90 px-1.5 py-0.5 text-[11px] font-bold text-white">
                MODO STAFF
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4" data-tour="pos-status">
          <ConnectionStatus />
          <div className="h-5 w-px bg-white/20" />
          <div className="flex items-center gap-1.5 text-sm text-white/85 mr-1">
            <Clock className="size-4 shrink-0" />
            <LiveClock
              timezone={branch.timezone}
              showDate
              dateClassName="text-[11px] text-white/70"
            />
          </div>
        </div>
        <div className="text-xs text-white/70 text-right mr-2">
          <div className="font-mono">{session.license.licenseKey}</div>
          <div className="flex items-center justify-end gap-1.5">
            {session.license.label && <span>{session.license.label}</span>}
            <span
              className="rounded bg-white/15 px-1 py-px font-mono text-[10px] text-white/80"
              title="Versión de la terminal"
            >
              v{APP_VERSION}
            </span>
          </div>
        </div>
        {/* Botones operativos: ocultos mientras el POS está bloqueado (rollout).
            La configuración de impresora SÍ permanece disponible. */}
        {!posLocked && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRegisterOpen(true)}
              className="text-white/80 hover:text-white hover:bg-white/10"
              title="Registrar distribuidor o cliente preferente"
              data-tour="pos-register"
            >
              <UserPlus />
              Registrar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPromosOpen(true)}
              className="text-white/80 hover:text-white hover:bg-white/10"
              title="Promociones vigentes en esta sucursal (informativo)"
              data-tour="pos-promos"
            >
              <BadgePercent />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTransfersOpen(true)}
              className="relative text-white/80 hover:text-white hover:bg-white/10"
              title="Entradas de inventario (traspasos)"
              data-tour="pos-transfers"
            >
              <PackageCheck />
              {incomingCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-4 text-amber-950">
                  {incomingCount > 9 ? '9+' : incomingCount}
                </span>
              )}
            </Button>
          </>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-white/80 hover:text-white hover:bg-white/10"
            title="Actualizar estado, datos y buscar nueva versión del POS"
            data-tour="pos-refresh"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </Button>
        )}
        {!posLocked && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => startPosTour()}
            className="text-white/80 hover:text-white hover:bg-white/10"
            title="Ver recorrido de uso"
            data-tour="pos-help"
          >
            <CircleHelp />
          </Button>
        )}
        {/* Checador: solo en las terminales donde Sistemas lo habilitó
            (rollout terminal por terminal desde /admin/sistema; el server
            también rechaza el checado con 403 si está apagado). Cuando aparece,
            vive FUERA del gate del rollout: funciona igual que la impresora
            aunque el cuerpo del POS esté bloqueado. En MODO STAFF el candado
            del server no aplica (las peticiones viajan con el JWT del usuario),
            así que el botón se muestra siempre. */}
        {(attendanceEnabled || staffActive) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttendanceOpen(true)}
            className="text-white/80 hover:text-white hover:bg-white/10"
            title="Checador de asistencia del personal"
            data-tour="pos-attendance"
          >
            <Fingerprint />
            Checador
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPrinterSettingsOpen(true)}
          className="text-white/80 hover:text-white hover:bg-white/10"
          title="Configurar impresora termica"
          data-tour="pos-printer"
        >
          <Settings />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          <LogOut />
          Cerrar sesion
        </Button>
      </header>

      {/* Barra de MODO STAFF: visible mientras call center / corporativo opera
          con su cuenta. Cambiar de sucursal vacía el carrito (aviso). */}
      {staffActive && staffUser && (
        <div className="flex h-10 shrink-0 items-center gap-3 bg-violet-700 px-5 text-white">
          <ShieldCheck className="size-4 shrink-0" />
          {/* Foto de quien opera (expediente de RRHH); clic = verla en grande */}
          <StaffAvatar
            photoUrl={staffUser.avatarUrl}
            name={staffUser.fullName}
            size={28}
            onClick={() => setStaffPhotoOpen(true)}
            title="Ver foto"
          />
          <span className="text-xs font-semibold">
            Modo staff — {staffUser.fullName}
          </span>
          <span className="hidden text-[11px] text-white/70 sm:inline">
            {[staffUser.departmentName, staffUser.email].filter(Boolean).join(' · ')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-white/80">Sucursal:</span>
            <BranchSearchSelect
              branches={staffBranches}
              value={branch.id}
              dark
              className="w-72"
              onSelect={(next) => {
                if (
                  cart.items.length > 0 &&
                  !window.confirm(
                    'Cambiar de sucursal vacía el carrito actual. ¿Continuar?',
                  )
                ) {
                  return;
                }
                useStaffSession.getState().selectBranch(next);
                toast.info(`Operando sucursal ${next.code} — ${next.name}`);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeliveriesOpen(true)}
              className="h-7 px-2 text-xs text-white/90 hover:bg-white/10 hover:text-white"
              title="Estatus de los pedidos a domicilio que capturaste"
            >
              <Truck className="size-3.5" />
              Mis entregas
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const { tabs, activeId } = usePosOrderTabs.getState();
                const parked = tabs.filter(
                  (t) => t.id !== activeId && !isSnapshotEmpty(t.parked),
                ).length;
                if (
                  parked > 0 &&
                  !window.confirm(
                    `Tienes ${parked} pedido(s) en otras pestañas; al salir del modo staff se descartan. ¿Continuar?`,
                  )
                ) {
                  return;
                }
                staffLogout();
                setDeliveryMode(false);
                setConsolidated(false);
                setDelivery(null);
                toast.info('Saliste del modo staff.');
              }}
              className="h-7 px-2 text-xs text-white/90 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-3.5" />
              Salir del modo staff
            </Button>
          </div>
        </div>
      )}

      {/* Cuerpo: bloqueado durante el rollout, o la operación normal. */}
      {posLocked ? (
        <div className="flex-1 min-h-0">
          <ComingSoonGate
            message={operationsMessage}
            branchName={session.branch.name}
          />
        </div>
      ) : (
      <div className="flex-1 flex min-h-0">
        {salesCollapsed ? (
          <aside className="w-11 shrink-0 border-r bg-card flex flex-col items-center gap-3 py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleSalesPanel(false)}
              title="Mostrar ventas recientes"
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelLeftOpen className="size-5" />
            </Button>
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Receipt className="size-4 text-primary" />
              <span className="text-[11px] font-medium tracking-wide [writing-mode:vertical-rl] rotate-180">
                Ventas recientes
              </span>
            </div>
          </aside>
        ) : (
          <aside className="w-72 shrink-0" data-tour="pos-sales-panel">
            <RecentSales
              branchId={branchId}
              branchName={branch.name}
              branchTz={branchTz}
              branchCountryCode={branch.country?.code}
              currencySymbol={currencySymbol}
              range={salesRange}
              onRangeChange={setSalesRange}
              terminalFilter={effectiveSalesTerminal}
              onTerminalFilterChange={setSalesTerminal}
              onOpenCorte={() => setCorteOpen(true)}
              onOpenMovements={() => setMovementsOpen(true)}
              onSelectSale={(id) => setSelectedSaleId(id)}
              onInvoiceSale={(id) => setInvoiceSaleId(id)}
              invoicingEnabled={effectiveInvoicingEnabled}
              onCollapse={() => toggleSalesPanel(true)}
              currentLicenseId={session.license.id}
            />
          </aside>
        )}
        <main className="flex-1 min-w-0 flex flex-col" data-tour="pos-catalog">
          {cart.customerId && (
            <AvailablePromotions
              customerId={cart.customerId}
              branchId={branchId}
            />
          )}
          {/* Campaña de membresía del distribuidor asignado: solo aparece si
              el API reporta una que le aplique (404 = nada). La terminal se
              identifica por su licencia; en modo staff viaja la sucursal. */}
          {cart.customerId && (
            <MembershipOfferBanner
              customerId={cart.customerId}
              branchId={staffActive ? branchId : undefined}
            />
          )}
          <div className="flex-1 min-h-0">
            <ProductGrid
              branchId={branchId}
              currencySymbol={currencySymbol}
              onKitDetected={handleKitDetected}
            />
          </div>
        </main>
        <ResizeHandle
          width={cartWidth}
          min={CART_MIN_WIDTH}
          max={CART_MAX_WIDTH}
          defaultWidth={CART_DEFAULT_WIDTH}
          onResize={setCartWidth}
          onCommit={persistCartWidth}
        />
        <aside
          className="flex shrink-0 flex-col"
          style={{ width: cartWidth }}
          data-tour="pos-cart"
        >
          {/* Pestañas de pedidos: solo en modo staff (varias llamadas a la vez) */}
          {staffActive && (
            <OrderTabsBar
              tabs={orderTabs}
              activeId={activeTabId}
              liveCart={cart}
              liveDeliveryMode={deliveryModeActive}
              disabled={isProcessing || paymentOpen}
              onSelect={handleSwitchTab}
              onOpen={handleOpenTab}
              onClose={handleCloseTab}
            />
          )}
          <div className="min-h-0 flex-1">
          <Cart
            currencySymbol={currencySymbol}
            currencyCode={currencyCode}
            isProcessing={isProcessing}
            branchId={branch.id}
            staffMode={staffActive}
            deliveryMode={deliveryModeActive}
            onDeliveryModeChange={(on) => {
              setDeliveryMode(on);
              // Regresar a mostrador descarta el domicilio confirmado.
              if (!on) {
                setDelivery(null);
                setConsolidated(false);
              }
              if (on && cart.customerId && !activeDelivery) {
                setDeliveryOpenSeq((n) => n + 1);
                setDeliveryOpen(true);
              }
            }}
            consolidated={consolidated}
            onConsolidatedChange={setConsolidated}
            delivery={activeDelivery}
            onDelivery={() => {
              if (!cart.customerId) {
                toast.error('Asigna primero al distribuidor en la venta.');
                return;
              }
              setDeliveryOpenSeq((n) => n + 1);
              setDeliveryOpen(true);
            }}
            onDeliveryClear={() => {
              if (activeDelivery?.consolidated) {
                toast.info(
                  `Envío consolidado cerrado con ${activeDelivery.shipmentSales?.length ?? 0} venta(s).`,
                );
                setConsolidated(false);
              }
              setDelivery(null);
            }}
            onShowPurchases={() => setPurchasesOpen(true)}
            onCheckout={() => {
              if (cart.items.length === 0) return;
              // Entrega a domicilio sin domicilio confirmado: no se cobra.
              if (deliveryModeActive && !activeDelivery) {
                if (!cart.customerId) {
                  toast.error(
                    'Asigna al distribuidor y confirma su domicilio de entrega antes de cobrar.',
                  );
                } else {
                  setDeliveryOpenSeq((n) => n + 1);
                  setDeliveryOpen(true);
                  toast.info('Confirma el domicilio de entrega para poder cobrar.');
                }
                return;
              }
              // Venta en $0 por promo, por boletos de evento (el de invitado se
              // regala en $0) O por cupón que cubre el total: no hay nada que
              // cobrar → se completa directo, sin modal de pago. Mismo criterio
              // que el API (processPayment).
              const hasPromo = cart.items.some(
                (it) =>
                  it.productType === 'promotional' ||
                  it.productType === 'event' ||
                  !!it.event,
              );
              const couponCoversTotal =
                !!cart.couponCode && (cart.couponDiscount ?? 0) > 0;
              if (cart.total === 0 && (hasPromo || couponCoversTotal)) {
                void handlePaymentConfirm([]);
                return;
              }
              setPaymentOpen(true);
            }}
          />
          </div>
        </aside>
      </div>
      )}

      {/* Modal de cobro (incluye seccion CFDI) */}
      <PaymentModal
        isOpen={paymentOpen}
        onClose={() => !isProcessing && setPaymentOpen(false)}
        total={cart.total}
        currencySymbol={currencySymbol}
        currencyCode={currencyCode}
        branchCountry={branch.country?.code}
        customerId={cart.customerId}
        customerRfc={cart.customerRfc}
        invoicingEnabled={effectiveInvoicingEnabled}
        isProcessing={isProcessing}
        onConfirm={handlePaymentConfirm}
      />

      {/* Modal de corte: mismo rango De/Hasta y misma caja que el panel */}
      <CorteModal
        isOpen={corteOpen}
        onClose={() => setCorteOpen(false)}
        branchId={branchId}
        branchName={branch.name}
        branchTz={branchTz}
        range={salesRange}
        terminalFilter={effectiveSalesTerminal}
        onTerminalFilterChange={setSalesTerminal}
        terminalOptions={terminalOptions}
        currencySymbol={currencySymbol}
        onSelectSale={(id) => setSelectedSaleId(id)}
        invoicingEnabled={effectiveInvoicingEnabled}
        branchCountryCode={branch.country?.code}
      />

      {/* Modal de movimientos de caja */}
      <CashMovementModal
        isOpen={movementsOpen}
        onClose={() => setMovementsOpen(false)}
        sessionId={activeSession?.session?.id ?? null}
        currencySymbol={currencySymbol}
      />

      {/* Modal de entradas de inventario (traspasos) */}
      <TransfersModal
        isOpen={transfersOpen}
        onClose={() => setTransfersOpen(false)}
        branchId={branchId}
        canReceive={
          staffActive &&
          TRANSFER_RECEIVE_ROLES.includes(staffUser?.roleCode ?? '')
        }
      />

      {/* Foto en grande de quien opera en modo staff (solo ver) */}
      {staffUser && (
        <StaffPhotoDialog
          isOpen={staffPhotoOpen}
          onClose={() => setStaffPhotoOpen(false)}
          name={staffUser.fullName}
          subtitle={staffUser.departmentName ?? undefined}
          photoUrl={staffUser.photoUrl}
          avatarUrl={staffUser.avatarUrl}
        />
      )}

      {/* Entrega a domicilio de la venta en curso (Call Center confirma datos) */}
      <DeliveryDialog
        key={deliveryOpenSeq}
        isOpen={deliveryOpen}
        onClose={() => {
          setDeliveryOpen(false);
          setAttachSale(null);
        }}
        customerId={attachSale ? attachSale.customerId : cart.customerId}
        customerName={attachSale ? attachSale.customerName : cart.customerName}
        customerNumber={attachSale ? attachSale.customerNumber : cart.customerNumber}
        branchCountryCode={branch.country?.code}
        initial={attachSale ? null : activeDelivery}
        saleNumber={attachSale?.saleNumber}
        onConfirm={async (draft) => {
          if (attachSale) {
            // Venta ya cobrada: la entrega se registra al momento y Almacén
            // recibe el aviso. Con "varios distribuidores, un solo envío"
            // marcado, esta venta abre el envío consolidado y el domicilio
            // queda listo para las siguientes.
            const openShipment = deliveryModeActive && consolidated;
            const shipmentKey = openShipment ? crypto.randomUUID() : undefined;
            try {
              await posApi.addSaleDelivery(attachSale.id, {
                ...draftToInput(draft),
                ...(shipmentKey ? { shipmentKey } : {}),
              });
              if (openShipment) {
                setDelivery({
                  ...draft,
                  consolidated: true,
                  shipmentKey,
                  shipmentSales: [attachSale.saleNumber],
                });
                toast.success(
                  `Envío consolidado abierto con la venta ${attachSale.saleNumber}: recibe ${draft.recipientName}. Asigna al siguiente distribuidor y cobra, o suma otra venta ya cobrada.`,
                  { duration: 7000 },
                );
              } else {
                toast.success(
                  `Entrega a domicilio agregada a la venta ${attachSale.saleNumber}: Almacén la surte y envía.`,
                  { duration: 6000 },
                );
              }
              void queryClient.invalidateQueries({ queryKey: posKeys.all });
              setAttachSale(null);
              setDeliveryOpen(false);
            } catch (err) {
              toast.error(
                getApiErrorMessage(err, 'No se pudo agregar la entrega a la venta'),
              );
            }
            return;
          }
          if (consolidated || activeDelivery?.consolidated) {
            // Un solo domicilio para varias ventas: la clave del envío la
            // genera el POS y viaja en cada cobro.
            setDelivery({
              ...draft,
              consolidated: true,
              shipmentKey: activeDelivery?.shipmentKey ?? crypto.randomUUID(),
              shipmentSales: activeDelivery?.shipmentSales ?? [],
            });
            setDeliveryOpen(false);
            toast.success(
              `Envío consolidado abierto: recibe ${draft.recipientName}. Cobra una venta por distribuidor.`,
            );
            return;
          }
          setDelivery(draft);
          setDeliveryOpen(false);
          toast.success(`Entrega a domicilio confirmada para ${draft.recipientName}`);
        }}
      />

      {/* Compras anteriores del distribuidor asignado */}
      <CustomerPurchasesSheet
        isOpen={purchasesOpen}
        onClose={() => setPurchasesOpen(false)}
        customerId={cart.customerId}
        customerName={cart.customerName}
        customerNumber={cart.customerNumber}
        currencySymbol={currencySymbol}
        branchTz={branchTz}
        onSelectSale={(id) => setSelectedSaleId(id)}
      />

      {/* Estatus de entregas a domicilio ("Mis entregas" en modo staff) */}
      <DeliveriesSheet
        key={`deliveries-${staffActive ? 'staff' : 'terminal'}`}
        isOpen={deliveriesOpen}
        onClose={() => setDeliveriesOpen(false)}
        branchId={branchId}
        branchName={branch.name}
        branchTz={branchTz}
        staffMode={staffActive}
        onSelectSale={(id) => setSelectedSaleId(id)}
      />

      {/* Promociones vigentes del país de la sucursal (solo informativo) */}
      <CurrentPromotionsModal
        isOpen={promosOpen}
        onClose={() => setPromosOpen(false)}
        branchId={branchId}
        branchName={branch.name}
      />

      {/* Kit con cliente asignado: ¿recompra para él o inscripción de un nuevo? */}
      <Dialog open={!!kitChoice} onOpenChange={(o) => !o && setKitChoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Para quién es el kit {kitChoice?.sku}?</DialogTitle>
            <DialogDescription>
              {cart.customerName} está asignado a la venta. El kit puede ser su
              recompra o reactivación, o la inscripción de un nuevo
              distribuidor patrocinado por él.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                const kit = kitChoice;
                if (kit) {
                  // Recompra = venta normal: agotado se trata igual que un
                  // producto (no se agrega; el API lo rechazaría).
                  if (isOutOfStock(kit)) {
                    toast.error(
                      `El kit ${kit.sku} está agotado en esta sucursal: ${outOfStockReason(kit)}. Pide traspaso antes de venderlo.`,
                      { duration: 10_000 },
                    );
                    setKitChoice(null);
                    return;
                  }
                  addItem(kit, 1);
                  toast.success(
                    `Kit ${kit.sku} agregado para ${cart.customerName} — sus puntos se acreditan al cobrar.`,
                  );
                }
                setKitChoice(null);
              }}
            >
              Es para {cart.customerName} (recompra / reactivación)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPendingKit(kitChoice);
                setKitChoice(null);
              }}
            >
              Inscribir a un NUEVO distribuidor (patrocina {cart.customerName})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de inscripcion por kit */}
      <KitProspectModal
        isOpen={!!pendingKit}
        onClose={() => setPendingKit(null)}
        sponsor={
          cart.customerId
            ? { id: cart.customerId, name: cart.customerName ?? 'Distribuidor' }
            : null
        }
        kit={pendingKit}
        branchId={branchId}
        branchCountryCode={branch.country?.code}
        onEnrolled={handleKitEnrolled}
      />

      {/* Modal de alta de distribuidor (patrocinador por numero, kit opcional) */}
      <RegisterDistributorModal
        isOpen={registerOpen}
        onClose={() => setRegisterOpen(false)}
        branchId={branchId}
        branchCountryCode={branch.country?.code}
        currencySymbol={currencySymbol}
        enrollmentKits={enrollmentKits}
        onRegistered={handleDistributorRegistered}
      />

      {/* Modal de detalle / cancelacion de venta */}
      <SaleDetailModal
        isOpen={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        saleId={selectedSaleId}
        staffMode={staffActive}
        attachLabel={
          activeDelivery?.consolidated
            ? `Sumar esta venta al envío consolidado (${activeDelivery.recipientName})`
            : undefined
        }
        onAddDelivery={(sale) => {
          if (!sale.customerId) {
            toast.error(
              'La venta no tiene distribuidor asignado; no se puede enviar a domicilio.',
            );
            return;
          }
          // Con un envío consolidado abierto la venta se suma directo (mismo
          // domicilio, misma clave), sin volver a confirmar datos.
          if (activeDelivery?.consolidated) {
            const shipment = activeDelivery;
            void posApi
              .addSaleDelivery(sale.id, draftToInput(shipment))
              .then(() => {
                const sales = [...(shipment.shipmentSales ?? []), sale.saleNumber];
                setDelivery({ ...shipment, shipmentSales: sales });
                void queryClient.invalidateQueries({ queryKey: posKeys.all });
                toast.success(
                  `Venta ${sale.saleNumber} sumada al envío consolidado (${sales.length} venta(s)).`,
                );
              })
              .catch((err) => {
                toast.error(
                  getApiErrorMessage(err, 'No se pudo sumar la venta al envío'),
                );
              });
            return;
          }
          setAttachSale({
            id: sale.id,
            saleNumber: sale.saleNumber,
            customerId: sale.customerId,
            customerName: sale.customerName,
            customerNumber: sale.customerNumber,
          });
          setDeliveryOpenSeq((n) => n + 1);
          setDeliveryOpen(true);
        }}
        currencySymbol={currencySymbol}
        branchTz={branchTz}
        branchName={branch.name}
        ticketName={branch.ticketName}
        branchCountryCode={branch.country?.code}
        invoicingEnabled={effectiveInvoicingEnabled}
        onInvoiceSale={(id) => setInvoiceSaleId(id)}
      />

      {/* Facturar una venta ya cobrada (desde la lista o el detalle) */}
      <InvoiceSaleModal
        saleId={invoiceSaleId}
        onClose={() => setInvoiceSaleId(null)}
        currencySymbol={currencySymbol}
        branchTz={branchTz}
        branchCountryCode={branch.country?.code}
        invoicingEnabled={effectiveInvoicingEnabled}
      />

      {/* Modal de reintento de timbrado CFDI */}
      <StampRetryModal
        state={stampRetry}
        onClose={() => setStampRetry(null)}
        onStamped={() => setStampRetry(null)}
      />

      {/* Modal de configuracion de impresora termica */}
      <PrinterSettingsModal
        isOpen={printerSettingsOpen}
        onClose={() => setPrinterSettingsOpen(false)}
        branchName={branch.name}
      />

      {/* Checador de asistencia (webcam + numero de empleado) */}
      <AttendanceModal
        isOpen={attendanceOpen}
        onClose={() => setAttendanceOpen(false)}
        branch={branch}
      />

      {/* Login OCULTO del modo staff (clic al logo del header) */}
      <StaffLoginModal
        isOpen={staffLoginOpen}
        onClose={() => setStaffLoginOpen(false)}
        terminalBranchId={session.branch.id}
        onEntered={(b) => {
          setStaffLoginOpen(false);
          setDeliveryMode(false);
          setConsolidated(false);
          setDelivery(null);
          usePosOrderTabs.getState().reset();
          toast.success(
            `Modo staff activo — operando sucursal ${b.code} — ${b.name}`,
          );
        }}
      />

      {/* Confirmacion de cierre de sesion */}
      <DeactivateConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={async () => {
          // Al desactivar la terminal también muere la sesión staff en memoria.
          staffLogout();
          await onLogout();
          setShowConfirm(false);
        }}
        licenseKey={session.license.licenseKey}
      />
    </div>
  );
}
