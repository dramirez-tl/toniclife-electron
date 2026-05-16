// SaleDetailModal - Detalle de una venta + cancelacion.
// Se abre al hacer click en una venta de la barra lateral de ventas recientes.

import { useEffect, useState } from 'react';
import { X, Ban, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePosSale, useCancelSale } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';
import { PosSaleStatus } from '@/types/pos';

interface SaleDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleId: string | null;
  currencySymbol: string;
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
}: SaleDetailModalProps) {
  const { data: sale, isLoading } = usePosSale(saleId ?? undefined, isOpen);
  const cancelSale = useCancelSale();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setShowCancel(false);
      setReason('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const canCancel =
    sale &&
    (sale.status === PosSaleStatus.COMPLETED ||
      sale.status === PosSaleStatus.PENDING);

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-background border rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {sale ? `Venta ${sale.saleNumber}` : 'Detalle de venta'}
              </h2>
              {sale && (
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(sale.createdAt)} · {sale.sellerName}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors"
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

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
                <span
                  className={[
                    'text-xs font-medium px-2 py-0.5 rounded-full',
                    sale.status === PosSaleStatus.COMPLETED
                      ? 'bg-emerald-100 text-emerald-700'
                      : sale.status === PosSaleStatus.CANCELLED
                        ? 'bg-red-100 text-red-700'
                        : sale.status === PosSaleStatus.PENDING
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-purple-100 text-purple-700',
                  ].join(' ')}
                >
                  {sale.status}
                </span>
              </div>

              {/* Items */}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                        Producto
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">
                        Cant
                      </th>
                      <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sale.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5">
                          <div className="text-foreground">
                            {it.productName}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {it.productSku}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums">
                          {it.quantity}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmt(Number(it.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  <div className="rounded-lg border divide-y">
                    {sale.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between px-3 py-1.5 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod}
                          {p.changeGiven
                            ? ` (cambio ${fmt(Number(p.changeGiven))})`
                            : ''}
                        </span>
                        <span className="tabular-nums text-foreground">
                          {fmt(Number(p.amount))}
                        </span>
                      </div>
                    ))}
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
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  Cancelada{sale.cancelledByName ? ` por ${sale.cancelledByName}` : ''}
                  {sale.cancellationReason
                    ? ` — ${sale.cancellationReason}`
                    : ''}
                </div>
              )}

              {showCancel && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <label className="block text-sm font-medium text-destructive">
                    Motivo de la cancelacion
                  </label>
                  <textarea
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
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          {canCancel && !showCancel ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancel(true)}
              className="text-destructive border-destructive/40 hover:bg-destructive/5"
            >
              <Ban />
              Cancelar venta
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
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
