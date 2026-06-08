// RecentSales - Barra lateral izquierda del POS.
// Muestra ventas del dia + accesos a movimientos de caja y corte del dia.
// La sesion de caja se abre automaticamente al primer cobro (ver
// ensureSession en PosScreen) — no hay UI manual de apertura.
//
// FEATURE FLAGS: poner en true para reactivar funcionalidad oculta.
const SHOW_CASH_MOVEMENTS = false; // "Movimientos de caja" — ocultado may-2026
                                   // a peticion del usuario; el modal y el
                                   // IPC siguen montados para reactivar.

import {
  Receipt,
  CalendarDays,
  ClipboardList,
  RefreshCw,
  Wallet,
  PanelLeftClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { usePosSales } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatTime } from '@/lib/date';
import { PosSaleStatus, type Sale } from '@/types/pos';

interface RecentSalesProps {
  branchId: string;
  currencySymbol: string;
  date: string;
  onDateChange: (date: string) => void;
  onOpenCorte: () => void;
  onOpenMovements: () => void;
  onSelectSale: (saleId: string) => void;
  /** Si se provee, muestra un botón para plegar el panel. */
  onCollapse?: () => void;
}

function statusBadge(status: PosSaleStatus) {
  switch (status) {
    case PosSaleStatus.COMPLETED:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
          Pagada
        </Badge>
      );
    case PosSaleStatus.PENDING:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
          Pendiente
        </Badge>
      );
    case PosSaleStatus.CANCELLED:
      return (
        <Badge
          variant="destructive"
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
        >
          Cancelada
        </Badge>
      );
    case PosSaleStatus.REFUNDED:
    case PosSaleStatus.PARTIAL_REFUND:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
          Reembolso
        </Badge>
      );
    default:
      return null;
  }
}

export function RecentSales({
  branchId,
  currencySymbol,
  date,
  onDateChange,
  onOpenCorte,
  onOpenMovements,
  onSelectSale,
  onCollapse,
}: RecentSalesProps) {
  const {
    data: salesResp,
    isLoading,
    refetch,
    isFetching,
  } = usePosSales(branchId, date);

  const sales: Sale[] = salesResp?.data ?? [];
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  return (
    <div className="flex flex-col h-full bg-card border-r">
      {/* Filtro de fecha + ventas recientes */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Receipt className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Ventas recientes
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
              title="Actualizar"
            >
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
            </Button>
            {onCollapse && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCollapse}
                className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
                title="Plegar panel"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="relative">
          <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-xs bg-background text-foreground"
          />
        </div>
      </div>

      {/* Lista de ventas */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Cargando...</div>
        ) : sales.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground italic">
            No hay ventas en esta fecha.
          </div>
        ) : (
          <ul className="divide-y">
            {sales.map((sale) => (
              <li key={sale.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectSale(sale.id)}
                  className="block h-auto w-full rounded-none px-4 py-2.5 text-left whitespace-normal hover:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-foreground">
                      {sale.saleNumber}
                    </span>
                    {statusBadge(sale.status)}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(sale.createdAt)}
                      {sale.customerName ? ` · ${sale.customerName}` : ''}
                    </span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {fmt(Number(sale.total))}
                    </span>
                  </div>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Acciones de caja */}
      <div className="p-4 border-t space-y-2">
        {SHOW_CASH_MOVEMENTS && (
          <Button
            variant="outline"
            className="w-full"
            onClick={onOpenMovements}
          >
            <Wallet />
            Movimientos de caja
          </Button>
        )}
        <Button variant="secondary" className="w-full" onClick={onOpenCorte}>
          <ClipboardList />
          Corte del dia
        </Button>
      </div>
    </div>
  );
}
