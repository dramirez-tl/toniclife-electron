// SaleDetailModal - Detalle de una venta + reimpresion de ticket + cancelacion.
// Se abre al hacer click en una venta de la barra lateral de ventas recientes.

import { useEffect, useState } from 'react';
import { X, Ban, Receipt, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { usePosSale, useCancelSale } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';
import { PosSaleStatus } from '@/types/pos';

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
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'T. Debito',
  credit: 'T. Credito',
  transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
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
}: SaleDetailModalProps) {
  const { data: sale, isLoading } = usePosSale(saleId ?? undefined, isOpen);
  const cancelSale = useCancelSale();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [reprinting, setReprinting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowCancel(false);
      setReason('');
    }
  }, [isOpen]);

  const busy = cancelSale.isPending || reprinting;
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const canCancel =
    sale &&
    (sale.status === PosSaleStatus.COMPLETED ||
      sale.status === PosSaleStatus.PENDING);
  // Reimprimir: solo ventas COMPLETADAS (pendientes no tienen cobro y
  // canceladas no deben regenerar ticket).
  const canReprint = sale && sale.status === PosSaleStatus.COMPLETED;

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
      // openDrawer=false: una reimpresion NUNCA abre el cajon de dinero.
      const r = await window.toniclife.printer.printSale(
        {
          branchName,
          ticketName,
          saleNumber: sale.saleNumber,
          createdAt: sale.createdAt,
          customerName: sale.customerName ?? undefined,
          currencySymbol,
          items: sale.items.map((it) => ({
            name: it.productName,
            quantity: it.quantity,
            unitPrice: Number(it.unitPrice),
            total: Number(it.total),
          })),
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
          accumulatedPoints: sale.accumulatedPoints,
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
                <DialogDescription className="text-xs">
                  {formatDateTime(sale.createdAt, branchTz)} · {sale.sellerName}
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

              {/* Factura */}
              {sale.invoiceUuid && (
                <div className="text-xs text-muted-foreground">
                  Factura CFDI:{' '}
                  <span className="font-mono">{sale.invoiceUuid}</span>
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
