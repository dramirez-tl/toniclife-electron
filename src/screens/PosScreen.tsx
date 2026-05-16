// PosScreen - Pantalla principal del POS.
//
// Phase 4 completa: catalogo + carrito + cliente + cobro + sesiones + corte
// + ventas recientes + movimientos de caja + kits de inscripcion + CFDI.

import { useState } from 'react';
import { LogOut, Clock, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { LogoMark } from '@/components/LogoMark';
import { LiveClock } from '@/components/LiveClock';
import { Button } from '@/components/ui/button';
import { DeactivateConfirmDialog } from '@/components/DeactivateConfirmDialog';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { Cart } from '@/components/pos/Cart';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { RecentSales } from '@/components/pos/RecentSales';
import { CorteModal } from '@/components/pos/CorteModal';
import { CashMovementModal } from '@/components/pos/CashMovementModal';
import { KitProspectModal } from '@/components/pos/KitProspectModal';
import { SaleDetailModal } from '@/components/pos/SaleDetailModal';
import {
  StampRetryModal,
  type StampRetryState,
} from '@/components/pos/StampRetryModal';
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  useCreateSale,
  useProcessPayment,
  usePosActiveSession,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
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
}

/** Simbolo de moneda — MXN/USD usan '$'; el resto cae al propio codigo. */
function currencySymbolFor(code?: string): string {
  if (!code) return '$';
  if (code === 'MXN' || code === 'USD') return '$';
  return code + ' ';
}

export function PosScreen({ session, onLogout }: PosScreenProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [corteOpen, setCorteOpen] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [pendingKit, setPendingKit] = useState<QuickProduct | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [stampRetry, setStampRetry] = useState<StampRetryState | null>(null);
  const [salesDate, setSalesDate] = useState(todayLocal());

  const cart = usePosCartStore((s) => s.cart);
  const clearCart = usePosCartStore((s) => s.clearCart);
  const setCustomer = usePosCartStore((s) => s.setCustomer);
  const addItem = usePosCartStore((s) => s.addItem);
  const createSale = useCreateSale();
  const processPayment = useProcessPayment();

  const branchId = session.branch.id;
  const currencyCode = session.branch.currencyCode ?? 'MXN';
  const currencySymbol = currencySymbolFor(session.branch.currencyCode);

  const { data: activeSession } = usePosActiveSession(branchId);

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
      });

      const result = await processPayment.mutateAsync({
        saleId: sale.id,
        payments,
      });

      const changeMsg =
        result.changeGiven > 0
          ? ` — Cambio: ${posApi.formatCurrency(result.changeGiven, currencySymbol)}`
          : '';
      toast.success(`Venta ${result.saleNumber} cobrada${changeMsg}`);

      clearCart();
      setPaymentOpen(false);

      // Facturacion CFDI: guardar datos fiscales del cliente y timbrar.
      // Si falla, abrimos el modal de reintento (la venta YA quedo cobrada).
      if (invoice) {
        try {
          await posApi.saveFiscalData(invoice.fiscalData);
          await posApi.stampSale(sale.id, invoice.invoicePaymentMethod);
          toast.success('Factura timbrada correctamente');
        } catch (stampErr) {
          const se = stampErr as {
            response?: { data?: { message?: string } };
          };
          setStampRetry({
            saleId: sale.id,
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
      `${result.fullName} (${result.customerNumber})`,
      undefined,
      cart.priceTypeId,
    );
    addItem(kit, 1);
    toast.success(`Kit ${kit.sku} agregado para ${result.fullName}`);
    setPendingKit(null);
  }

  return (
    <div className="h-full w-full flex flex-col bg-muted/30">
      {/* Barra superior */}
      <header className="h-14 bg-primary text-primary-foreground flex items-center px-5 gap-4 shrink-0">
        <LogoMark size={44} variant="icon-blue" avatar />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-tight">
            Tonic Life POS
          </div>
          <div className="text-xs text-white/80 truncate">
            {session.branch.code} — {session.branch.name}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-white/85 mr-1">
          <Clock className="size-4" />
          <LiveClock timezone={session.branch.timezone} />
        </div>
        <div className="text-xs text-white/70 text-right mr-2">
          <div className="font-mono">{session.license.licenseKey}</div>
          {session.license.label && <div>{session.license.label}</div>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPrinterSettingsOpen(true)}
          className="text-white/80 hover:text-white hover:bg-white/10"
          title="Configurar impresora termica"
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

      {/* Cuerpo: ventas recientes + catalogo + carrito */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-72 shrink-0">
          <RecentSales
            branchId={branchId}
            currencySymbol={currencySymbol}
            date={salesDate}
            onDateChange={setSalesDate}
            onOpenCorte={() => setCorteOpen(true)}
            onOpenMovements={() => setMovementsOpen(true)}
            onSelectSale={(id) => setSelectedSaleId(id)}
          />
        </aside>
        <main className="flex-1 min-w-0">
          <ProductGrid
            branchId={branchId}
            currencySymbol={currencySymbol}
            onKitDetected={handleKitDetected}
          />
        </main>
        <aside className="w-96 shrink-0">
          <Cart
            currencySymbol={currencySymbol}
            currencyCode={currencyCode}
            isProcessing={isProcessing}
            onCheckout={() => {
              if (cart.items.length === 0) return;
              setPaymentOpen(true);
            }}
          />
        </aside>
      </div>

      {/* Modal de cobro (incluye seccion CFDI) */}
      <PaymentModal
        isOpen={paymentOpen}
        onClose={() => !isProcessing && setPaymentOpen(false)}
        total={cart.total}
        currencySymbol={currencySymbol}
        currencyCode={currencyCode}
        customerId={cart.customerId}
        customerRfc={cart.customerRfc}
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
        onEnrolled={handleKitEnrolled}
      />

      {/* Modal de detalle / cancelacion de venta */}
      <SaleDetailModal
        isOpen={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        saleId={selectedSaleId}
        currencySymbol={currencySymbol}
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
