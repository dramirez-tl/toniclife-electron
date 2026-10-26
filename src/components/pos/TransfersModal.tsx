// TransfersModal - Entradas de inventario: traspasos En Tránsito dirigidos a
// esta sucursal + histórico de movimientos. Panel lateral (80 % del ancho)
// para que la tabla de productos quepa completa.
// La entrada la acepta la propia sucursal (decisión de Dirección,
// 26-oct-2026; antes solo CEDEAS/Operaciones desde el modo staff) con
// recepción total o parcial. Cada traspaso se puede IMPRIMIR como lista con
// casillas para palomear con pluma al contar, o guardar en PDF; desde el
// histórico se reimprime (con enviado/recibido) para el archivo.

import { useEffect, useState } from 'react';
import {
  X,
  PackageCheck,
  ArrowRight,
  Check,
  Inbox,
  Loader2,
  Lock,
  Printer,
  FileDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  useIncomingTransfers,
  useReceiveTransfer,
  useBranchInventoryMovements,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';
import type { TransferReceiptPayload } from '@/types';
import type {
  BranchInventoryMovement,
  IncomingTransfer,
  IncomingTransferItem,
} from '@/types/pos';

/** Roles (código del JWT, `staffUser.roleCode`) que aceptan entradas de
 *  traspasos desde el POS en modo staff. Espejo del @Roles del API. */
export const TRANSFER_RECEIVE_ROLES = [
  'super_admin',
  'administrador',
  'admin',
  'operaciones',
  'cedeas',
  'manager',
  'cashier',
  'call_center',
];

/** Etiqueta y color por tipo de movimiento (CHECK de inventory_movements). */
const MOVEMENT_TYPE_META: Record<string, { label: string; className: string }> =
  {
    entry: { label: 'Entrada', className: 'bg-emerald-100 text-emerald-700' },
    exit: { label: 'Salida', className: 'bg-red-100 text-red-700' },
    transfer_in: {
      label: 'Traspaso recibido',
      className: 'bg-sky-100 text-sky-700',
    },
    transfer_out: {
      label: 'Traspaso enviado',
      className: 'bg-sky-100 text-sky-700',
    },
    adjustment_positive: {
      label: 'Ajuste (+)',
      className: 'bg-amber-100 text-amber-700',
    },
    adjustment_negative: {
      label: 'Ajuste (−)',
      className: 'bg-amber-100 text-amber-700',
    },
    initial_load: {
      label: 'Carga inicial',
      className: 'bg-muted text-muted-foreground',
    },
    physical_count: {
      label: 'Conteo físico',
      className: 'bg-violet-100 text-violet-700',
    },
  };

const MOVEMENT_STATUS_LABEL: Record<string, string> = {
  applied: 'Aplicado',
  pending: 'Pendiente',
  approved: 'En tránsito',
  cancelled: 'Cancelado',
  rejected: 'Rechazado',
};

/** Códigos de razón de entradas/salidas (mismo catálogo que el admin); un
 *  traspaso trae el motivo libre que capturó quien lo envió y se muestra tal cual. */
const MOVEMENT_REASON_LABEL: Record<string, string> = {
  purchase: 'Compra a proveedor',
  return_from_customer: 'Devolución de cliente',
  transfer_in: 'Recepción de traspaso',
  initial_stock: 'Stock inicial',
  production: 'Producción',
  found: 'Producto encontrado',
  sale: 'Venta',
  return_to_supplier: 'Devolución a proveedor',
  transfer_out: 'Envío de traspaso',
  loss: 'Pérdida',
  expiration: 'Caducidad',
  damage: 'Daño/Merma',
  adjustment: 'Ajuste',
  other: 'Otros',
};

function movementReasonLabel(reason?: string): string {
  if (!reason) return '';
  return MOVEMENT_REASON_LABEL[reason] ?? reason;
}

/** Los traspasos del histórico se pueden reimprimir (tienen renglones). */
const isTransferMovement = (m: BranchInventoryMovement) =>
  m.movementType === 'transfer_in' || m.movementType === 'transfer_out';

interface TransfersModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  /** Encabezado del ticket impreso. */
  branchName: string;
  ticketName?: string;
  /** true = puede aceptar la entrada (la sucursal siempre; en modo staff
   *  solo los roles de TRANSFER_RECEIVE_ROLES). Imprimir no depende de esto. */
  canReceive: boolean;
}

export function TransfersModal({
  isOpen,
  onClose,
  branchId,
  branchName,
  ticketName,
  canReceive,
}: TransfersModalProps) {
  const { data: transfers = [], isLoading } = useIncomingTransfers(
    isOpen ? branchId : undefined,
  );
  const receive = useReceiveTransfer();
  // Confirmación en dos pasos por traspaso (evita aceptar por accidente).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Recepcion PARCIAL: cantidad recibida por linea (default = enviada). Solo
  // se manda al API lo que difiere; las diferencias quedan registradas como
  // faltante/excedente para Operacion.
  const [received, setReceived] = useState<Record<string, number>>({});
  const receivedQty = (it: IncomingTransferItem) =>
    received[it.id] ?? it.quantity;
  const hasDifferences = (t: IncomingTransfer) =>
    t.items.some((it) => receivedQty(it) !== it.quantity);
  // Impresión/PDF en curso: `${id}:print|pdf` (un trabajo a la vez).
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  // Histórico de movimientos de la sucursal (lo que Operación aplicó desde
  // el admin: entradas/salidas/ajustes/conteos, y traspasos).
  const [histPage, setHistPage] = useState(1);
  // El panel vive montado siempre: sin este reset, la página quedaba
  // "atorada" entre aperturas/sucursales (caso real: paginar a la 2 con la
  // 254 y cambiar a Mérida —1 sola página— dejaba el histórico "vacío" y
  // sin flechas para regresar).
  useEffect(() => {
    if (isOpen) {
      setHistPage(1);
      setConfirmingId(null);
      setReceived({});
      setPrintingKey(null);
    }
  }, [isOpen, branchId]);
  const { data: history, isLoading: histLoading } = useBranchInventoryMovements(
    isOpen ? branchId : undefined,
    histPage,
  );

  async function handleReceive(t: IncomingTransfer) {
    try {
      const items = t.items
        .filter((it) => receivedQty(it) !== it.quantity)
        .map((it) => ({ detailId: it.id, quantityReceived: receivedQty(it) }));
      await receive.mutateAsync({
        id: t.id,
        payload: items.length ? { items } : undefined,
      });
      toast.success(
        items.length
          ? `Entrada aceptada con ${items.length} diferencia(s) registrada(s): ${t.movementNumber}`
          : `Entrada aceptada: ${t.movementNumber}`,
      );
      setConfirmingId(null);
      setReceived({});
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message || 'Error al aceptar la entrada',
      );
    }
  }

  /** Payload del ticket impreso/PDF de un traspaso (pendiente o aplicado). */
  function buildReceiptPayload(t: IncomingTransfer): TransferReceiptPayload {
    const applied = t.status === 'applied';
    return {
      branchName,
      ticketName,
      movementNumber: t.movementNumber,
      originBranchName: t.branch?.name ?? '',
      destinationBranchName: t.destinationBranch?.name ?? '',
      direction: t.destinationBranch?.id === branchId ? 'in' : 'out',
      status: applied ? 'received' : 'pending',
      sentAt: t.requestedAt,
      sentBy: t.requestedBy?.name,
      receivedAt: applied ? t.appliedAt : undefined,
      receivedBy: applied ? t.appliedBy?.name : undefined,
      reason: t.reason || undefined,
      notes: t.notes || undefined,
      items: t.items.map((it) => ({
        sku: it.productCode,
        name: it.productName,
        quantity: it.quantity,
        quantityReceived: applied ? it.quantityReceived ?? it.quantity : undefined,
      })),
    };
  }

  async function printTransfer(t: IncomingTransfer, mode: 'print' | 'pdf') {
    const key = `${t.id}:${mode}`;
    setPrintingKey(key);
    try {
      const payload = buildReceiptPayload(t);
      if (mode === 'print') {
        const r = await window.toniclife.printer.printTransfer(payload);
        if (r.ok) toast.success(`Lista ${t.movementNumber} impresa`);
        else toast.error('No se pudo imprimir la lista', { description: r.error });
      } else {
        const r = await window.toniclife.printer.saveTransferPdf(payload);
        if (r.ok) {
          toast.success(`Traspaso ${t.movementNumber} en PDF`, {
            description: `Guardado en ${r.path}; desde el visor lo imprimes o lo archivas.`,
            duration: 8000,
          });
        } else {
          toast.error('No se pudo generar el PDF', { description: r.error });
        }
      }
    } catch (err) {
      toast.error(
        `Error al ${mode === 'print' ? 'imprimir' : 'generar el PDF'}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPrintingKey(null);
    }
  }

  /** Reimpresión desde el histórico: se consulta el traspaso completo (renglones
   *  y cantidades recibidas) y se imprime con lo enviado/recibido. */
  async function printHistoryTransfer(
    m: BranchInventoryMovement,
    mode: 'print' | 'pdf',
  ) {
    const key = `${m.id}:${mode}`;
    setPrintingKey(key);
    try {
      const t = await posApi.getTransfer(m.id, branchId);
      setPrintingKey(null);
      await printTransfer(t, mode);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message ||
          `No se pudo cargar el traspaso ${m.movementNumber}`,
      );
      setPrintingKey(null);
    }
  }

  const close = () => {
    if (receive.isPending) return;
    setConfirmingId(null);
    onClose();
  };

  const printButtons = (t: IncomingTransfer) => (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => printTransfer(t, 'print')}
        disabled={printingKey !== null || receive.isPending}
        title="Imprime la lista con casillas para palomear al contar"
      >
        {printingKey === `${t.id}:print` ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Printer />
        )}
        Imprimir lista
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => printTransfer(t, 'pdf')}
        disabled={printingKey !== null || receive.isPending}
        title="Guarda la misma lista en PDF (Documentos\\Tonic Life\\Tickets)"
      >
        {printingKey === `${t.id}:pdf` ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown />
        )}
        PDF
      </Button>
    </>
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex w-[80vw] flex-col gap-0 p-0 sm:max-w-[80vw]"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (receive.isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (receive.isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b px-6 py-4 text-left">
          <div className="flex items-center gap-2">
            <PackageCheck className="size-5 text-primary" />
            <div>
              <SheetTitle className="text-lg font-bold text-foreground">
                Entradas de inventario
              </SheetTitle>
              <SheetDescription className="text-xs">
                Traspasos por recibir + histórico de movimientos de la sucursal
              </SheetDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={close}
            disabled={receive.isPending}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </SheetHeader>

        {/* Cuerpo con scroll propio */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 px-6 py-5">
            {!canReceive && transfers.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  Tu usuario de staff no puede aceptar entradas desde el POS;
                  sal del modo staff para recibirlas como sucursal, o hazlo
                  desde el admin en Inventario › Traspasos.
                </p>
              </div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando entradas...
              </div>
            ) : transfers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <Inbox className="size-10 text-muted-foreground/50" />
                <p className="text-sm">
                  No hay traspasos pendientes de recibir.
                </p>
                <p className="text-xs text-muted-foreground/80">
                  Cuando una sucursal o el almacén envíe mercancía aquí,
                  aparecerá en esta lista.
                </p>
              </div>
            ) : (
              transfers.map((t) => {
                const confirming = confirmingId === t.id;
                const busy = receive.isPending && confirming;
                return (
                  <Card key={t.id} className="gap-0 rounded-lg py-0 shadow-none">
                    <CardContent className="p-0">
                      {/* Encabezado del traspaso */}
                      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <span className="font-mono">{t.movementNumber}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="truncate">{t.branch.name}</span>
                            <ArrowRight className="size-3 shrink-0" />
                            <span className="truncate font-medium text-foreground">
                              {t.destinationBranch.name}
                            </span>
                          </div>
                          {t.requestedAt && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              Enviado {formatDateTime(t.requestedAt)}
                              {t.requestedBy ? ` · ${t.requestedBy.name}` : ''}
                            </div>
                          )}
                          {/* Motivo y notas que capturó quien lo envió ("Pedido Mochis octubre"). */}
                          {(t.reason || t.notes) && (
                            <div
                              className="mt-1 text-xs text-foreground"
                              title={[t.reason, t.notes].filter(Boolean).join(' · ')}
                            >
                              {t.reason && <span className="font-medium">{t.reason}</span>}
                              {t.reason && t.notes ? ' · ' : ''}
                              {t.notes && <span className="text-muted-foreground">{t.notes}</span>}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div className="font-semibold text-foreground tabular-nums">
                            {t.totalItems}{' '}
                            {t.totalItems === 1 ? 'producto' : 'productos'}
                          </div>
                          <div className="tabular-nums">
                            {t.totalQuantity} piezas
                          </div>
                        </div>
                      </div>

                      {/* Items */}
                      <Table className="text-sm">
                        <TableHeader className="bg-muted/60">
                          <TableRow>
                            <TableHead className="px-4 py-1.5 text-left font-medium text-muted-foreground">
                              Producto
                            </TableHead>
                            <TableHead className="w-32 px-4 py-1.5 text-left font-medium text-muted-foreground">
                              Clave
                            </TableHead>
                            <TableHead className="w-28 px-4 py-1.5 text-right font-medium text-muted-foreground">
                              Enviado
                            </TableHead>
                            <TableHead className="w-40 px-4 py-1.5 text-right font-medium text-muted-foreground">
                              Recibido
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {t.items.map((it) => {
                            const rq = receivedQty(it);
                            const diff = rq - it.quantity;
                            return (
                              <TableRow key={it.id}>
                                <TableCell className="whitespace-normal px-4 py-1.5 text-foreground">
                                  {it.productName}
                                </TableCell>
                                <TableCell className="px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                                  {it.productCode}
                                </TableCell>
                                <TableCell className="px-4 py-1.5 text-right tabular-nums">
                                  {it.quantity}
                                </TableCell>
                                <TableCell className="px-4 py-1.5 text-right">
                                  {canReceive ? (
                                    <div className="flex items-center justify-end gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={rq}
                                        disabled={receive.isPending}
                                        onChange={(e) => {
                                          const v = Math.max(
                                            0,
                                            Math.floor(Number(e.target.value) || 0),
                                          );
                                          setReceived((prev) => ({ ...prev, [it.id]: v }));
                                        }}
                                        className={`h-8 w-20 rounded-md border bg-background px-2 text-right text-sm tabular-nums ${
                                          diff !== 0
                                            ? 'border-amber-500 text-amber-700'
                                            : 'border-input'
                                        }`}
                                        aria-label={`Cantidad recibida de ${it.productName}`}
                                      />
                                      <span className="w-12 text-[11px] font-medium text-amber-700 tabular-nums">
                                        {diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : ''}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="tabular-nums text-muted-foreground">
                                      {it.quantity}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>

                      {/* Acciones: imprimir/PDF para todos; aceptar solo quien puede */}
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3">
                        {confirming ? (
                          <>
                            <span className="mr-auto text-xs text-muted-foreground">
                              {hasDifferences(t)
                                ? 'Hay diferencias entre lo enviado y lo recibido: se registraran como faltante o excedente para Operacion. ¿Confirmas la entrada?'
                                : '¿Confirmas que recibiste toda la mercancia?'}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleReceive(t)}
                              disabled={busy}
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Check />
                              )}
                              {busy ? 'Recibiendo...' : 'Sí, aceptar entrada'}
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="mr-auto text-xs text-muted-foreground">
                              Imprime la lista para palomear mientras cuentas; luego
                              captura lo recibido y acepta la entrada.
                            </span>
                            {printButtons(t)}
                            {canReceive && (
                              <Button
                                size="sm"
                                onClick={() => setConfirmingId(t.id)}
                                disabled={receive.isPending || printingKey !== null}
                              >
                                <PackageCheck />
                                Aceptar entrada
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Histórico de movimientos de la sucursal */}
          <div className="border-t px-6 py-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">
                Histórico de movimientos de esta sucursal
              </p>
              {history && history.totalPages > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    disabled={histPage <= 1}
                    onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                  >
                    ◀
                  </Button>
                  <span>
                    {histPage} / {history.totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    disabled={histPage >= history.totalPages}
                    onClick={() => setHistPage((p) => p + 1)}
                  >
                    ▶
                  </Button>
                </div>
              )}
            </div>
            {histLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Cargando histórico...
              </div>
            ) : !history || history.data.length === 0 ? (
              <p className="py-3 text-xs italic text-muted-foreground">
                Sin movimientos de inventario registrados para esta sucursal.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/60">
                    <TableRow>
                      <TableHead className="px-3 py-1.5">Fecha</TableHead>
                      <TableHead className="px-3 py-1.5">Movimiento</TableHead>
                      <TableHead className="px-3 py-1.5">Tipo</TableHead>
                      <TableHead className="px-3 py-1.5">Razón</TableHead>
                      <TableHead className="px-3 py-1.5 text-right">
                        Piezas
                      </TableHead>
                      <TableHead className="px-3 py-1.5 text-right">
                        Estado
                      </TableHead>
                      <TableHead className="px-3 py-1.5 text-right">
                        Lista
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.map((m) => {
                      const meta = MOVEMENT_TYPE_META[m.movementType] ?? {
                        label: m.movementType,
                        className: 'bg-muted text-muted-foreground',
                      };
                      const printable = isTransferMovement(m);
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                            {formatDateTime(m.createdAt)}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 font-mono">
                            {m.movementNumber}
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          </TableCell>
                          <TableCell
                            className="max-w-[360px] px-3 py-1.5"
                            title={[movementReasonLabel(m.reason), m.referenceNumber, m.notes]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            <div className="truncate">{movementReasonLabel(m.reason) || '—'}</div>
                            {(m.referenceNumber || m.notes) && (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {[m.referenceNumber, m.notes].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-right tabular-nums">
                            {m.totalQuantity ?? '—'}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-right">
                            {MOVEMENT_STATUS_LABEL[m.status] ?? m.status}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-right">
                            {printable ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => printHistoryTransfer(m, 'print')}
                                  disabled={printingKey !== null}
                                  title="Reimprimir la lista del traspaso"
                                >
                                  {printingKey === `${m.id}:print` ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Printer className="size-3.5" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => printHistoryTransfer(m, 'pdf')}
                                  disabled={printingKey !== null}
                                  title="Guardar la lista del traspaso en PDF"
                                >
                                  {printingKey === `${m.id}:pdf` ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <FileDown className="size-3.5" />
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t bg-muted/30 px-6 py-3">
          <Button
            variant="outline"
            onClick={close}
            disabled={receive.isPending}
          >
            Cerrar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
