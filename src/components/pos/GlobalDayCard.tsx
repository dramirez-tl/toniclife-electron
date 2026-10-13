// GlobalDayCard - Estado de la FACTURA GLOBAL (público en general) de UN día
// local de la sucursal, con el botón para emitirla desde el POS.
//
// Se muestra en "Ventas recientes" cuando el rango es un solo día y en el
// corte del día. Lee GET /pos/billing/global/days?from=día&to=día y traduce
// cada estado a una leyenda en español. El POS solo EMITE la global de un día
// cerrado: cancelar o reexpedir es de Contabilidad desde el admin.

import { useState } from 'react';
import { BookCheck, CheckCircle2, Clock, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGlobalDays } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import {
  GLOBAL_BLOCK_REASON_LABELS,
  GLOBAL_DAY_STATUS_LABELS,
  type GlobalDayStatusRow,
} from '@/types/pos';
import { GlobalInvoiceModal } from './GlobalInvoiceModal';

interface GlobalDayCardProps {
  branchId: string;
  branchName: string;
  /** Día local de la sucursal (YYYY-MM-DD). */
  day: string;
  currencySymbol: string;
  /** Interruptor "Facturación" de la terminal; apagado = no se emite. */
  invoicingEnabled: boolean;
  /** Variante compacta para el panel lateral. */
  compact?: boolean;
}

export function GlobalDayCard({
  branchId,
  branchName,
  day,
  currencySymbol,
  invoicingEnabled,
  compact = false,
}: GlobalDayCardProps) {
  const { data, isLoading, isError, refetch } = useGlobalDays(
    branchId,
    day,
    day,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const row: GlobalDayStatusRow | undefined = data?.find(
    (d) => d.localDate === day,
  );
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  const pad = compact ? 'px-3 py-2' : 'px-3 py-2.5';
  const textSize = compact ? 'text-[11px]' : 'text-xs';

  // Sin respuesta (API viejo, terminal sin acceso a facturación): no se
  // muestra nada en vez de un error ruidoso (la global sigue en el admin).
  if (isError) return null;

  return (
    <div className={`rounded-lg border bg-card ${pad}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <BookCheck className="size-3.5 text-primary shrink-0" />
        <span className={`${textSize} font-semibold text-foreground`}>
          Factura global
          {compact ? '' : ` del ${day}`}
        </span>
      </div>
      {isLoading || !row ? (
        <p className={`${textSize} text-muted-foreground`}>
          {isLoading ? 'Consultando...' : 'Sin información del día.'}
        </p>
      ) : (
        <DayStatus
          row={row}
          textSize={textSize}
          fmt={fmt}
          invoicingEnabled={invoicingEnabled}
          onEmit={() => setModalOpen(true)}
        />
      )}

      <GlobalInvoiceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        branchId={branchId}
        branchName={branchName}
        date={day}
        currencySymbol={currencySymbol}
        onStamped={() => void refetch()}
      />
    </div>
  );
}

function DayStatus({
  row,
  textSize,
  fmt,
  invoicingEnabled,
  onEmit,
}: {
  row: GlobalDayStatusRow;
  textSize: string;
  fmt: (n: number) => string;
  invoicingEnabled: boolean;
  onEmit: () => void;
}) {
  const muted = `${textSize} text-muted-foreground`;
  switch (row.status) {
    case 'emitted':
      return (
        <div className="space-y-0.5">
          <p className={`${textSize} flex items-center gap-1 text-emerald-700`}>
            <CheckCircle2 className="size-3.5 shrink-0" />
            {GLOBAL_DAY_STATUS_LABELS.emitted}
            {row.providerFolio ? (
              <span className="font-mono">· {row.providerFolio}</span>
            ) : null}
          </p>
          <p className={muted}>
            {row.ticketCount} {row.ticketCount === 1 ? 'ticket' : 'tickets'} ·{' '}
            {fmt(Number(row.total))}
          </p>
          {row.uncoveredCount > 0 && (
            <p className={`${textSize} text-amber-700`}>
              {GLOBAL_BLOCK_REASON_LABELS.uncovered_tickets} (
              {row.uncoveredCount} sin declarar, {fmt(Number(row.uncoveredTotal))}
              ).
            </p>
          )}
        </div>
      );
    case 'ready':
      return (
        <div className="space-y-1.5">
          <p className={muted}>
            {row.ticketCount} {row.ticketCount === 1 ? 'ticket' : 'tickets'} ·{' '}
            {fmt(Number(row.total))}
            {row.lateEmission ? ' · emisión tardía' : ''}
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={onEmit}
            disabled={!invoicingEnabled}
            title={
              invoicingEnabled
                ? 'Revisar y timbrar la factura global de este día'
                : 'La facturación está deshabilitada en esta terminal'
            }
          >
            <BookCheck />
            Emitir factura global
          </Button>
          {!invoicingEnabled && (
            <p className={`${textSize} text-amber-700`}>
              La facturación está deshabilitada en esta terminal; pide a
              Sistemas encenderla o emite la global desde el admin.
            </p>
          )}
        </div>
      );
    case 'blocked':
      return (
        <p className={`${textSize} flex items-start gap-1 text-amber-700`}>
          <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
          <span>
            {GLOBAL_DAY_STATUS_LABELS.blocked}:{' '}
            {(row.blockReason && GLOBAL_BLOCK_REASON_LABELS[row.blockReason]) ??
              'revisa el día en el admin (Contabilidad).'}
          </span>
        </p>
      );
    case 'open':
      return (
        <p className={`${muted} flex items-center gap-1`}>
          <Clock className="size-3.5 shrink-0" />
          Se podrá emitir mañana (día en curso).
        </p>
      );
    case 'pending_reissue':
      return (
        <div className="space-y-0.5">
          <p className={`${textSize} flex items-center gap-1 text-amber-700`}>
            <TriangleAlert className="size-3.5 shrink-0" />
            {GLOBAL_DAY_STATUS_LABELS.pending_reissue}
            {row.providerFolio ? (
              <span className="font-mono">· {row.providerFolio}</span>
            ) : null}
          </p>
          <p className={muted}>
            La global emitida no incluye {row.uncoveredCount}{' '}
            {row.uncoveredCount === 1 ? 'venta' : 'ventas'} (
            {fmt(Number(row.uncoveredTotal))}); Contabilidad la reexpide desde
            el admin.
          </p>
        </div>
      );
    case 'cancelled':
      return (
        <p className={`${muted} flex items-center gap-1`}>
          <Info className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS.cancelled}; no quedan ventas por declarar.
        </p>
      );
    case 'no_sales':
      return (
        <p className={`${muted} flex items-center gap-1`}>
          <Info className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS.no_sales} este día.
        </p>
      );
    case 'not_eligible':
      return (
        <p className={`${muted} flex items-center gap-1`}>
          <Info className="size-3.5 shrink-0" />
          {GLOBAL_DAY_STATUS_LABELS.not_eligible}: la sucursal o el día no
          facturan global en v2.
        </p>
      );
    default:
      return (
        <p className={muted}>
          {GLOBAL_DAY_STATUS_LABELS[row.status] ?? row.status}
        </p>
      );
  }
}
