// SaleDetailModal - Detalle de una venta + reimpresion de ticket + cancelacion.
// Se abre al hacer click en una venta de la barra lateral de ventas recientes.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  Ban,
  Receipt,
  Printer,
  FileText,
  Mail,
  Send,
  Ticket,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { posKeys, usePosSale, useCancelSale } from '@/hooks/usePos';
import { useStaffSession } from '@/stores/staff-session.store';
import { posApi } from '@/lib/posApi';
import { getApiErrorMessage } from '@/lib/apiError';
import { formatDateTime } from '@/lib/date';
import { canInvoiceSale } from '@/lib/invoiceEligibility';
import type { Sale, SaleEventTicket } from '@/types/pos';
import {
  INVOICE_STATUS_LABELS,
  firstRecipient,
  looksLikeEmail,
} from '@/lib/invoiceEmail';
import { resolveComponentsForLines } from '@/lib/kitComponents';
import { PosSaleStatus, type KitComponent } from '@/types/pos';

interface SaleDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleId: string | null;
  currencySymbol: string;
  /** Zona horaria de la sucursal (para mostrar la fecha/hora en su hora local). */
  branchTz?: string;
  /** Datos de la sucursal para la REIMPRESION del ticket. */
  branchName: string;
  ticketName?: string;
  /** ISO-2 del país de la sucursal (CFDI solo en MX / FN). */
  branchCountryCode?: string;
  /** Interruptor "Facturación" de la terminal. undefined = apagado. */
  invoicingEnabled?: boolean;
  /** Abre "Facturar" para esta venta (cobrada, sin factura, del mes). */
  onInvoiceSale?: (saleId: string) => void;
  /** MODO STAFF: permite agregar entrega a domicilio a una venta ya cobrada
   *  (capturada sin ella). */
  staffMode?: boolean;
  onAddDelivery?: (sale: Sale) => void;
  /** Texto del botón cuando hay un envío consolidado abierto. */
  attachLabel?: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'T. Debito',
  credit: 'T. Credito',
  transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
  deposit: 'Depósito',
  cashback: 'Cashback',
  promotion: 'Promocion',
  usd_cash: 'USD Efectivo',
  mixed: 'Mixto',
  undefined: 'Sin definir',
};

export function SaleDetailModal({
  isOpen,
  onClose,
  saleId,
  currencySymbol,
  branchTz,
  branchName,
  ticketName,
  branchCountryCode,
  invoicingEnabled = false,
  onInvoiceSale,
  staffMode = false,
  onAddDelivery,
  attachLabel,
}: SaleDetailModalProps) {
  const { data: sale, isLoading } = usePosSale(saleId ?? undefined, isOpen);
  const qc = useQueryClient();
  const cancelSale = useCancelSale();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [reprinting, setReprinting] = useState(false);
  // Factura: abrir el PDF y reenviarla por correo (formulario inline).
  const [openingPdf, setOpeningPdf] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  // Boletos de evento de la venta (vacío si no es venta de evento o el API es
  // anterior); se pueden (re)enviar a otro correo si el del cliente rebotó.
  const [tickets, setTickets] = useState<SaleEventTicket[]>([]);
  const [ticketsEmail, setTicketsEmail] = useState('');
  const [sendingTickets, setSendingTickets] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowCancel(false);
      setReason('');
      setShowResend(false);
      setResendEmail('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !sale?.id) {
      setTickets([]);
      return;
    }
    let cancelled = false;
    posApi
      .getSaleTickets(sale.id)
      .then((list) => {
        if (cancelled) return;
        setTickets(list);
        const known = list.find((t) => t.emailedTo || t.attendeeEmail);
        setTicketsEmail(known?.emailedTo || known?.attendeeEmail || '');
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sale?.id]);

  const busy =
    cancelSale.isPending ||
    reprinting ||
    openingPdf ||
    sendingEmail ||
    sendingTickets;
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  // Cancelar ventas (regla 19-ago-2026): SOLO Operaciones y administracion
  // central — el server lo exige con @Roles; aqui ademas se oculta la opcion
  // y se muestra a sucursales/call center/cedeas como solicitarla.
  const staffUser = useStaffSession((s) => s.user);
  const CANCEL_ROLES = ['super_admin', 'administrador', 'admin', 'operaciones'];
  const roleAllowsCancel =
    !!staffUser && CANCEL_ROLES.includes(staffUser.roleCode ?? '');
  const saleCancellable =
    sale &&
    (sale.status === PosSaleStatus.COMPLETED ||
      sale.status === PosSaleStatus.PENDING);
  const canCancel = saleCancellable && roleAllowsCancel;
  // Reimprimir: solo ventas COMPLETADAS (pendientes no tienen cobro y
  // canceladas no deben regenerar ticket).
  const canReprint = sale && sale.status === PosSaleStatus.COMPLETED;
  // Facturar después del cobro: mismas reglas que el API (ver
  // lib/invoiceEligibility). Sin handler no se ofrece.
  const canInvoice =
    !!sale &&
    !!onInvoiceSale &&
    canInvoiceSale({ sale, branchCountryCode, branchTz, invoicingEnabled });

  async function handleReprint() {
    if (!sale) return;
    setReprinting(true);
    try {
      const cashReceived = sale.payments.reduce(
        (s, p) => s + (Number(p.amountReceived) || 0),
        0,
      );
      const changeGiven = sale.payments.reduce(
        (s, p) => s + (Number(p.changeGiven) || 0),
        0,
      );
      // Contenido de kits/paquetes/promos, igual que el ticket original. Si
      // el detalle trae productType se consulta solo esas líneas; con APIs
      // anteriores (sin productType) se consulta cada producto de la venta y
      // se imprime lo que tenga contenido. Tolerante: nunca bloquea.
      const detailHasType = sale.items.some((it) => it.productType != null);
      const componentsByProduct = await resolveComponentsForLines(
        sale.items,
        {
          // Modo staff (JWT de usuario): el API exige la sucursal; la de la
          // venta es la correcta aunque el operador haya cambiado de sucursal.
          branchId: staffUser ? sale.branchId : undefined,
          branchCountryCode,
        },
        { onlyKitLike: detailHasType },
      ).catch(() => new Map<string, KitComponent[]>());

      // openDrawer=false: una reimpresion NUNCA abre el cajon de dinero.
      const r = await window.toniclife.printer.printSale(
        {
          branchName,
          ticketName,
          saleNumber: sale.saleNumber,
          createdAt: sale.createdAt,
          customerName: sale.customerName ?? undefined,
          customerNumber: sale.customerNumber ?? undefined,
          currencySymbol,
          items: sale.items.map((it) => {
            const comps = componentsByProduct.get(it.productId);
            return {
              name: it.productName,
              sku: it.productSku,
              quantity: it.quantity,
              unitPrice: Number(it.unitPrice),
              total: Number(it.total),
              // Cantidad impresa = por unidad × cantidad de la línea.
              components: comps?.map((c) => ({
                name: c.name,
                quantity: c.quantity * it.quantity,
              })),
            };
          }),
          subtotal: Number(sale.subtotal),
          discountAmount: Number(sale.discountAmount) || 0,
          taxAmount: Number(sale.taxAmount),
          total: Number(sale.total),
          payments: sale.payments.map((p) => ({
            label: PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod,
            amount: Number(p.amount),
          })),
          amountReceived: cashReceived > 0 ? cashReceived : undefined,
          changeGiven,
          currencyCode: sale.currencyCode ?? undefined,
          // Reimpresión: puntos de la venta desde los items (por unidad ×
          // cantidad); "totales" = snapshot del saldo al momento de la venta.
          salePoints: sale.items.reduce(
            (s, it) => s + (it.points ?? 0) * it.quantity,
            0,
          ),
          periodPoints: sale.accumulatedPoints,
        },
        false,
      );
      if (r.ok) {
        toast.success(`Ticket ${sale.saleNumber} reimpreso`);
      } else {
        toast.error('No se pudo imprimir el ticket', { description: r.error });
      }
    } catch (err) {
      toast.error(
        `Error al imprimir: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setReprinting(false);
    }
  }

  async function handleOpenPdf() {
    if (!sale) return;
    setOpeningPdf(true);
    try {
      const { bytes, filename } = await posApi.getInvoicePdf(
        sale.id,
        sale.saleNumber,
      );
      const r = await window.toniclife.invoice.openPdf(
        filename,
        new Uint8Array(bytes),
      );
      if (!r.ok) {
        toast.error('No se pudo abrir el PDF', { description: r.error });
      }
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, 'No se pudo descargar el PDF de la factura'),
      );
    } finally {
      setOpeningPdf(false);
    }
  }

  /** Abre el formulario de reenvío con el último destinatario o, si nunca se
   *  envió, con el correo fiscal guardado del cliente (404 = sin datos). */
  async function handleShowResend() {
    if (!sale) return;
    setShowResend(true);
    const last = firstRecipient(sale.invoice?.emailedTo);
    if (last) {
      setResendEmail(last);
      return;
    }
    if (!sale.customerId) return;
    try {
      const rows = await posApi.getCustomerFiscalData(sale.customerId);
      const fd = rows.find((r) => r.isDefault) ?? rows[0];
      if (fd?.email) setResendEmail((cur) => cur || fd.email || '');
    } catch {
      // Sin red o error del API: el cajero captura el correo a mano.
    }
  }

  async function handleSendEmail() {
    if (!sale) return;
    const email = resendEmail.trim();
    if (!looksLikeEmail(email)) {
      toast.error('Captura un correo válido');
      return;
    }
    setSendingEmail(true);
    try {
      const r = await posApi.sendInvoiceEmail(sale.id, [email]);
      toast.success(`Factura enviada a ${r.sentTo.join(', ')}`);
      setShowResend(false);
      // El detalle debe reflejar el nuevo envío (fecha y conteo).
      void qc.invalidateQueries({ queryKey: posKeys.all });
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, 'No se pudo enviar la factura por correo'),
      );
    } finally {
      setSendingEmail(false);
    }
  }

  async function handleSendTickets() {
    if (!sale) return;
    const email = ticketsEmail.trim();
    if (!looksLikeEmail(email)) {
      toast.error('Captura un correo válido para los boletos');
      return;
    }
    setSendingTickets(true);
    try {
      const r = await posApi.sendSaleTicketsEmail(sale.id, email);
      toast.success(`${r.tickets} boleto(s) enviado(s) a ${r.sentTo}`);
      setTickets((prev) =>
        prev.map((t) =>
          t.status === 'cancelled'
            ? t
            : { ...t, emailedTo: r.sentTo, emailStatus: 'sent' },
        ),
      );
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, 'No se pudieron enviar los boletos'),
      );
    } finally {
      setSendingTickets(false);
    }
  }

  async function handleCancel() {
    if (!sale || !reason.trim()) {
      toast.error('Indica el motivo de la cancelacion');
      return;
    }
    try {
      await cancelSale.mutateAsync({
        saleId: sale.id,
        input: { cancellationReason: reason.trim() },
      });
      toast.success(`Venta ${sale.saleNumber} cancelada`);
      onClose();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message || 'Error al cancelar la venta',
      );
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="z-[60] max-w-lg max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                {sale ? `Venta ${sale.saleNumber}` : 'Detalle de venta'}
              </DialogTitle>
              {sale && (
                <DialogDescription className="flex items-center gap-1.5 text-xs">
                  <span>
                    {formatDateTime(sale.createdAt, branchTz)} · {sale.sellerName}
                  </span>
                  {/* Canal de captura: la terminal de la sucursal vs una cuenta
                      personal (modo staff / call center). Migradas: folio M-. */}
                  {sale.saleNumber.startsWith('M-') ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Migrada del legacy
                    </span>
                  ) : sale.capturedVia === 'usuario' ? (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                      Call center / corporativo
                    </span>
                  ) : sale.capturedVia === 'terminal' ? (
                    <span
                      className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                      title={sale.posLicenseKey ?? undefined}
                    >
                      {/* Etiqueta de la terminal que cobró (varias cajas). */}
                      {sale.posLicenseLabel
                        ? `Terminal: ${sale.posLicenseLabel}`
                        : 'Terminal de sucursal'}
                    </span>
                  ) : null}
                </DialogDescription>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {isLoading || !sale ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Cargando venta...
            </div>
          ) : (
            <>
              {/* Estado + cliente */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {sale.customerName ?? 'Venta a publico'}
                  {sale.customerNumber ? (
                    <span className="ml-1 font-mono text-xs">
                      #{sale.customerNumber}
                    </span>
                  ) : null}
                </span>
                {sale.status === PosSaleStatus.CANCELLED ? (
                  <Badge variant="destructive">{sale.status}</Badge>
                ) : sale.status === PosSaleStatus.COMPLETED ? (
                  <Badge className="bg-emerald-100 text-emerald-700">
                    {sale.status}
                  </Badge>
                ) : sale.status === PosSaleStatus.PENDING ? (
                  <Badge className="bg-amber-100 text-amber-700">
                    {sale.status}
                  </Badge>
                ) : (
                  <Badge className="bg-purple-100 text-purple-700">
                    {sale.status}
                  </Badge>
                )}
              </div>

              {/* Entrega a domicilio ligada, o (modo staff) agregarla a una
                  venta ya cobrada que se capturó sin ella. */}
              {sale.delivery ? (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                    sale.delivery.status === 'cancelled'
                      ? 'border-muted bg-muted/40 text-muted-foreground'
                      : 'border-violet-200 bg-violet-50 text-violet-900'
                  }`}
                >
                  <Truck className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      Entrega a domicilio · {sale.delivery.statusLabel}
                    </p>
                    <p>
                      Recibe {sale.delivery.recipientName}
                      {sale.delivery.recipientPhone
                        ? ` · ${sale.delivery.recipientPhone}`
                        : ''}
                    </p>
                    <p className="text-muted-foreground">{sale.delivery.addressText}</p>
                    {(sale.delivery.carrier || sale.delivery.trackingNumber) && (
                      <p className="font-medium">
                        {sale.delivery.carrier ?? 'Paquetería'}
                        {sale.delivery.trackingNumber
                          ? ` · guía ${sale.delivery.trackingNumber}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
              ) : staffMode &&
                onAddDelivery &&
                sale.status === PosSaleStatus.COMPLETED ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAddDelivery(sale)}
                  disabled={busy}
                  className="w-full gap-1.5 border-violet-300 text-violet-800 hover:bg-violet-50"
                  title="Confirmar destinatario y domicilio; Almacén la surte"
                >
                  <Truck className="size-4" />
                  {attachLabel ?? 'Agregar entrega a domicilio a esta venta'}
                </Button>
              ) : null}

              {/* Items */}
              <div className="rounded-lg border overflow-hidden">
                <Table className="text-sm">
                  <TableHeader className="bg-muted/60">
                    <TableRow>
                      <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                        Producto
                      </TableHead>
                      <TableHead className="text-center px-2 py-1.5 font-medium text-muted-foreground">
                        Cant
                      </TableHead>
                      <TableHead className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y">
                    {sale.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="px-3 py-1.5">
                          <div className="text-foreground">
                            {it.productName}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {it.productSku}
                          </div>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-center tabular-nums">
                          {it.quantity}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-right tabular-nums">
                          {fmt(Number(it.total))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totales */}
              <div className="space-y-1 text-sm">
                <Row label="Subtotal" value={fmt(Number(sale.subtotal))} />
                {Number(sale.discountAmount) > 0 && (
                  <Row
                    label="Descuento"
                    value={`- ${fmt(Number(sale.discountAmount))}`}
                  />
                )}
                <Row label="Impuestos" value={fmt(Number(sale.taxAmount))} />
                <div className="flex justify-between pt-1 border-t font-bold text-foreground">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {fmt(Number(sale.total))}
                  </span>
                </div>
              </div>

              {/* Pagos */}
              {sale.payments.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Pagos
                  </h3>
                  <div className="rounded-lg border overflow-hidden">
                    <Table className="text-sm">
                      <TableBody>
                        {sale.payments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="px-3 py-1.5 text-muted-foreground">
                              {PAYMENT_LABELS[p.paymentMethod] ??
                                p.paymentMethod}
                              {p.changeGiven
                                ? ` (cambio ${fmt(Number(p.changeGiven))})`
                                : ''}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums text-foreground">
                              {fmt(Number(p.amount))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Factura nominativa: folio, UUID, estado del PAC y envío por
                  correo (el API la manda al timbrar; aquí se puede reenviar). */}
              {(sale.invoice || sale.invoiceUuid) && (
                <div className="rounded-lg border p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-muted-foreground uppercase tracking-wide">
                      Factura CFDI
                      {sale.invoice?.folioDisplay ? (
                        <span className="ml-2 font-mono normal-case tracking-normal text-foreground">
                          {sale.invoice.folioDisplay}
                        </span>
                      ) : null}
                    </h3>
                    {sale.invoice?.providerStatus && (
                      <Badge
                        variant="outline"
                        className={
                          sale.invoice.providerStatus === 'cancelled'
                            ? 'border-destructive/40 text-destructive'
                            : 'border-emerald-300 text-emerald-700'
                        }
                      >
                        {INVOICE_STATUS_LABELS[sale.invoice.providerStatus] ??
                          sale.invoice.providerStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    UUID{' '}
                    <span className="font-mono text-foreground">
                      {sale.invoice?.satUuid ?? sale.invoiceUuid}
                    </span>
                  </div>
                  {/* Estado del correo sólo cuando el API adjunta `invoice`
                      (API anterior: sólo trae invoiceUuid y no se sabe si se
                      envió; no afirmar "sin enviar" ni ofrecer reenvío). */}
                  {sale.invoice ? (
                    sale.invoice.emailedAt ? (
                      <div className="flex items-start gap-1.5 text-muted-foreground">
                        <Mail className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                        <span>
                          Correo enviado a{' '}
                          <span className="text-foreground">
                            {sale.invoice.emailedTo ?? '—'}
                          </span>{' '}
                          · {formatDateTime(sale.invoice.emailedAt, branchTz)} ·{' '}
                          {sale.invoice.emailCount ?? 1}{' '}
                          {(sale.invoice.emailCount ?? 1) === 1
                            ? 'envío'
                            : 'envíos'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-amber-700">
                        <Mail className="size-3.5 shrink-0" />
                        Sin enviar por correo
                      </div>
                    )
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenPdf}
                      disabled={busy}
                      title="Abrir el PDF para verlo o imprimirlo"
                    >
                      <FileText />
                      {openingPdf ? 'Abriendo…' : 'Ver PDF'}
                    </Button>
                    {sale.invoice && !showResend && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleShowResend}
                        disabled={busy}
                      >
                        <Mail />
                        Reenviar por correo
                      </Button>
                    )}
                  </div>
                  {showResend && (
                    <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
                      <Label className="text-xs">Enviar la factura a</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="email"
                          value={resendEmail}
                          onChange={(e) => setResendEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSendEmail();
                          }}
                          placeholder="correo@ejemplo.com"
                          className="h-8 text-xs"
                          disabled={sendingEmail}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={handleSendEmail}
                          disabled={sendingEmail || !resendEmail.trim()}
                        >
                          <Send />
                          {sendingEmail ? 'Enviando…' : 'Enviar'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowResend(false)}
                          disabled={sendingEmail}
                        >
                          Cancelar
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Se envían el PDF y el XML. Puedes cambiar el correo si el
                        cliente no lo recibió.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* Boletos de evento: estado de envío y reenvío a otro correo */}
              {tickets.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-[#a7c1e2] bg-[#C8DDF2]/20 p-2">
                  <p className="flex items-center gap-1 text-xs font-medium text-[#2f5165]">
                    <Ticket className="size-3.5" />
                    Boletos de evento ({tickets.length})
                  </p>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {tickets.map((t) => (
                      <li key={t.id} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-foreground">
                          {t.ticketNumber}
                        </span>
                        {t.label ? <span>· {t.label}</span> : null}
                        {t.status === 'cancelled' ? (
                          <span className="text-destructive">· cancelado</span>
                        ) : t.emailStatus === 'sent' &&
                          (t.emailedTo || t.attendeeEmail) ? (
                          <span>· enviado a {t.emailedTo || t.attendeeEmail}</span>
                        ) : (
                          <span className="text-amber-700">· sin enviar</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Label className="text-xs">Enviar los boletos a</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={ticketsEmail}
                      onChange={(e) => setTicketsEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSendTickets();
                      }}
                      placeholder="correo@ejemplo.com"
                      className="h-8 text-xs bg-card"
                      disabled={sendingTickets}
                    />
                    <Button
                      size="sm"
                      onClick={handleSendTickets}
                      disabled={sendingTickets || !ticketsEmail.trim()}
                    >
                      <Send />
                      {sendingTickets ? 'Enviando…' : 'Enviar'}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Si el correo rebotó o el cliente quiere recibirlos en otro,
                    cámbialo aquí y vuelve a enviar.
                  </p>
                </div>
              )}
              {sale.globalInvoiceId && (
                <div className="text-xs text-muted-foreground">
                  Incluida en la{' '}
                  <span className="font-medium text-foreground">
                    factura global
                  </span>{' '}
                  del día; ya no admite factura nominativa.
                </div>
              )}

              {/* Cancelacion */}
              {sale.status === PosSaleStatus.CANCELLED && (
                <Alert variant="destructive" className="text-xs">
                  <Ban />
                  <AlertDescription className="text-xs text-destructive">
                    Cancelada
                    {sale.cancelledByName
                      ? ` por ${sale.cancelledByName}`
                      : ''}
                    {sale.cancellationReason
                      ? ` — ${sale.cancellationReason}`
                      : ''}
                  </AlertDescription>
                </Alert>
              )}

              {saleCancellable && !roleAllowsCancel && (
                <Alert className="text-xs">
                  <Ban />
                  <AlertDescription className="text-xs">
                    La cancelación de ventas está a cargo del departamento de
                    Operaciones. Si necesitas cancelar esta venta, solicítalo a
                    Operaciones indicando el folio{' '}
                    <span className="font-mono font-semibold">
                      {sale.saleNumber}
                    </span>{' '}
                    y el motivo.
                  </AlertDescription>
                </Alert>
              )}

              {showCancel && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <Label className="block text-sm font-medium text-destructive">
                    Motivo de la cancelacion
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Describe por que se cancela la venta..."
                    className="w-full px-3 py-2 border rounded-md text-sm resize-none bg-background"
                    autoFocus
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancel}
                    disabled={cancelSale.isPending}
                  >
                    {cancelSale.isPending
                      ? 'Cancelando...'
                      : 'Confirmar cancelacion'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row items-center justify-between px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          {canCancel && !showCancel ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancel(true)}
              disabled={busy}
              className="text-destructive border-destructive/40 hover:bg-destructive/5"
            >
              <Ban />
              Cancelar venta
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {canInvoice && sale && (
              <Button
                variant="outline"
                onClick={() => onInvoiceSale?.(sale.id)}
                disabled={busy}
                title="Facturar esta venta"
              >
                <FileText />
                Facturar
              </Button>
            )}
            {canReprint && (
              <Button
                variant="outline"
                onClick={handleReprint}
                disabled={busy}
                data-tour="pos-reprint"
              >
                <Printer />
                {reprinting ? 'Imprimiendo…' : 'Reimprimir ticket'}
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
