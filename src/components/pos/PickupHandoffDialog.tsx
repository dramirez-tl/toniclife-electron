// PickupHandoffDialog - Entrega de un pedido en línea al cliente: se anota
// quién lo recoge, se confirma su identidad y, ya entregado, se ofrece el
// comprobante de entrega para que lo firme de recibido. Se abre encima de
// PickupOrdersSheet.

import { useState } from 'react';
import {
  Check,
  CircleCheck,
  FileDown,
  Info,
  Loader2,
  PackageCheck,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  RECEIVED_BY_MAX_LENGTH,
  defaultReceivedBy,
  handoffBlockedReason,
  pickupBuyerLabel,
  unitsLabel,
  type PickupPrintVia,
  type PickupReceiptMode,
} from '@/lib/pickupOrders';
import type { PickupOrderDetail } from '@/types/pickupOrders';

/** Paso del diálogo: primero se captura quién recoge ('form') y, ya
 *  entregado, se ofrece el comprobante ('done'). null = cerrado. */
export type PickupHandoffState = {
  step: 'form' | 'done';
  order: PickupOrderDetail;
} | null;

export function PickupHandoffDialog({
  state,
  stockHold,
  busy,
  printingKey,
  money,
  onClose,
  onConfirm,
  onPrint,
}: {
  state: PickupHandoffState;
  stockHold: boolean;
  busy: boolean;
  printingKey: string | null;
  money: (n: number) => string;
  onClose: () => void;
  onConfirm: (order: PickupOrderDetail, receivedByName: string, notes: string) => void;
  onPrint: (order: PickupOrderDetail, mode: PickupReceiptMode, via: PickupPrintVia) => Promise<boolean>;
}) {
  // Al cerrar, el diálogo sigue pintado un instante (animación de salida):
  // se conserva lo último mostrado para que no se vea vacío.
  const [lastShown, setLastShown] = useState(state);
  if (state && state !== lastShown) setLastShown(state);
  const view = state ?? lastShown;
  const order = view?.order;
  const printing = printingKey !== null;
  return (
    <Dialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {/* z-[70] (fondo y contenido): se abre encima de la hoja de pedidos. */}
      <DialogContent
        className="z-[70] sm:max-w-lg"
        overlayClassName="z-[70]"
        showCloseButton={!busy}
      >
        {order && view?.step === 'form' && (
          <HandoffForm
            // Cada pedido arranca con su propio formulario.
            key={order.id}
            order={order}
            stockHold={stockHold}
            busy={busy}
            money={money}
            onCancel={onClose}
            onConfirm={onConfirm}
          />
        )}
        {order && view?.step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="size-5 text-emerald-600" />
                Pedido {order.orderNumber} entregado
              </DialogTitle>
              <DialogDescription>
                Lo recogió {order.receivedByName ?? 'el cliente'}. Si quieres,
                imprime el comprobante para que lo firme de recibido.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={printing}>
                Cerrar
              </Button>
              <Button
                variant="outline"
                disabled={printing}
                onClick={async () => {
                  if (await onPrint(order, 'handoff', 'pdf')) onClose();
                }}
                title="Guarda el comprobante en PDF (Documentos\Tonic Life\Tickets)"
              >
                {printingKey === `${order.id}:handoff:pdf` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileDown />
                )}
                PDF
              </Button>
              <Button
                disabled={printing}
                onClick={async () => {
                  if (await onPrint(order, 'handoff', 'print')) onClose();
                }}
              >
                {printingKey === `${order.id}:handoff:print` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Printer />
                )}
                Imprimir comprobante de entrega
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HandoffForm({
  order,
  stockHold,
  busy,
  money,
  onCancel,
  onConfirm,
}: {
  order: PickupOrderDetail;
  stockHold: boolean;
  busy: boolean;
  money: (n: number) => string;
  onCancel: () => void;
  onConfirm: (order: PickupOrderDetail, receivedByName: string, notes: string) => void;
}) {
  const [receivedByName, setReceivedByName] = useState(() => defaultReceivedBy(order));
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const blocked = handoffBlockedReason(receivedByName, identityConfirmed);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && !busy) onConfirm(order, receivedByName, notes);
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PackageCheck className="size-5" />
          Entregar pedido {order.orderNumber}
        </DialogTitle>
        <DialogDescription>
          {[
            pickupBuyerLabel(order),
            unitsLabel(order.itemsUnits),
            money(order.saleTotal),
          ]
            .filter(Boolean)
            .join(' · ')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label htmlFor="pickup-received-by">¿Quién recoge? *</Label>
          <Input
            id="pickup-received-by"
            className="mt-1"
            value={receivedByName}
            onChange={(e) => setReceivedByName(e.target.value)}
            maxLength={RECEIVED_BY_MAX_LENGTH}
            placeholder="Nombre completo de quien recoge"
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-md bg-muted/40 p-3 text-sm">
          <Checkbox
            checked={identityConfirmed}
            onCheckedChange={(v) => setIdentityConfirmed(v === true)}
            className="mt-0.5"
            disabled={busy}
          />
          <span>
            Confirmé su identidad (identificación o número de distribuidor)
          </span>
        </label>

        <div>
          <Label htmlFor="pickup-handoff-notes">Nota (opcional)</Label>
          <Textarea
            id="pickup-handoff-notes"
            className="mt-1"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Por ejemplo: lo recogió su esposa con identificación."
            disabled={busy}
          />
        </div>

        {stockHold && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Al entregar, las piezas salen de las existencias de la sucursal.
          </p>
        )}
      </div>

      <DialogFooter className="sm:items-center">
        {blocked && (
          <span className="text-xs text-muted-foreground sm:mr-auto">{blocked}</span>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!!blocked || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check />}
          {busy ? 'Entregando…' : 'Confirmar entrega'}
        </Button>
      </DialogFooter>
    </form>
  );
}
