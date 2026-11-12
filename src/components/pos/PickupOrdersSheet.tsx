// PickupOrdersSheet - Pedidos de la tienda en línea que el cliente RECOGE EN
// LA SUCURSAL (11-nov-2026). Panel lateral al 80 % del ancho, como Entradas
// de inventario. Aquí la sucursal ve lo que ya se pagó, lo surte palomeando
// cada producto al apartarlo, lo marca "listo para recoger" (el API le avisa
// al comprador) y lo entrega anotando quién lo recogió. Lo que sigue sin
// pagar solo se consulta. El palomeo vive en esta pantalla: no se guarda en
// el API. Las entregas a domicilio son otra cosa (DeliveriesSheet).
//
// El detalle del pedido elegido está en PickupOrderDetail.tsx y el diálogo de
// entrega en PickupHandoffDialog.tsx; la lógica pura, en lib/pickupOrders.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  posKeys,
  usePickupOrder,
  usePickupOrders,
  useUpdatePickupOrderStatus,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { toastDurationFor } from '@/lib/apiError';
import { formatDateTime } from '@/lib/date';
import {
  PICKUP_TABS,
  agoLabel,
  buildPickupReceiptPayload,
  defaultPickupTab,
  describePickupPatchError,
  filterPickupOrders,
  groupPickupOrders,
  normalizeSearchText,
  pickupBuyerLabel,
  pickupSummary,
  unitsLabel,
  type PickupPrintVia,
  type PickupReceiptMode,
  type PickupTab,
} from '@/lib/pickupOrders';
import type {
  AwaitingPaymentOrder,
  PickupOrder,
  PickupOrderDetail,
  UpdatePickupOrderStatusBody,
} from '@/types/pickupOrders';
import { PickupOrderDetailPane, PickupStatusChip } from './PickupOrderDetail';
import {
  PickupHandoffDialog,
  type PickupHandoffState,
} from './PickupHandoffDialog';

interface PickupOrdersSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sucursal SOLO en modo staff (JWT de usuario); la terminal va por su
   *  licencia. */
  branchId?: string;
  /** Encabezado de las hojas impresas. */
  branchName: string;
  ticketName?: string;
  /** Zona horaria de la sucursal (fechas y horas en su hora local). */
  branchTz?: string;
  currencySymbol: string;
}

const NO_CHECKS: ReadonlySet<string> = new Set();

/** Color del contador de cada pestaña cuando tiene pedidos. */
const TAB_COUNT: Record<PickupTab, string> = {
  toPrepare: 'bg-amber-400 text-amber-950',
  ready: 'bg-sky-600 text-white',
  done: 'bg-emerald-100 text-emerald-800',
  awaitingPayment: 'bg-foreground/10 text-foreground',
};

export function PickupOrdersSheet({
  isOpen,
  onClose,
  branchId,
  branchName,
  ticketName,
  branchTz,
  currencySymbol,
}: PickupOrdersSheetProps) {
  const qc = useQueryClient();
  const listQuery = usePickupOrders(branchId, isOpen);
  const data = listQuery.data;
  const groups = useMemo(() => groupPickupOrders(data), [data]);

  const [tab, setTab] = useState<PickupTab>('toPrepare');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Palomeo por pedido (solo en esta pantalla). Sobrevive a cerrar y abrir la
  // hoja: se puede dejar un pedido a medias para atender una venta.
  const [checksByOrder, setChecksByOrder] = useState<
    Record<string, ReadonlySet<string>>
  >({});
  // "Regresar a por surtir" pide confirmación en dos pasos.
  const [confirmBackId, setConfirmBackId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<PickupHandoffState>(null);
  // Impresión/PDF en curso: `${id}:${hoja}:${print|pdf}` (un trabajo a la vez).
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  // Reloj para los "hace 5 min" de las tarjetas.
  const [now, setNow] = useState(() => Date.now());

  const detailQuery = usePickupOrder(branchId, selectedId, isOpen);
  const detail = detailQuery.data;
  const listRow = selectedId
    ? data?.orders.find((o) => o.id === selectedId)
    : undefined;
  const update = useUpdatePickupOrderStatus(branchId);
  const busy = update.isPending;

  // Al abrir: la pestaña donde hay trabajo (por surtir; si no hay, los
  // listos) y sin búsqueda. El pedido elegido se conserva solo si sigue en
  // esa pestaña (p. ej. uno que se dejó a medio surtir).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const first = defaultPickupTab(pickupSummary(data));
      setTab(first);
      setQuery('');
      setConfirmBackId(null);
      setSelectedId((cur) =>
        cur && groups[first].some((o) => o.id === cur) ? cur : null,
      );
      setNow(Date.now());
    }
    // Si la hoja se cierra desde fuera (cambio de sucursal, terminal
    // bloqueada), el diálogo de entrega no se queda abierto solo.
    if (!isOpen) setHandoff(null);
    wasOpen.current = isOpen;
    // Solo al abrir: los pedidos se leen como estén en ese momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Cambio de sucursal (modo staff): lo elegido y lo palomeado eran de la otra.
  useEffect(() => {
    setSelectedId(null);
    setChecksByOrder({});
    setConfirmBackId(null);
    setHandoff(null);
    setQuery('');
  }, [branchId]);

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [isOpen]);

  // La lista y el detalle se consultan por separado. Si traen el mismo pedido
  // en estados distintos (lo movió otra caja o el admin) se vuelve a pedir el
  // más viejo de los dos, una sola vez por diferencia.
  const reconciled = useRef('');
  const detailStatus = detail?.status;
  const listStatus = listRow?.status;
  const detailUpdatedAt = detailQuery.dataUpdatedAt;
  const listUpdatedAt = listQuery.dataUpdatedAt;
  const refetchList = listQuery.refetch;
  const refetchDetail = detailQuery.refetch;
  useEffect(() => {
    if (!isOpen || !selectedId || !detailStatus || !listStatus) return;
    if (detailStatus === listStatus) {
      reconciled.current = '';
      return;
    }
    const signature = `${selectedId}:${listStatus}:${detailStatus}`;
    if (reconciled.current === signature) return;
    reconciled.current = signature;
    if (detailUpdatedAt >= listUpdatedAt) void refetchList();
    else void refetchDetail();
  }, [
    isOpen,
    selectedId,
    detailStatus,
    listStatus,
    detailUpdatedAt,
    listUpdatedAt,
    refetchList,
    refetchDetail,
  ]);

  // Con búsqueda, los contadores de las pestañas dicen cuántos coinciden en
  // cada una: así se ve en cuál está el pedido que se busca.
  const filtered = useMemo(
    () => ({
      toPrepare: filterPickupOrders(groups.toPrepare, query),
      ready: filterPickupOrders(groups.ready, query),
      done: filterPickupOrders(groups.done, query),
      awaitingPayment: filterPickupOrders(groups.awaitingPayment, query),
    }),
    [groups, query],
  );
  const searching = normalizeSearchText(query) !== '';
  const tabInfo = PICKUP_TABS.find((t) => t.id === tab) ?? PICKUP_TABS[0];

  const money = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const when = (iso?: string | null) =>
    iso && Number.isFinite(Date.parse(iso)) ? formatDateTime(iso, branchTz) : '';

  const close = () => {
    if (busy) return;
    setConfirmBackId(null);
    onClose();
  };

  const selectTab = (next: PickupTab) => {
    setTab(next);
    setSelectedId(null);
    setConfirmBackId(null);
  };

  const selectOrder = (id: string | null) => {
    setSelectedId(id);
    setConfirmBackId(null);
  };

  /** Suelta el pedido que se acaba de mover (ya cambió de pestaña). Si
   *  mientras se guardaba se eligió otro, ese se queda. */
  const releaseOrder = (orderId: string) => {
    setSelectedId((cur) => (cur === orderId ? null : cur));
  };

  const refresh = () => {
    void listQuery.refetch();
    if (selectedId) void detailQuery.refetch();
  };

  const toggleCheck = (orderId: string, key: string) => {
    setChecksByOrder((prev) => {
      const next = new Set(prev[orderId] ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [orderId]: next };
    });
  };

  const setAllChecks = (orderId: string, keys: string[]) => {
    setChecksByOrder((prev) => ({ ...prev, [orderId]: new Set(keys) }));
  };

  const clearChecks = (orderId: string) => {
    setChecksByOrder((prev) => {
      if (!(orderId in prev)) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  };

  /** Manda el cambio de estado. Si falla, avisa y vuelve a consultar. */
  async function changeStatus(
    order: PickupOrderDetail,
    body: UpdatePickupOrderStatusBody,
  ): Promise<{ ok: true; order: PickupOrderDetail } | { ok: false; conflict: boolean }> {
    try {
      const updated = await update.mutateAsync({ id: order.id, body });
      return { ok: true, order: { ...updated, id: updated.id || order.id } };
    } catch (err) {
      const problem = describePickupPatchError(err);
      if (problem.kind === 'conflict') toast.warning(problem.message);
      else {
        toast.error(problem.message, {
          duration: toastDurationFor(problem.message),
        });
      }
      // El pedido pudo haber cambiado (409) o el cambio pudo guardarse aunque
      // no llegara la respuesta: se vuelve a consultar para ver cómo quedó.
      void qc.invalidateQueries({ queryKey: posKeys.pickupOrders(branchId) });
      void qc.invalidateQueries({
        queryKey: posKeys.pickupOrder(branchId, order.id),
      });
      return { ok: false, conflict: problem.kind === 'conflict' };
    }
  }

  async function markReady(order: PickupOrderDetail) {
    const r = await changeStatus(order, { status: 'ready' });
    if (!r.ok) return;
    toast.success(`Pedido ${order.orderNumber} listo para recoger`, {
      description: 'Ya se le avisó al comprador.',
    });
    releaseOrder(order.id);
  }

  async function sendBack(order: PickupOrderDetail) {
    const r = await changeStatus(order, { status: 'pending' });
    setConfirmBackId(null);
    if (!r.ok) return;
    // Regresa a por surtir sin palomas: hay que volver a revisarlo.
    clearChecks(order.id);
    toast.success(`Pedido ${order.orderNumber} regresado a por surtir`);
    releaseOrder(order.id);
  }

  async function confirmHandoff(
    order: PickupOrderDetail,
    receivedByName: string,
    notes: string,
  ) {
    const note = notes.trim();
    const r = await changeStatus(order, {
      status: 'delivered',
      receivedByName: receivedByName.trim(),
      ...(note ? { notes: note } : {}),
    });
    if (!r.ok) {
      // Si el pedido cambió (ya lo entregó otra caja, se canceló…) el
      // diálogo ya no aplica; con otro error se queda para reintentar.
      if (r.conflict) setHandoff(null);
      return;
    }
    clearChecks(order.id);
    toast.success('Pedido entregado', {
      description: `${order.orderNumber} · lo recogió ${r.order.receivedByName ?? receivedByName.trim()}`,
    });
    releaseOrder(order.id);
    // El diálogo pasa a ofrecer el comprobante de entrega.
    setHandoff({ step: 'done', order: r.order });
  }

  /** Imprime (o guarda en PDF) la hoja de surtido o el comprobante de
   *  entrega. Devuelve true si salió bien. */
  async function printOrder(
    order: PickupOrderDetail,
    mode: PickupReceiptMode,
    via: PickupPrintVia,
  ): Promise<boolean> {
    setPrintingKey(`${order.id}:${mode}:${via}`);
    try {
      const payload = buildPickupReceiptPayload(order, mode, {
        branchName,
        ticketName,
      });
      if (via === 'print') {
        const r = await window.toniclife.printer.printPickupOrder(payload);
        if (r.ok) {
          toast.success(
            mode === 'handoff'
              ? `Comprobante de entrega ${order.orderNumber} impreso`
              : `Hoja de surtido ${order.orderNumber} impresa`,
          );
          return true;
        }
        toast.error(
          mode === 'handoff'
            ? 'No se pudo imprimir el comprobante'
            : 'No se pudo imprimir la hoja',
          { description: r.error },
        );
        return false;
      }
      const r = await window.toniclife.printer.savePickupOrderPdf(payload);
      if (r.ok) {
        toast.success(
          `${mode === 'handoff' ? 'Comprobante de entrega' : 'Hoja de surtido'} ${order.orderNumber} en PDF`,
          {
            description: `Guardado en ${r.path}; desde el visor lo imprimes o lo archivas.`,
            duration: 8000,
          },
        );
        return true;
      }
      toast.error('No se pudo generar el PDF', { description: r.error });
      return false;
    } catch (err) {
      toast.error(
        `Error al ${via === 'print' ? 'imprimir' : 'generar el PDF'}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      setPrintingKey(null);
    }
  }

  const row = detail ?? listRow;
  const list = tab === 'awaitingPayment' ? [] : filtered[tab];

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          className="flex w-[80vw] flex-col gap-0 p-0 sm:max-w-[80vw]"
          showCloseButton={false}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          {/* Encabezado */}
          <SheetHeader className="flex-row items-center justify-between space-y-0 border-b px-6 py-4 text-left">
            <div className="flex items-center gap-2">
              <ShoppingBag className="size-5 text-primary" />
              <div>
                <SheetTitle className="text-lg font-bold text-foreground">
                  Pedidos en línea · Recoger en sucursal
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Compras de la tienda en línea que se recogen en {branchName}:
                  súrtelas, márcalas listas y entrégalas.
                </SheetDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={close}
              disabled={busy}
              aria-label="Cerrar"
            >
              <X className="size-4 text-muted-foreground" />
            </Button>
          </SheetHeader>

          {/* Pestañas con contador, buscador y actualizar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-2.5">
            <div
              role="tablist"
              aria-label="Pedidos por estado"
              className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1"
            >
              {PICKUP_TABS.map((t) => {
                const active = tab === t.id;
                const n = filtered[t.id].length;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t.label}
                    <span
                      className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular-nums ${
                        n > 0 ? TAB_COUNT[t.id] : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {n}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative ml-auto w-72">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar folio, nombre, No. o teléfono…"
                className="h-8 w-full pl-8 pr-7 text-xs"
                aria-label="Buscar pedido"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="Limpiar búsqueda"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={refresh}
              disabled={listQuery.isFetching}
            >
              <RefreshCw
                className={`size-3.5 ${listQuery.isFetching ? 'animate-spin' : ''}`}
              />
              Actualizar
            </Button>
          </div>

          {/* Si la última consulta falló se sigue mostrando lo que ya se tenía. */}
          {data && listQuery.isError && (
            <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-xs text-amber-900">
              <TriangleAlert className="size-3.5 shrink-0" />
              No se pudo actualizar la lista; ves lo último que se cargó
              {listQuery.dataUpdatedAt
                ? ` (${when(new Date(listQuery.dataUpdatedAt).toISOString())})`
                : ''}
              . Revisa la conexión.
            </div>
          )}

          {/* Cuerpo */}
          <div className="flex min-h-0 flex-1">
            {data === undefined ? (
              listQuery.isError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
                  <p className="text-sm text-destructive">
                    No se pudieron cargar los pedidos. Revisa la conexión.
                  </p>
                  <Button variant="outline" size="sm" onClick={refresh}>
                    <RefreshCw />
                    Reintentar
                  </Button>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Cargando pedidos…
                </div>
              )
            ) : data === null ? (
              <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
                Esta sección no está disponible para esta sucursal o esta cuenta.
              </div>
            ) : tab === 'awaitingPayment' ? (
              <AwaitingPaymentList
                orders={filtered.awaitingPayment}
                emptyText={
                  searching
                    ? 'Ningún pedido sin pagar coincide con la búsqueda.'
                    : tabInfo.empty
                }
                money={money}
                when={when}
              />
            ) : list.length === 0 && !selectedId ? (
              // Pestaña vacía: el aviso ocupa todo el ancho.
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
                <ShoppingBag className="size-10 text-muted-foreground/40" />
                <p className="text-sm">
                  {searching
                    ? 'Ningún pedido de esta pestaña coincide con la búsqueda.'
                    : tabInfo.empty}
                </p>
                {searching && (
                  <p className="text-xs text-muted-foreground/80">
                    Los contadores de las otras pestañas dicen si está en alguna
                    de ellas.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Lista de tarjetas (en pantallas angostas se oculta al elegir un pedido) */}
                <div
                  className={`min-h-0 w-full flex-col overflow-y-auto lg:w-[380px] lg:shrink-0 lg:border-r ${
                    selectedId ? 'hidden lg:flex' : 'flex'
                  }`}
                >
                  {list.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      {searching
                        ? 'Ningún pedido de esta pestaña coincide con la búsqueda.'
                        : tabInfo.empty}
                    </p>
                  ) : (
                    <div className="space-y-2 p-3">
                      {tab === 'done' && (
                        <p className="px-1 text-[11px] text-muted-foreground">
                          Entregados y cancelados de los últimos 7 días.
                        </p>
                      )}
                      {list.map((o) => (
                        <OrderCard
                          key={o.id}
                          order={o}
                          selected={o.id === selectedId}
                          inProgress={
                            o.status === 'pending' &&
                            (checksByOrder[o.id]?.size ?? 0) > 0
                          }
                          now={now}
                          money={money}
                          when={when}
                          onSelect={() => selectOrder(o.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Detalle del pedido elegido */}
                <div
                  className={`min-h-0 min-w-0 flex-1 flex-col ${
                    selectedId ? 'flex' : 'hidden lg:flex'
                  }`}
                >
                  {!selectedId ? (
                    <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
                      Elige un pedido de la lista para ver sus productos.
                    </div>
                  ) : !row ? (
                    detailQuery.isError ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
                        <p className="text-sm text-destructive">
                          No se pudo cargar el pedido.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectOrder(null)}
                          >
                            <ArrowLeft />
                            Volver
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void detailQuery.refetch()}
                          >
                            <RefreshCw />
                            Reintentar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Cargando pedido…
                      </div>
                    )
                  ) : (
                    <PickupOrderDetailPane
                      row={row}
                      detail={detail}
                      loadFailed={detailQuery.isError && !detail}
                      onRetry={() => void detailQuery.refetch()}
                      checked={checksByOrder[row.id] ?? NO_CHECKS}
                      onToggle={(key) => toggleCheck(row.id, key)}
                      onSetAll={(keys) => setAllChecks(row.id, keys)}
                      busy={busy}
                      printingKey={printingKey}
                      confirmingBack={confirmBackId === row.id}
                      onAskBack={() => setConfirmBackId(row.id)}
                      onCancelBack={() => setConfirmBackId(null)}
                      onSendBack={sendBack}
                      onMarkReady={markReady}
                      onHandoff={(order) => setHandoff({ step: 'form', order })}
                      onPrint={printOrder}
                      onBack={() => selectOrder(null)}
                      money={money}
                      when={when}
                    />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Pie: nota fija sobre las existencias */}
          <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 px-6 py-3">
            <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-muted-foreground">
              {data && (
                <>
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {data.stockHold
                      ? 'Las piezas de estos pedidos están apartadas: caja no las muestra como disponibles hasta que se entregan o se cancelan.'
                      : 'Las piezas de estos pedidos ya se descontaron de las existencias al pagarse.'}
                  </span>
                </>
              )}
            </p>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cerrar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <PickupHandoffDialog
        state={handoff}
        stockHold={data?.stockHold === true}
        busy={busy}
        printingKey={printingKey}
        money={money}
        onClose={() => setHandoff(null)}
        onConfirm={confirmHandoff}
        onPrint={printOrder}
      />
    </>
  );
}

// ============================================================================
// TARJETA DE LA LISTA
// ============================================================================

function OrderCard({
  order,
  selected,
  inProgress,
  now,
  money,
  when,
  onSelect,
}: {
  order: PickupOrder;
  selected: boolean;
  /** Ya tiene productos palomeados en esta pantalla. */
  inProgress: boolean;
  now: number;
  money: (n: number) => string;
  when: (iso?: string | null) => string;
  onSelect: () => void;
}) {
  const paid = `Pagado ${agoLabel(order.requestedAt, now) ?? when(order.requestedAt)}`;
  const lastStep =
    order.status === 'delivered'
      ? `Entregado ${when(order.deliveredAt)}${
          order.receivedByName ? ` · lo recogió ${order.receivedByName}` : ''
        }`
      : order.status === 'cancelled'
        ? `Cancelado ${when(order.cancelledAt)}`
        : order.status === 'ready' && order.readyAt
          ? `Listo ${agoLabel(order.readyAt, now) ?? when(order.readyAt)}`
          : paid;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left text-xs transition-colors ${
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'bg-background hover:bg-muted/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">
          {order.orderNumber}
        </span>
        <PickupStatusChip order={order} />
        {inProgress && (
          <span className="rounded-full border border-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Surtiendo…
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium text-foreground">
        {pickupBuyerLabel(order) || 'Comprador sin nombre'}
      </p>
      {order.recipientPhone && (
        <p className="text-muted-foreground">Tel. {order.recipientPhone}</p>
      )}
      <p className="mt-1 tabular-nums text-foreground">
        {unitsLabel(order.itemsUnits)} · {money(order.saleTotal)}
      </p>
      <p className="text-[11px] text-muted-foreground">{lastStep}</p>
    </button>
  );
}

// ============================================================================
// PESTAÑA "SIN PAGAR" (solo consulta)
// ============================================================================

function AwaitingPaymentList({
  orders,
  emptyText,
  money,
  when,
}: {
  orders: AwaitingPaymentOrder[];
  emptyText: string;
  money: (n: number) => string;
  when: (iso?: string | null) => string;
}) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
        <ShoppingBag className="size-10 text-muted-foreground/40" />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Todavía no se paga: no lo surtas. Si no se paga, el apartado se libera
          solo.
        </p>
      </div>
      <div className="rounded-md border">
        <Table className="text-sm">
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead className="px-3 py-1.5">Folio</TableHead>
              <TableHead className="px-3 py-1.5">Comprador</TableHead>
              <TableHead className="px-3 py-1.5 text-right">Piezas</TableHead>
              <TableHead className="px-3 py-1.5 text-right">Total</TableHead>
              <TableHead className="px-3 py-1.5">Creado</TableHead>
              <TableHead className="px-3 py-1.5">Apartado hasta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.orderId || o.orderNumber}>
                <TableCell className="px-3 py-2 font-mono font-semibold">
                  {o.orderNumber}
                </TableCell>
                <TableCell className="whitespace-normal px-3 py-2">
                  {pickupBuyerLabel(o) || 'Comprador sin nombre'}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {o.itemsUnits}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(o.total)}
                </TableCell>
                <TableCell className="px-3 py-2 text-muted-foreground">
                  {when(o.createdAt) || '—'}
                </TableCell>
                <TableCell className="px-3 py-2 text-muted-foreground">
                  {when(o.expiresAt) || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
