// GlobalInvoiceModal - Vista previa y timbrado de la FACTURA GLOBAL (público
// en general) de un día local de la sucursal, desde el POS.
//
// 1) GET /pos/billing/global/preview?date → totales, tickets incluidos /
//    excluidos, bloqueadores y errores de elegibilidad (solo lectura).
// 2) Una global POR FORMA DE PAGO (Contabilidad, 20-oct-2026 / API mig 164):
//    la vista previa trae `groups` (efectivo, tarjeta, transferencia…) y cada
//    uno se timbra aparte con su previewHash: "Timbrar 01", "Timbrar 04"… o
//    "Timbrar todas" (una tras otra). Los tickets pagados con cashback,
//    promoción o dólares salen como excluidos (Contabilidad los registra
//    aparte). Con un API viejo (sin `groups`) se conserva el flujo de una sola
//    global del día.
// 3) POST /pos/billing/global con background=true: el API acepta y timbra en
//    segundo plano; se sondea GET status (por forma de pago). Si responde 409
//    CFDI_GLOBAL_PREVIEW_STALE se recarga la vista previa. El POS no cancela
//    ni reexpide globales: eso es de Contabilidad en el admin.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  AlertTriangle,
  BookCheck,
  CheckCircle2,
  Info,
  Loader2,
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
  type GlobalPreviewGroup,
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
  onStamped?: () => void;
}

/** Lo que se muestra al terminar (del detalle o del estado sondeado). */
interface StampResult {
  /** Forma de pago de la global (null con un API viejo de una sola global). */
  paymentForm: string | null;
  folioDisplay: string | null;
  satUuid: string | null;
  total: number;
}

const STATUS_POLL_MS = 3000;
/** Marca interna para el sondeo del flujo de una sola global (API viejo). */
const LEGACY_FORM = '__legacy__';

const PAYMENT_FORM_NAMES: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque',
  '03': 'Transferencia',
  '04': 'Tarjeta de crédito',
  '06': 'Dinero electrónico',
  '28': 'Tarjeta de débito',
  '99': 'Por definir',
};
const formLabel = (code: string) =>
  `${code} · ${PAYMENT_FORM_NAMES[code] ?? 'Forma de pago'}`;

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
  // Forma de pago cuya emisión se está pidiendo (POST en curso).
  const [stampingForm, setStampingForm] = useState<string | null>(null);
  // Forma de pago aceptada por el API que se timbra en segundo plano (sondeo).
  const [activeForm, setActiveForm] = useState<string | null>(null);
  // "Timbrar todas": formas que siguen después de la activa.
  const [queue, setQueue] = useState<string[]>([]);
  const [stampError, setStampError] = useState('');
  // Aviso de que la vista previa cambió y hay que confirmar otra vez.
  const [staleNotice, setStaleNotice] = useState(false);
  const [results, setResults] = useState<StampResult[]>([]);
  const onStampedRef = useRef(onStamped);
  onStampedRef.current = onStamped;

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const groups: GlobalPreviewGroup[] | null = preview?.groups ?? null;
  // API viejo: sin grupos, una sola global del día.
  const legacy = !!preview && !groups;
  const stamping = stampingForm !== null;
  const processing = activeForm !== null;
  // `busy` deshabilita los botones de acción; el diálogo solo se BLOQUEA
  // mientras se pide la emisión (escritura). Cargar la vista previa es solo
  // lectura y el cajero debe poder cerrar aunque el API tarde.
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
    setResults([]);
    setActiveForm(null);
    setQueue([]);
    setStampError('');
    setStaleNotice(false);
    void loadPreview();
  }, [isOpen, loadPreview]);

  const finishStamped = useCallback(
    (r: StampResult) => {
      setResults((prev) => [...prev, r]);
      toast.success(
        r.paymentForm
          ? `Factura global del ${date} (${formLabel(r.paymentForm)}) timbrada`
          : `Factura global del ${date} timbrada`,
      );
      // Se invalida TODO lo del POS (como InvoiceSaleModal): la tarjeta del
      // día, la lista (badge "Global") y el detalle cacheado de cada venta
      // ('sale', id), que si no, seguiría ofreciendo "Facturar" a un ticket
      // que ya quedó dentro de la global.
      void qc.invalidateQueries({ queryKey: posKeys.all });
      onStampedRef.current?.();
    },
    [date, qc],
  );

  async function handleStamp(form?: string) {
    if (!preview || busy || processing) return;
    const group = form ? groups?.find((g) => g.paymentForm === form) : null;
    const canStamp = group ? group.canStamp : preview.canStamp;
    const hash = group ? group.previewHash : preview.previewHash;
    if (!canStamp) return;
    setStampingForm(form ?? LEGACY_FORM);
    setStampError('');
    setStaleNotice(false);
    try {
      const res = await posApi.createGlobalInvoice(
        date,
        hash,
        branchId,
        form,
      );
      if ('accepted' in res && res.accepted === true) {
        // API nuevo: la factura quedó pendiente y se timbra en el servidor.
        setActiveForm(form ?? LEGACY_FORM);
        return;
      }
      // API viejo: timbró en la misma petición.
      const inv = res as InvoiceDetail;
      finishStamped({
        paymentForm: form ?? null,
        folioDisplay: inv.folioDisplay,
        satUuid: inv.satUuid,
        total: Number(inv.total),
      });
      await loadPreview();
    } catch (err) {
      setQueue([]);
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
      setStampingForm(null);
    }
  }

  // "Timbrar todas": la primera ahora, el resto en cola; al confirmarse cada
  // una (sondeo) arranca la siguiente.
  function handleStampAll() {
    if (!groups) return;
    const forms = groups.filter((g) => g.canStamp).map((g) => g.paymentForm);
    if (forms.length === 0) return;
    setQueue(forms.slice(1));
    void handleStamp(forms[0]);
  }

  // Sondeo mientras el API timbra en segundo plano. Si el cajero cierra la
  // ventana el timbrado sigue en el servidor; la tarjeta del día lo refleja.
  useEffect(() => {
    if (!isOpen || !activeForm) return;
    let cancelled = false;
    const form = activeForm === LEGACY_FORM ? undefined : activeForm;
    const tick = async () => {
      try {
        const st = await posApi.getGlobalStatus(date, branchId, form);
        if (cancelled) return;
        if (st.state === 'emitted') {
          setActiveForm(null);
          finishStamped({
            paymentForm: form ?? null,
            folioDisplay: st.folioDisplay,
            satUuid: st.satUuid,
            total: Number(st.total),
          });
          await loadPreview();
          if (cancelled) return;
          setQueue((q) => {
            const [next, ...rest] = q;
            if (next) void handleStamp(next);
            return rest;
          });
        } else if (st.state === 'error') {
          setActiveForm(null);
          setQueue([]);
          setStampError(
            st.error ||
              'El PAC rechazó la factura global. Revisa la vista previa y reintenta.',
          );
          void qc.invalidateQueries({ queryKey: posKeys.all });
        } else if (st.state === 'none' || st.state === 'cancelled') {
          setActiveForm(null);
          setQueue([]);
          setStampError('La emisión no quedó registrada; vuelve a intentarlo.');
        }
      } catch {
        // Sin red o API ocupado: se vuelve a preguntar en el siguiente sondeo.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // handleStamp cambia en cada render; la cola se consume desde el sondeo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeForm, date, branchId, qc, finishStamped, loadPreview]);

  const stampableGroups = groups ? groups.filter((g) => g.canStamp) : [];
  const eligibilityErrors = (preview?.eligibilityErrors ?? []).filter(
    // Ese aviso es para un POS viejo; aquí ya se trabaja por grupos.
    (e) => legacy || e.code !== 'CFDI_GLOBAL_PAYMENT_FORM_REQUIRED',
  );
  const allDone =
    !!preview && !legacy && (groups?.length ?? 0) === 0 && results.length > 0;

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
                {branchName} · {date} · público en general · una global por
                forma de pago
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
          {results.length > 0 && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 />
              <AlertDescription className="text-emerald-800">
                <p className="font-medium">
                  {results.length === 1
                    ? 'Factura global timbrada.'
                    : `${results.length} facturas globales timbradas.`}
                </p>
                {results.map((r, i) => (
                  <p key={`${r.paymentForm ?? 'g'}-${i}`}>
                    {r.paymentForm ? `${formLabel(r.paymentForm)} · ` : ''}
                    Folio: <span className="font-mono">{r.folioDisplay}</span>
                    {r.satUuid ? (
                      <>
                        {' '}
                        · UUID:{' '}
                        <span className="font-mono text-xs">{r.satUuid}</span>
                      </>
                    ) : null}{' '}
                    · Total: {fmt(Number(r.total))}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {processing ? (
            <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center space-y-2">
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                Generando y timbrando la factura global
                {activeForm && activeForm !== LEGACY_FORM
                  ? ` (${formLabel(activeForm)})`
                  : ''}
                …
              </p>
              {queue.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Después siguen: {queue.map(formLabel).join(', ')}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Esto corre en el servidor y puede tardar unos minutos. Puedes
                cerrar esta ventana y seguir cobrando: la tarjeta del día
                mostrará el resultado.
              </p>
            </div>
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

              {(preview.existingGlobals ?? (preview.existingGlobal ? [preview.existingGlobal] : [])).length > 0 && (
                <Alert>
                  <Info />
                  <AlertDescription>
                    Este día ya tiene{' '}
                    {(preview.existingGlobals ?? [preview.existingGlobal!]).map((g, i) => (
                      <span key={g.invoiceId}>
                        {i > 0 ? ', ' : ''}
                        {g.paymentForm ? `${formLabel(g.paymentForm)}: ` : ''}
                        <span className="font-mono">{g.folioDisplay}</span>
                        {g.providerStatus ? ` (${g.providerStatus})` : ''}
                      </span>
                    ))}
                    . Sus tickets ya no aparecen abajo.
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

              {/* Totales del día (todo lo por globalizar) */}
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
                Tickets por globalizar: {preview.included.length}
                {legacy && preview.totals.paymentForm
                  ? ` · Forma de pago: ${preview.totals.paymentForm}`
                  : ''}
                {' '}· Conceptos por{' '}
                {preview.conceptMode === 'product' ? 'producto' : 'ticket'}
              </p>

              {/* Errores de elegibilidad (sucursal / día) */}
              {eligibilityErrors.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    No se puede emitir
                  </h3>
                  <div className="rounded-lg border border-destructive/30 divide-y">
                    {eligibilityErrors.map((e, i) => (
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

              {/* Una global por forma de pago (API con mig 164) */}
              {groups && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Globales por forma de pago ({groups.length})
                  </h3>
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {allDone
                        ? 'Ya no queda nada por globalizar este día.'
                        : 'No hay ventas por globalizar este día.'}
                    </p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {groups.map((g) => {
                        const done = results.some(
                          (r) => r.paymentForm === g.paymentForm,
                        );
                        const live = g.existing.filter((e) =>
                          ['stamped', 'sent', 'cancel_pending'].includes(
                            e.providerStatus ?? '',
                          ),
                        );
                        return (
                          <div
                            key={g.paymentForm}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {formLabel(g.paymentForm)}
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {g.included.length}{' '}
                                {g.included.length === 1 ? 'ticket' : 'tickets'} ·
                                base {fmt(Number(g.totals.subtotal))} · IVA{' '}
                                {fmt(Number(g.totals.taxes))} ·{' '}
                                <span className="font-medium text-foreground">
                                  total {fmt(Number(g.totals.total))}
                                </span>
                              </p>
                              {live.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Ya emitida hoy:{' '}
                                  {live.map((e) => e.folioDisplay).join(', ')} (lo
                                  listado sigue sin declarar)
                                </p>
                              )}
                              {g.blockers.map((b, i) => (
                                <p
                                  key={`${b.code}-${i}`}
                                  className="text-xs text-destructive"
                                >
                                  {b.message}
                                </p>
                              ))}
                            </div>
                            <Button
                              size="sm"
                              onClick={() => void handleStamp(g.paymentForm)}
                              disabled={!g.canStamp || busy || processing || done}
                            >
                              {stampingForm === g.paymentForm ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <BookCheck />
                              )}
                              {done ? 'Timbrada' : `Timbrar ${g.paymentForm}`}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
          {!processing ? (
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
              {results.length > 0 || processing ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!processing && legacy && (
              <Button
                onClick={() => void handleStamp()}
                disabled={!preview || !preview.canStamp || busy}
              >
                <BookCheck />
                {stamping ? 'Timbrando...' : 'Timbrar factura global'}
              </Button>
            )}
            {!processing && groups && stampableGroups.length > 1 && (
              <Button onClick={handleStampAll} disabled={busy}>
                <BookCheck />
                Timbrar todas ({stampableGroups.length})
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
