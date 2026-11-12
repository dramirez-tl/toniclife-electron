// PickupOrderDetail - Detalle de un pedido en línea para recoger en sucursal
// (lado derecho de PickupOrdersSheet): datos del comprador, su nota, la tabla
// de productos con una casilla por renglón para ir palomeando al surtir (en
// los kits/paquetes/promos se palomean las piezas, no el kit) y los botones
// que tocan según el estado del pedido.

import { Fragment } from 'react';
import {
  ArrowLeft,
  Check,
  CircleCheck,
  FileDown,
  Info,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  isPickupFullyChecked,
  normalizeSearchText,
  pickupCheckKeys,
  pickupCheckProgress,
  pickupItemCheckKeys,
  pickupStatusLabel,
  unitsLabel,
  type PickupPrintVia,
  type PickupReceiptMode,
} from '@/lib/pickupOrders';
import type {
  PickupOrder,
  PickupOrderDetail,
  PickupOrderItem,
} from '@/types/pickupOrders';

/** Color de la etiqueta de estado. */
const STATUS_CHIP: Record<string, string> = {
  production: 'bg-violet-100 text-violet-800',
  pending: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
};

/** Etiqueta de color con el estado del pedido. */
export function PickupStatusChip({ order }: { order: Pick<PickupOrder, 'status' | 'statusLabel'> }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        STATUS_CHIP[order.status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {pickupStatusLabel(order)}
    </span>
  );
}

export function PickupOrderDetailPane({
  row,
  detail,
  loadFailed,
  onRetry,
  checked,
  onToggle,
  onSetAll,
  busy,
  printingKey,
  confirmingBack,
  onAskBack,
  onCancelBack,
  onSendBack,
  onMarkReady,
  onHandoff,
  onPrint,
  onBack,
  money,
  when,
}: {
  /** Datos del pedido: el detalle o, mientras carga, la fila de la lista. */
  row: PickupOrder;
  /** Detalle con renglones (undefined mientras carga). */
  detail: PickupOrderDetail | undefined;
  loadFailed: boolean;
  onRetry: () => void;
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onSetAll: (keys: string[]) => void;
  busy: boolean;
  printingKey: string | null;
  confirmingBack: boolean;
  onAskBack: () => void;
  onCancelBack: () => void;
  onSendBack: (order: PickupOrderDetail) => void;
  onMarkReady: (order: PickupOrderDetail) => void;
  onHandoff: (order: PickupOrderDetail) => void;
  onPrint: (order: PickupOrderDetail, mode: PickupReceiptMode, via: PickupPrintVia) => Promise<boolean>;
  onBack: () => void;
  money: (n: number) => string;
  when: (iso?: string | null) => string;
}) {
  const status = row.status;
  // Solo se palomea mientras está por surtir.
  const checkable = status === 'pending' && !!detail;
  const items = detail?.items ?? [];
  const keys = pickupCheckKeys(items);
  const progress = pickupCheckProgress(items, checked);
  const allChecked = !!detail && isPickupFullyChecked(items, checked);
  const buyerName = (row.customerName ?? '').trim() || row.recipientName;
  const otherRecipient =
    !!row.recipientName &&
    normalizeSearchText(row.recipientName) !== normalizeSearchText(buyerName);
  const known =
    status === 'pending' ||
    status === 'ready' ||
    status === 'production' ||
    status === 'delivered' ||
    status === 'cancelled';

  const printButtons = (order: PickupOrderDetail, mode: PickupReceiptMode, label: string) => (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onPrint(order, mode, 'print')}
        disabled={printingKey !== null || busy}
        title={
          mode === 'handoff'
            ? 'Imprime el comprobante con quién recogió y la línea de firma'
            : 'Imprime la hoja con casillas para palomear al juntar las piezas'
        }
      >
        {printingKey === `${order.id}:${mode}:print` ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Printer />
        )}
        {label}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onPrint(order, mode, 'pdf')}
        disabled={printingKey !== null || busy}
        title="Guarda la misma hoja en PDF (Documentos\Tonic Life\Tickets)"
      >
        {printingKey === `${order.id}:${mode}:pdf` ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown />
        )}
        PDF
      </Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Folio y estado */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 lg:hidden"
          onClick={onBack}
        >
          <ArrowLeft />
          Volver
        </Button>
        <span className="font-mono text-lg font-bold text-foreground">
          {row.orderNumber}
        </span>
        <PickupStatusChip order={row} />
        {when(row.requestedAt) && (
          <span className="ml-auto text-xs text-muted-foreground">
            Pagado {when(row.requestedAt)}
          </span>
        )}
      </div>

      {/* Contenido con scroll propio */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* Comprador */}
        <section className="rounded-lg border p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Comprador
          </p>
          <p className="mt-0.5 font-semibold text-foreground">
            {buyerName || 'Sin nombre'}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-muted-foreground">
            <span>
              No. de distribuidor:{' '}
              <span className="font-mono text-foreground">
                {row.customerNumber ? `#${row.customerNumber}` : '—'}
              </span>
            </span>
            <span>
              Teléfono:{' '}
              <span className="text-foreground">{row.recipientPhone ?? '—'}</span>
            </span>
            {otherRecipient && (
              <span>
                Recoge: <span className="text-foreground">{row.recipientName}</span>
              </span>
            )}
          </div>
        </section>

        {row.notes && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="text-[11px] font-semibold uppercase tracking-wide">
              Nota del comprador
            </p>
            <p className="mt-0.5 whitespace-pre-wrap">{row.notes}</p>
          </section>
        )}

        {row.warehouseNotes && (
          <section className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Nota de la sucursal
            </p>
            <p className="mt-0.5 whitespace-pre-wrap">{row.warehouseNotes}</p>
          </section>
        )}

        {status === 'production' && (
          <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Trae producto bajo pedido que todavía se está elaborando. Aparecerá
              por surtir cuando esté listo.
            </p>
          </div>
        )}

        {status === 'delivered' && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
            <p>
              {[
                `Entregado a ${row.receivedByName ?? 'quien lo recogió'}`,
                when(row.deliveredAt),
                row.handoffTerminal,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}

        {status === 'cancelled' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">
                Pedido cancelado{when(row.cancelledAt) ? ` · ${when(row.cancelledAt)}` : ''}
              </p>
              <p>Motivo: {row.cancelReason ?? 'sin motivo registrado'}</p>
              <p className="mt-1 text-xs">
                No lo entregues. Si ya lo habías surtido, regresa las piezas a su
                lugar.
              </p>
            </div>
          </div>
        )}

        {!known && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Este pedido está en un estado que esta versión del POS no conoce (
              {pickupStatusLabel(row)}). Actualiza el POS o revísalo en el admin.
            </p>
          </div>
        )}

        {/* Productos */}
        {!detail ? (
          loadFailed ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-destructive">
                No se pudieron cargar los productos del pedido.
              </p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw />
                Reintentar
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando productos…
            </div>
          )
        ) : (
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">
                Productos del pedido
              </p>
              {checkable && keys.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  onClick={() => onSetAll(allChecked ? [] : keys)}
                  disabled={busy}
                >
                  {allChecked ? 'Quitar palomas' : 'Marcar todo'}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border py-6 text-center text-sm text-muted-foreground">
                Este pedido no trae productos para surtir.
              </p>
            ) : (
              <ItemsTable
                items={items}
                checkable={checkable}
                disabled={busy}
                checked={checked}
                onToggle={onToggle}
              />
            )}
            <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-4 text-sm">
              <span className="text-muted-foreground">
                {unitsLabel(row.itemsUnits)} · {row.itemsCount}{' '}
                {row.itemsCount === 1 ? 'producto' : 'productos'}
              </span>
              <span className="font-semibold text-foreground">
                Total del pedido:{' '}
                <span className="tabular-nums">{money(row.saleTotal)}</span>
              </span>
            </div>
          </section>
        )}
      </div>

      {/* Acciones según el estado: el texto de ayuda va en su propio renglón
          para que los botones quepan juntos también en pantallas chicas. */}
      {detail && status === 'pending' && (
        <div className="shrink-0 space-y-2 border-t bg-muted/30 px-5 py-3">
          <p
            className={`text-xs ${
              allChecked ? 'font-medium text-emerald-700' : 'text-muted-foreground'
            }`}
          >
            {allChecked
              ? 'Todo palomeado: ya puedes marcarlo surtido.'
              : `Palomea cada producto al apartarlo (${progress.done} de ${progress.total}).`}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {printButtons(detail, 'picking', 'Imprimir hoja de surtido')}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onHandoff(detail)}
              disabled={!allChecked || busy}
              title="Para cuando el cliente ya está esperando en mostrador"
            >
              Entregar ahora
            </Button>
            <Button onClick={() => onMarkReady(detail)} disabled={!allChecked || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck />}
              Marcar surtido · listo para recoger
            </Button>
          </div>
        </div>
      )}

      {detail && status === 'ready' && (
        <div className="shrink-0 space-y-2 border-t bg-muted/30 px-5 py-3">
          {confirmingBack ? (
            <>
              <p className="text-xs text-foreground">
                ¿Regresar este pedido a por surtir? El comprador lo volverá a ver
                como &quot;Preparando tu pedido&quot;.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onCancelBack} disabled={busy}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => onSendBack(detail)} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 />}
                  Sí, regresar a por surtir
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Ya está apartado. Entrégalo cuando pasen por él.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {printButtons(detail, 'picking', 'Imprimir hoja')}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAskBack}
                  disabled={busy}
                  title="Para corregir: vuelve a quedar por surtir"
                >
                  <Undo2 />
                  Regresar a por surtir
                </Button>
                <Button onClick={() => onHandoff(detail)} disabled={busy}>
                  <PackageCheck />
                  Entregar al cliente
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {detail && status === 'delivered' && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          {printButtons(detail, 'handoff', 'Reimprimir comprobante')}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TABLA DE PRODUCTOS (con casillas para palomear al surtir)
// ============================================================================

function ItemsTable({
  items,
  checkable,
  disabled,
  checked,
  onToggle,
}: {
  items: PickupOrderItem[];
  /** true = por surtir: cada renglón (o pieza de kit) lleva su casilla. */
  checkable: boolean;
  disabled: boolean;
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const toggle = (key: string) => {
    if (checkable && !disabled) onToggle(key);
  };
  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="text-sm">
        <TableHeader className="bg-muted/60">
          <TableRow>
            {checkable && <TableHead className="w-10 px-3 py-1.5" />}
            <TableHead className="w-16 px-3 py-1.5 text-right font-medium text-muted-foreground">
              Cant
            </TableHead>
            <TableHead className="w-32 px-3 py-1.5 font-medium text-muted-foreground">
              Clave
            </TableHead>
            <TableHead className="px-3 py-1.5 font-medium text-muted-foreground">
              Producto
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => {
            const components = it.components ?? [];
            const isKit = components.length > 0;
            // Claves de palomeo: las de sus piezas si es kit; si no, la del
            // propio renglón.
            const itemKeys = pickupItemCheckKeys(it);
            const doneCount = itemKeys.filter((k) => checked.has(k)).length;
            // Un kit queda surtido cuando lo están todas sus piezas.
            const done = doneCount === itemKeys.length;
            return (
              <Fragment key={it.id}>
                <TableRow
                  className={`${checkable && !isKit ? 'cursor-pointer' : ''} ${
                    checkable && done ? 'bg-emerald-50 hover:bg-emerald-50' : ''
                  }`}
                  onClick={isKit ? undefined : () => toggle(itemKeys[0])}
                >
                  {checkable && (
                    <TableCell className="px-3 py-2">
                      {isKit ? (
                        done ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : (
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {doneCount}/{itemKeys.length}
                          </span>
                        )
                      ) : (
                        <Checkbox
                          className="size-5"
                          checked={done}
                          disabled={disabled}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggle(itemKeys[0])}
                          aria-label={`Ya aparté ${it.productName}`}
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">
                    {it.quantity}
                  </TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {it.productSku}
                  </TableCell>
                  <TableCell className="whitespace-normal px-3 py-2 text-foreground">
                    <span className={isKit ? 'font-medium' : ''}>{it.productName}</span>
                    {it.madeToOrder && (
                      <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
                        Bajo pedido
                      </span>
                    )}
                    {it.personalization && (
                      <p className="mt-0.5 text-xs text-violet-900">
                        Personalización: {it.personalization}
                      </p>
                    )}
                    {isKit && checkable && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Se surte por piezas: palomea cada una.
                      </p>
                    )}
                  </TableCell>
                </TableRow>
                {components.map((c, i) => {
                  const key = itemKeys[i];
                  const pieceDone = checked.has(key);
                  return (
                    <TableRow
                      key={key}
                      className={`${checkable ? 'cursor-pointer' : ''} ${
                        checkable && pieceDone
                          ? 'bg-emerald-50 hover:bg-emerald-50'
                          : 'bg-muted/20'
                      }`}
                      onClick={() => toggle(key)}
                    >
                      {checkable && (
                        <TableCell className="py-1.5 pl-6 pr-3">
                          <Checkbox
                            className="size-5"
                            checked={pieceDone}
                            disabled={disabled}
                            onClick={(e) => e.stopPropagation()}
                            onCheckedChange={() => toggle(key)}
                            aria-label={`Ya aparté ${c.name}`}
                          />
                        </TableCell>
                      )}
                      {/* Sangría: la pieza queda debajo de su kit (con casilla,
                          junto a ella; sin casilla, alineada con la clave). */}
                      <TableCell
                        colSpan={3}
                        className={`whitespace-normal py-1.5 pr-3 text-foreground ${
                          checkable ? 'pl-8' : 'pl-[4.75rem]'
                        }`}
                      >
                        <span className="font-semibold tabular-nums">
                          {c.quantityTotal} ×
                        </span>{' '}
                        {c.name}
                        {c.sku && (
                          <>
                            {' '}
                            <span className="font-mono text-xs text-muted-foreground">
                              ({c.sku})
                            </span>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
