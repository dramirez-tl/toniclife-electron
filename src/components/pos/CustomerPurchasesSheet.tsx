// CustomerPurchasesSheet — Compras anteriores del distribuidor asignado a la
// venta (cualquier sucursal). Call Center lo pidió para consultar qué ha
// comprado un distribuidor sin salir del POS. Clic en el folio abre el
// detalle de la venta (mismo modal del corte).

import { useQuery } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Cobrada',
  pending: 'Sin cobrar',
  cancelled: 'Cancelada',
  refunded: 'Reembolsada',
  partial_refund: 'Reembolso parcial',
};

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

interface CustomerPurchasesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  customerId?: string;
  customerName?: string;
  customerNumber?: string;
  currencySymbol: string;
  branchTz?: string;
  onSelectSale: (saleId: string) => void;
}

export function CustomerPurchasesSheet({
  isOpen,
  onClose,
  customerId,
  customerName,
  customerNumber,
  currencySymbol,
  branchTz,
  onSelectSale,
}: CustomerPurchasesSheetProps) {
  const salesQuery = useQuery({
    queryKey: ['customer-purchases', customerId],
    queryFn: () => posApi.getSales({ customerId, limit: 100 }),
    enabled: isOpen && !!customerId,
    staleTime: 30_000,
  });
  const sales = salesQuery.data?.data ?? [];

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-2xl">
        <SheetHeader className="px-6 pb-1 pt-6">
          <SheetTitle className="flex items-center gap-2">
            <History className="size-5" />
            Compras de {customerName ?? 'distribuidor'}
            {customerNumber ? (
              <span className="font-mono text-sm text-muted-foreground">
                #{customerNumber}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            Ventas en el POS de cualquier sucursal (las más recientes primero).
            Toca el folio para ver el detalle.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
          {salesQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando compras…
            </div>
          ) : salesQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              No se pudieron cargar las compras.
            </p>
          ) : sales.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Este distribuidor no tiene compras registradas en el POS.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        onClick={() => onSelectSale(s.id)}
                      >
                        {s.saleNumber}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(s.createdAt, branchTz)}
                    </TableCell>
                    <TableCell className="text-xs">{s.branchName}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {posApi.formatCurrency(s.total, currencySymbol)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_CLASS[s.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {salesQuery.data && salesQuery.data.total > sales.length && (
          <p className="px-6 pb-4 text-[11px] text-muted-foreground">
            Mostrando las {sales.length} más recientes de {salesQuery.data.total}.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
