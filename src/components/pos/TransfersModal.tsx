// TransfersModal - Entradas de inventario: traspasos En Tránsito dirigidos a
// esta sucursal. El cajero acepta la entrada (recepción total) y el stock del
// destino se incrementa en el backend (POST /pos/transfers/:id/receive).

import { useState } from 'react';
import {
  X,
  PackageCheck,
  ArrowRight,
  Check,
  Inbox,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIncomingTransfers, useReceiveTransfer } from '@/hooks/usePos';
import { formatDateTime } from '@/lib/date';
import type { IncomingTransfer } from '@/types/pos';

interface TransfersModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
}

export function TransfersModal({
  isOpen,
  onClose,
  branchId,
}: TransfersModalProps) {
  const { data: transfers = [], isLoading } = useIncomingTransfers(
    isOpen ? branchId : undefined,
  );
  const receive = useReceiveTransfer();
  // Confirmación en dos pasos por traspaso (evita aceptar por accidente).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleReceive(t: IncomingTransfer) {
    try {
      await receive.mutateAsync(t.id);
      toast.success(`Entrada aceptada: ${t.movementNumber}`);
      setConfirmingId(null);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message || 'Error al aceptar la entrada',
      );
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !receive.isPending) {
          setConfirmingId(null);
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (receive.isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (receive.isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <PackageCheck className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Entradas de inventario
              </DialogTitle>
              <DialogDescription className="text-xs">
                Traspasos en tránsito hacia esta sucursal
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !receive.isPending && onClose()}
            disabled={receive.isPending}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
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
                Cuando una sucursal o el almacén envíe mercancía aquí, aparecerá
                en esta lista.
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
                    <div className="overflow-hidden">
                      <Table className="text-sm">
                        <TableHeader className="bg-muted/60">
                          <TableRow>
                            <TableHead className="px-4 py-1.5 text-left font-medium text-muted-foreground">
                              Producto
                            </TableHead>
                            <TableHead className="px-4 py-1.5 text-right font-medium text-muted-foreground">
                              Cantidad
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {t.items.map((it) => (
                            <TableRow key={it.id}>
                              <TableCell className="px-4 py-1.5">
                                <div className="text-foreground">
                                  {it.productName}
                                </div>
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {it.productCode}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-1.5 text-right tabular-nums">
                                {it.quantity}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Acción */}
                    <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3">
                      {confirming ? (
                        <>
                          <span className="mr-auto text-xs text-muted-foreground">
                            ¿Confirmas que recibiste toda la mercancía?
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
                        <Button
                          size="sm"
                          onClick={() => setConfirmingId(t.id)}
                          disabled={receive.isPending}
                        >
                          <PackageCheck />
                          Aceptar entrada
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={receive.isPending}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
