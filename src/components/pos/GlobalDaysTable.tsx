// GlobalDaysTable - Estado de la FACTURA GLOBAL (público en general) de CADA
// día de un rango, con el botón para emitir la de los días listos. Es la
// versión "por día" del GlobalDayCard para el corte de varios días: el
// cajero ve de un vistazo qué días ya tienen su global y cuáles faltan.
// El POS solo EMITE; cancelar o reexpedir es de Contabilidad desde el admin.

import { useState } from 'react';
import { BookCheck, CheckCircle2, Clock, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGlobalDays } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import {
  GLOBAL_BLOCK_REASON_LABELS,
  GLOBAL_DAY_STATUS_LABELS,
  type GlobalDayStatusRow,
} from '@/types/pos';
import { GlobalInvoiceModal } from './GlobalInvoiceModal';

interface GlobalDaysTableProps {
  branchId: string;
  branchName: string;
  /** Rango de días locales de la sucursal (YYYY-MM-DD), máx. 31. */
  from: string;
  to: string;
  currencySymbol: string;
  /** Interruptor "Facturación" de la terminal; apagado = no se emite. */
  invoicingEnabled: boolean;
}

export function GlobalDaysTable({
  branchId,
  branchName,
  from,
  to,
  currencySymbol,
  invoicingEnabled,
}: GlobalDaysTableProps) {
  const { data, isLoading, isError, refetch } = useGlobalDays(
    branchId,
    from,
    to,
  );
  const [emitDay, setEmitDay] = useState<string | null>(null);
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  // Sin respuesta (API viejo, terminal sin acceso): no se muestra nada.
  if (isError) return null;

  // Los días sin ventas ni global no aportan nada en un rango largo.
  const rows = (data ?? []).filter((d) => d.status !== 'no_sales');
  const pending = rows.filter((d) => d.status === 'ready').length;

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <BookCheck className="size-4 text-primary" />
        Facturas globales por día
        {pending > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-px text-[11px] font-medium text-amber-800">
            {pending} por emitir
          </span>
        )}
      </h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Consultando...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Sin días con ventas que declarar en este rango.
        </p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table className="text-sm">
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead className="px-3 py-1.5 font-medium text-muted-foreground">
                  Día
                </TableHead>
                <TableHead className="px-3 py-1.5 font-medium text-muted-foreground">
                  Estado
                </TableHead>
                <TableHead className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                  Tickets
                </TableHead>
                <TableHead className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                  Total
                </TableHead>
                <TableHead className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {rows.map((d) => (
                <TableRow key={d.localDate}>
                  <TableCell className="px-3 py-1.5 font-mono text-xs">
                    {d.localDate}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-xs">
                    <DayStatusCell row={d} />
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {d.ticketCount}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(Number(d.total))}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-right">
                    {d.status === 'ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEmitDay(d.localDate)}
                        disabled={!invoicingEnabled}
                        title={
                          invoicingEnabled
                            ? 'Revisar y timbrar la factura global de este día'
                            : 'La facturación está deshabilitada en esta terminal'
                        }
                      >
                        <BookCheck />
                        Emitir
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GlobalInvoiceModal
        isOpen={!!emitDay}
        onClose={() => setEmitDay(null)}
        branchId={branchId}
        branchName={branchName}
        date={emitDay ?? to}
        currencySymbol={currencySymbol}
        onStamped={() => void refetch()}
      />
    </div>
  );
}

function DayStatusCell({ row }: { row: GlobalDayStatusRow }) {
  switch (row.status) {
    case 'emitted':
      return (
        <span className="flex items-center gap-1 text-emerald-700">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Emitida
          {row.providerFolio ? (
            <span className="font-mono">· {row.providerFolio}</span>
          ) : null}
          {row.uncoveredCount > 0 && (
            <span className="text-amber-700">
              · {row.uncoveredCount} sin declarar
            </span>
          )}
        </span>
      );
    case 'ready':
      return (
        <span className="text-foreground">
          {GLOBAL_DAY_STATUS_LABELS.ready}
          {row.lateEmission ? ' · emisión tardía' : ''}
        </span>
      );
    case 'blocked':
      return (
        <span
          className="flex items-center gap-1 text-amber-700"
          title={
            (row.blockReason && GLOBAL_BLOCK_REASON_LABELS[row.blockReason]) ??
            undefined
          }
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS.blocked}
        </span>
      );
    case 'open':
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          Día en curso (mañana)
        </span>
      );
    case 'pending_reissue':
      return (
        <span className="flex items-center gap-1 text-amber-700">
          <TriangleAlert className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS.pending_reissue}
          {row.providerFolio ? (
            <span className="font-mono">· {row.providerFolio}</span>
          ) : null}
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS[row.status] ?? row.status}
        </span>
      );
  }
}
