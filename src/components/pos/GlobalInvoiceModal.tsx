// GlobalInvoiceModal - Vista previa y timbrado de la FACTURA GLOBAL (público
// en general) de un día local de la sucursal, desde el POS.
//
// 1) GET /pos/billing/global/preview?date → totales, tickets incluidos /
//    excluidos, bloqueadores y errores de elegibilidad (solo lectura).
// 2) "Timbrar factura global" solo si canStamp; POST /pos/billing/global con
//    el previewHash que el cajero vio. Si el API responde 409
//    CFDI_GLOBAL_PREVIEW_STALE (cambió algo del día), se vuelve a cargar la
//    vista previa y se pide confirmar de nuevo. El POS no cancela ni
//    reexpide globales: eso es de Contabilidad en el admin.

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  AlertTriangle,
  BookCheck,
  CheckCircle2,
  Info,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { posKeys } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  GLOBAL_EXCLUDED_REASON_LABELS,
  type BillingErrorBody,
  type GlobalPreview,
  type InvoiceDetail,
} from '@/types/pos';

interface GlobalInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
  /** Día local de la sucursal (YYYY-MM-DD). */
  date: string;
  currencySymbol: string;
  /** Tras timbrar con éxito (la tarjeta del día se refresca aquí). */
  onStamped?: (invoice: InvoiceDetail) => void;
}

export function GlobalInvoiceModal({
  isOpen,
  onClose,
  branchId,
  branchName,
  date,
  currencySymbol,
  onStamped,
}: GlobalInvoiceModalProps) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<GlobalPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [stamping, setStamping] = useState(false);
  const [stampError, setStampError] = useState('');
  // Aviso de que la vista previa cambió y hay que confirmar otra vez.
  const [staleNotice, setStaleNotice] = useState(false);
  const [result, setResult] = useState<InvoiceDetail | null>(null);

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  // `busy` deshabilita los botones de acción; el diálogo solo se BLOQUEA
  // mientras se timbra (escritura). Cargar la vista previa es solo lectura
  // y el cajero debe poder cerrar aunque el API tarde (igual que
  // StampRetryModal / InvoiceSaleModal).
  const busy = loading || stamping;

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const p = await posApi.getGlobalPreview(date, branchId);
      setPreview(p);
    } catch (err) {
      setPreview(null);
      setLoadError(
        getApiErrorMessage(err, 'No se pudo cargar la vista previa.'),
      );
    } finally {
      setLoading(false);
    }
  }, [date, branchId]);

  // Al abrir: estado limpio + vista previa.
  useEffect(() => {
    if (!isOpen) return;
    setPreview(null);
    setResult(null);
    setStampError('');
    setStaleNotice(false);
    void loadPreview();
  }, [isOpen, loadPreview]);

  async function handleStamp() {
    if (!preview || !preview.canStamp || busy) return;
    setStamping(true);
    setStampError('');
    setStaleNotice(false);
    try {
      const inv = await posApi.createGlobalInvoice(
        date,
        preview.previewHash,
        branchId,
      );
      setResult(inv);
      toast.success(`Factura global del ${date} timbrada`);
      // Se invalida TODO lo del POS (como InvoiceSaleModal): la tarjeta del
      // día, la lista (badge "Global") y el detalle cacheado de cada venta
      // ('sale', id), que si no, seguiría ofreciendo "Facturar" a un ticket
      // que ya quedó dentro de la global.
      void qc.invalidateQueries({ queryKey: posKeys.all });
      onStamped?.(inv);
    } catch (err) {
      const e = err as { response?: { status?: number; data?: BillingErrorBody } };
      const code = e.response?.data?.code;
      if (e.response?.status === 409 && code === 'CFDI_GLOBAL_PREVIEW_STALE') {
        // Cambió algo del día desde que se vio la previa: recargar y pedir
        // confirmación de nuevo (no se timbra a ciegas).
        setStaleNotice(true);
        await loadPreview();
      } else {
        setStampError(
          getApiErrorMessage(err, 'No se pudo timbrar la factura global.'),
        );
      }
    } finally {
      setStamping(false);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !stamping) onClose();
      }}
    >
      <DialogContent
        className="z-[70] max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (stamping) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (stamping) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <BookCheck className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Factura global del día
              </DialogTitle>
              <DialogDescription className="text-xs">
                {branchName} · {date} · público en general
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !stamping && onClose()}
            disabled={stamping}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {result ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 />
              <AlertDescription className="text-emerald-800">
                <p className="font-medium">Factura global timbrada.</p>
                <p>
                  Folio:{' '}
                  <span className="font-mono">{result.folioDisplay}</span>
                  {result.satUuid ? (
                    <>
                      {' '}
                      · UUID:{' '}
                      <span className="font-mono text-xs">{result.satUuid}</span>
                    </>
                  ) : null}
                  {' '}· Total: {fmt(Number(result.total))}
                </p>
              </AlertDescription>
            </Alert>
          ) : loading && !preview ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Cargando vista previa...
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : preview ? (
            <>
              {staleNotice && (
                <Alert>
                  <Info />
                  <AlertDescription>
                    La vista previa cambió desde que la viste (ventas o
                    cancelaciones nuevas del día). Revísala y confirma de
                    nuevo.
                  </AlertDescription>
                </Alert>
              )}

              {stampError && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertDescription>{stampError}</AlertDescription>
                </Alert>
              )}

              {preview.existingGlobal && (
                <Alert>
                  <Info />
                  <AlertDescription>
                    Este día ya tiene factura global{' '}
                    <span className="font-mono">
                      {preview.existingGlobal.folioDisplay}
                    </span>
                    {preview.existingGlobal.providerStatus
                      ? ` (${preview.existingGlobal.providerStatus})`
                      : ''}
                    .
                  </AlertDescription>
                </Alert>
              )}

              {preview.lateEmission && (
                <Alert>
                  <Info />
                  <AlertDescription>
                    Emisión tardía: el día es anterior a ayer.
                  </AlertDescription>
                </Alert>
              )}

              {/* Totales */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Documentos"
                  value={String(preview.totals.documents)}
                />
                <StatCard
                  label="Subtotal"
                  value={fmt(Number(preview.totals.subtotal))}
                />
                <StatCard label="IVA" value={fmt(Number(preview.totals.taxes))} />
                <StatCard
                  label="Total"
                  value={fmt(Number(preview.totals.total))}
                  highlight
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tickets incluidos: {preview.included.length}
                {preview.totals.paymentForm
                  ? ` · Forma de pago: ${preview.totals.paymentForm}`
                  : ''}
                {' '}· Conceptos por{' '}
                {preview.conceptMode === 'product' ? 'producto' : 'ticket'}
              </p>

              {/* Errores de elegibilidad (sucursal / día) */}
              {preview.eligibilityErrors.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    No se puede emitir
                  </h3>
                  <div className="rounded-lg border border-destructive/30 divide-y">
                    {preview.eligibilityErrors.map((e, i) => (
                      <div
                        key={`${e.code}-${i}`}
                        className="px-3 py-2 text-sm text-destructive"
                      >
                        <span className="font-mono text-xs mr-2">{e.code}</span>
                        {e.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bloqueadores (tickets que impiden la global) */}
              {preview.blockers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Bloqueos ({preview.blockers.length})
                  </h3>
                  <div className="rounded-lg border border-amber-300 bg-amber-50/60 divide-y">
                    {preview.blockers.map((b, i) => (
                      <div
                        key={`${b.code}-${i}`}
                        className="px-3 py-2 text-sm text-amber-900"
                      >
                        <span className="font-mono text-xs mr-2">{b.code}</span>
                        {b.message}
                        {b.folio ? (
                          <span className="ml-1 font-mono text-xs">
                            ({b.folio})
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Un ticket bloqueado se resuelve facturándolo de forma
                    nominativa o con ayuda de Contabilidad.
                  </p>
                </div>
              )}

              {/* Excluidos (no entran, pero no bloquean) */}
              {preview.excluded.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Fuera de la global ({preview.excluded.length})
                  </h3>
                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                    {preview.excluded.map((x) => (
                      <div
                        key={`${x.kind}-${x.id}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                        title={x.detail}
                      >
                        <span className="font-mono">{x.folio}</span>
                        <span className="flex-1 truncate text-muted-foreground">
                          {GLOBAL_EXCLUDED_REASON_LABELS[x.reason] ?? x.detail}
                        </span>
                        <span className="tabular-nums">{fmt(Number(x.total))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          {!result ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadPreview()}
              disabled={busy}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              Actualizar vista previa
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={stamping}>
              {result ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!result && (
              <Button
                onClick={handleStamp}
                disabled={!preview || !preview.canStamp || busy}
              >
                <BookCheck />
                {stamping ? 'Timbrando...' : 'Timbrar factura global'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div
        className={[
          'mt-1 font-bold tabular-nums',
          highlight ? 'text-primary text-lg' : 'text-foreground text-base',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
