// GlobalDayCard - Estado de la FACTURA GLOBAL (público en general) de UN día
// local de la sucursal, con el botón para emitirla desde el POS.
//
// Se muestra en "Ventas recientes" cuando el rango es un solo día y en el
// corte del día. Lee GET /pos/billing/global/days?from=día&to=día y traduce
// cada estado a una leyenda en español. El POS solo EMITE la global (de un día
// terminado o del DÍA EN CURSO, cuando la caja ya impactó todas sus ventas;
// 31-oct-2026): cancelar o reexpedir es de Contabilidad desde el admin.

import { useState } from 'react';
import { toast } from 'sonner';
import {
  BookCheck,
  CheckCircle2,
  Clock,
  FileCode2,
  FileText,
  Info,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/apiError';
import { todayLocal } from '@/lib/date';
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
  /** Zona horaria de la sucursal: decide si `day` es HOY (aviso al emitir). */
  branchTz?: string;
}

export function GlobalDayCard({
  branchId,
  branchName,
  day,
  currencySymbol,
  invoicingEnabled,
  compact = false,
  branchTz,
}: GlobalDayCardProps) {
  // Sondea cada 5 s mientras la global del día se timbra en segundo plano.
  const { data, isLoading, isError, refetch } = useGlobalDays(
    branchId,
    day,
    day,
    true,
    true,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [downloading, setDownloading] = useState<'pdf' | 'xml' | null>(null);
  const row: GlobalDayStatusRow | undefined = data?.find(
    (d) => d.localDate === day,
  );
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  // La global de HOY se puede emitir (31-oct-2026): se avisa que debe ser al
  // terminar de impactar las ventas del día.
  const isToday = day === todayLocal(branchTz);

  // Descarga el PDF/XML de la global emitida y lo abre con el visor del SO
  // (mismo camino que la factura de una venta: bytes por el API → IPC).
  async function handleOpenFile(ext: 'pdf' | 'xml') {
    if (!row?.invoiceId) return;
    setDownloading(ext);
    try {
      const { bytes, filename } = await posApi.getGlobalInvoiceFile(
        row.invoiceId,
        ext,
        branchId,
        row.providerFolio,
      );
      const r = await window.toniclife.invoice.openPdf(
        filename,
        new Uint8Array(bytes),
      );
      if (!r.ok) {
        toast.error('No se pudo abrir el archivo', { description: r.error });
      }
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          `No se pudo descargar el ${ext.toUpperCase()} de la factura global`,
        ),
      );
    } finally {
      setDownloading(null);
    }
  }

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
          isToday={isToday}
          onEmit={() => setModalOpen(true)}
          onOpenFile={(ext) => void handleOpenFile(ext)}
          downloading={downloading}
        />
      )}

      <GlobalInvoiceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        branchId={branchId}
        branchName={branchName}
        date={day}
        isToday={isToday}
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
  isToday,
  onEmit,
  onOpenFile,
  downloading,
}: {
  row: GlobalDayStatusRow;
  textSize: string;
  fmt: (n: number) => string;
  invoicingEnabled: boolean;
  /** El día es HOY en la sucursal: emitir solo al terminar de impactar ventas. */
  isToday: boolean;
  onEmit: () => void;
  onOpenFile: (ext: 'pdf' | 'xml') => void;
  downloading: 'pdf' | 'xml' | null;
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
            {row.emittedForms && row.emittedForms.length > 1
              ? ` · ${row.emittedForms.length} globales (${row.emittedForms.map((f) => f.paymentForm).join(', ')})`
              : ''}
          </p>
          {row.invoiceId && (
            <div className="flex gap-1 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={downloading !== null}
                onClick={() => onOpenFile('pdf')}
                title="Descargar y abrir el PDF de la factura global"
              >
                {downloading === 'pdf' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={downloading !== null}
                onClick={() => onOpenFile('xml')}
                title="Descargar el XML de la factura global"
              >
                {downloading === 'xml' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileCode2 className="size-3.5" />
                )}
                XML
              </Button>
            </div>
          )}
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
          {/* Mig 164: una global por forma de pago; lo ya emitido y lo que falta. */}
          {row.emittedForms && row.emittedForms.length > 0 && (
            <p className={`${textSize} text-emerald-700`}>
              Emitidas: {row.emittedForms.map((f) => `${f.paymentForm} (${f.folioDisplay})`).join(', ')}
            </p>
          )}
          {row.pendingForms && row.pendingForms.length > 0 && (
            <p className={muted}>
              Por emitir: {row.pendingForms.map((f) => `forma ${f.paymentForm} · ${f.ticketCount} tickets · ${fmt(Number(f.total))}`).join(' · ')}
            </p>
          )}
          {isToday && (
            <p className={`${textSize} flex items-start gap-1 text-amber-700`}>
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>
                Global de hoy: emítela solo cuando ya estén impactadas todas
                las ventas del día. Lo que se venda después se emite aparte,
                en otra global del mismo día.
              </span>
            </p>
          )}
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
      // Emisión en segundo plano: en curso (se actualiza sola) o el último
      // intento quedó en error (se reintenta desde aquí: reutiliza la fila).
      if (row.blockReason === 'attempt_in_progress') {
        if (row.providerStatus === 'error') {
          return (
            <div className="space-y-1.5">
              <p className={`${textSize} flex items-start gap-1 text-destructive`}>
                <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  El último intento de timbrar la global quedó en error.
                  Revisa la vista previa y reintenta.
                </span>
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={onEmit}
                disabled={!invoicingEnabled}
              >
                <BookCheck />
                Reintentar factura global
              </Button>
            </div>
          );
        }
        return (
          <p className={`${textSize} flex items-start gap-1 text-primary`}>
            <Loader2 className="size-3.5 shrink-0 mt-0.5 animate-spin" />
            <span>
              Generando la factura global en segundo plano… puedes seguir
              cobrando; esta tarjeta se actualiza sola.
            </span>
          </p>
        );
      }
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
      // Día futuro (API >= 31-oct-2026) o, con un API anterior, el día en curso.
      return (
        <p className={`${muted} flex items-center gap-1`}>
          <Clock className="size-3.5 shrink-0" />
          Todavía no se puede emitir la global de este día.
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
