// PosScreen - Pantalla principal del POS.
//
// Phase 4 completa: catalogo + carrito + cliente + cobro + sesiones + corte
// + ventas recientes + movimientos de caja + kits de inscripcion + CFDI.

import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { LogoMark } from '@/components/LogoMark';
import { LiveClock } from '@/components/LiveClock';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Button } from '@/components/ui/button';
import { DeactivateConfirmDialog } from '@/components/DeactivateConfirmDialog';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { AvailablePromotions } from '@/components/pos/AvailablePromotions';
import { Cart } from '@/components/pos/Cart';
import { ResizeHandle } from '@/components/pos/ResizeHandle';
import { TransfersModal } from '@/components/pos/TransfersModal';
import { CurrentPromotionsModal } from '@/components/pos/CurrentPromotionsModal';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { RecentSales } from '@/components/pos/RecentSales';
import { CorteModal } from '@/components/pos/CorteModal';
import { CashMovementModal } from '@/components/pos/CashMovementModal';
import { KitProspectModal } from '@/components/pos/KitProspectModal';
import { RegisterDistributorModal } from '@/components/pos/RegisterDistributorModal';
import { SaleDetailModal } from '@/components/pos/SaleDetailModal';
import {
  StampRetryModal,
  type StampRetryState,
} from '@/components/pos/StampRetryModal';
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal';
import { ComingSoonGate } from '@/components/pos/ComingSoonGate';
import { hasSeenPosTour, startPosTour } from '@/lib/posTour';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  useCreateSale,
  useProcessPayment,
  usePosActiveSession,
  useIncomingTransfers,
  usePosCatalog,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { APP_VERSION } from '@/lib/version';
import { todayLocal } from '@/lib/date';
import type { StoredSession } from '@/types';
import type {
  CreatePaymentInput,
  InvoiceRequest,
  QuickProduct,
  KitEnrollmentResponse,
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
  onRefresh,
}: PosScreenProps) {
  // Rollout: cuerpo bloqueado ("próximamente"). El header sigue vivo para poder
  // configurar la impresora. Se libera solo cuando el super admin habilita.
  const posLocked = !operationsEnabled;
  const [refreshing, setRefreshing] = useState(false);

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
  const [pendingKit, setPendingKit] = useState<QuickProduct | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [stampRetry, setStampRetry] = useState<StampRetryState | null>(null);
  // "Hoy" y todas las horas se calculan en la zona horaria de la SUCURSAL
  // (no la del equipo): una venta a las 00:26 en Tulsa es del día correcto.
  const [salesDate, setSalesDate] = useState(todayLocal(session.branch.timezone));

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

  const branchId = session.branch.id;
  const branchTz = session.branch.timezone;
  const currencyCode = session.branch.currencyCode ?? 'MXN';
  const currencySymbol = currencySymbolFor(session.branch.currencyCode);

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

  /**
   * Asegura que exista una sesion de caja. Si no hay, auto-abre una con la
   * primera caja disponible y monto de apertura 0.
   */
  async function ensureSession(): Promise<string> {
    const active = await posApi.getActiveSession(branchId);
    if (active?.session?.id) return active.session.id;

    const registers = await posApi.getAvailableRegisters(branchId);
    if (registers.length === 0) {
      throw new Error(
        'No hay una caja registradora configurada para esta sucursal. ' +
          'Pide al equipo de Sistemas que cree una.',
      );
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

      // Si el carrito cambió desde el último intento fallido, el intento
      // anterior ya no aplica (la venta pendiente vieja queda para limpieza
      // del corte); se genera una clave nueva.
      const fingerprint = JSON.stringify({
        customerId: cart.customerId,
        items: cart.items.map((it) => [
          it.productId,
          it.quantity,
          it.discountPercent ?? null,
          it.discountAmount ?? null,
        ]),
        discountPercent: cart.discountPercent ?? null,
        discountAmount: cart.discountAmount ?? null,
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
        const sale = await createSale.mutateAsync({
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
          requiresInvoice: !!invoice,
          notes: cart.notes,
          clientRequestId: attempt.clientRequestId,
        });
        attempt.saleId = sale.id;
        saleId = sale.id;
      }

      const result = await processPayment.mutateAsync({
        saleId,
        payments,
      });

      // Cobro exitoso: liberar el intento para que la próxima venta genere
      // su propia clave.
      saleAttemptRef.current = null;

      const changeMsg =
        result.changeGiven > 0
          ? ` — Cambio: ${posApi.formatCurrency(result.changeGiven, currencySymbol)}`
          : '';
      toast.success(`Venta ${result.saleNumber} cobrada${changeMsg}`);

      // Ticket de venta + cajón (fire-and-forget: si la impresora falla, la
      // venta YA quedó cobrada; solo se avisa). Snapshot del carrito ANTES de
      // limpiarlo. El cajón solo abre si hubo efectivo.
      const PAYMENT_LABELS: Record<string, string> = {
        cash: 'Efectivo',
        card: 'Tarjeta',
        transfer: 'Transferencia',
        credit: 'Crédito',
        mercado_pago: 'Mercado Pago',
        usd_cash: 'Efectivo USD',
        cashback: 'Monedero',
        promotion: 'Promoción',
      };
      const hadCash = payments.some((p) => p.paymentMethod === 'cash');
      const cashReceived = payments.reduce(
        (s, p) => s + (p.amountReceived ?? 0),
        0,
      );
      void window.toniclife.printer
        .printSale(
          {
            branchName: session.branch.name,
            ticketName: session.branch.ticketName,
            saleNumber: result.saleNumber,
            createdAt: new Date().toISOString(),
            customerName: cart.customerName,
            customerNumber: cart.customerNumber,
            currencySymbol,
            items: cart.items.map((it) => ({
              name: it.productName,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              total: it.total,
            })),
            subtotal: cart.subtotal,
            discountAmount: cart.discountAmount ?? 0,
            taxAmount: cart.taxAmount,
            total: cart.total,
            payments: payments.map((p) => ({
              label: PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod,
              amount: p.amount,
            })),
            amountReceived: cashReceived > 0 ? cashReceived : undefined,
            changeGiven: result.changeGiven,
            accumulatedPoints: result.accumulatedPoints,
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
          await posApi.stampSale(saleId, invoice.invoicePaymentMethod);
          toast.success('Factura timbrada correctamente');
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
      const e = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      toast.error(
        e.response?.data?.message ||
          e.message ||
          'Error al procesar la venta',
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function handleKitDetected(product: QuickProduct) {
    if (!cart.customerId) {
      toast.error(
        'Selecciona primero al distribuidor patrocinador en el carrito.',
      );
      return;
    }
    setPendingKit(product);
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
    addItem(kit, 1);
    toast.success(`Kit ${kit.sku} agregado para ${result.fullName}`);
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
      addItem(kit, 1);
      toast.success(`Kit ${kit.sku} agregado para ${result.fullName}`);
    } else {
      toast.success(`Registro completo: ${result.customerNumber}`);
    }
    setRegisterOpen(false);
  }

  return (
    <div className="h-full w-full flex flex-col bg-muted/30">
      {/* Barra superior */}
      <header className="h-14 bg-primary text-primary-foreground flex items-center px-5 gap-4 shrink-0">
        <LogoMark size={44} variant="icon-blue" avatar />
        <div className="flex-1 min-w-0" data-tour="pos-branch">
          <div className="text-sm font-semibold leading-tight">
            Tonic Life POS
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/80">
            {session.branch.country && (
              <span
                className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                title={session.branch.country.name}
              >
                {countryFlag(session.branch.country.code)} {session.branch.country.name}
              </span>
            )}
            {session.branch.legacyKey && (
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                Clave {session.branch.legacyKey}
              </span>
            )}
            <span className="truncate">
              {session.branch.code} — {session.branch.name}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4" data-tour="pos-status">
          <ConnectionStatus />
          <div className="h-5 w-px bg-white/20" />
          <div className="flex items-center gap-1.5 text-sm text-white/85 mr-1">
            <Clock className="size-4 shrink-0" />
            <LiveClock
              timezone={session.branch.timezone}
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
              branchTz={branchTz}
              currencySymbol={currencySymbol}
              date={salesDate}
              onDateChange={setSalesDate}
              onOpenCorte={() => setCorteOpen(true)}
              onOpenMovements={() => setMovementsOpen(true)}
              onSelectSale={(id) => setSelectedSaleId(id)}
              onCollapse={() => toggleSalesPanel(true)}
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
        <aside className="shrink-0" style={{ width: cartWidth }} data-tour="pos-cart">
          <Cart
            currencySymbol={currencySymbol}
            currencyCode={currencyCode}
            isProcessing={isProcessing}
            onCheckout={() => {
              if (cart.items.length === 0) return;
              // Venta en $0 por promo: no hay nada que cobrar ni facturar →
              // se completa directo, sin abrir el modal de pago.
              const hasPromo = cart.items.some(
                (it) => it.productType === 'promotional',
              );
              if (cart.total === 0 && hasPromo) {
                void handlePaymentConfirm([]);
                return;
              }
              setPaymentOpen(true);
            }}
          />
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
        branchCountry={session.branch.country?.code}
        customerId={cart.customerId}
        customerRfc={cart.customerRfc}
        invoicingEnabled={invoicingEnabled}
        isProcessing={isProcessing}
        onConfirm={handlePaymentConfirm}
      />

      {/* Modal de corte del dia */}
      <CorteModal
        isOpen={corteOpen}
        onClose={() => setCorteOpen(false)}
        branchId={branchId}
        branchName={session.branch.name}
        date={salesDate}
        currencySymbol={currencySymbol}
        onSelectSale={(id) => setSelectedSaleId(id)}
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
      />

      {/* Promociones vigentes del país de la sucursal (solo informativo) */}
      <CurrentPromotionsModal
        isOpen={promosOpen}
        onClose={() => setPromosOpen(false)}
        branchId={branchId}
        branchName={session.branch.name}
      />

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
        branchCountryCode={session.branch.country?.code}
        onEnrolled={handleKitEnrolled}
      />

      {/* Modal de alta de distribuidor (patrocinador por numero, kit opcional) */}
      <RegisterDistributorModal
        isOpen={registerOpen}
        onClose={() => setRegisterOpen(false)}
        branchId={branchId}
        branchCountryCode={session.branch.country?.code}
        enrollmentKits={enrollmentKits}
        onRegistered={handleDistributorRegistered}
      />

      {/* Modal de detalle / cancelacion de venta */}
      <SaleDetailModal
        isOpen={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        saleId={selectedSaleId}
        currencySymbol={currencySymbol}
        branchTz={branchTz}
        branchName={session.branch.name}
        ticketName={session.branch.ticketName}
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
        branchName={session.branch.name}
      />

      {/* Confirmacion de cierre de sesion */}
      <DeactivateConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={async () => {
          await onLogout();
          setShowConfirm(false);
        }}
        licenseKey={session.license.licenseKey}
      />
    </div>
  );
}
