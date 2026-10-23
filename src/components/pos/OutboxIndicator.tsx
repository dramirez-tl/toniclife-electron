// OutboxIndicator - "N ventas por sincronizar" en el encabezado del POS.
//
// Invisible mientras la cola local está vacía. Con registros muestra una
// píldora (ámbar: esperando al servidor; roja: alguna requiere atención) que
// abre la lista: hora, cliente, total, estado y acciones (sincronizar ahora,
// reimprimir el ticket provisional, reintentar o descartar una venta que el
// servidor rechazó). Descartar pide confirmación: significa que esa venta no
// existirá en el sistema.

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSalesOutboxStore, type QueuedSale } from '@/stores/sales-outbox.store';
import { syncNow } from '@/lib/outboxSync';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function stageLabel(q: QueuedSale): string {
  if (q.needsAttention) return 'Requiere atención';
  if (q.stage === 'pay') return 'Creada en el servidor; falta registrar el cobro';
  return 'Esperando conexión para enviarla';
}

export function OutboxIndicator() {
  const items = useSalesOutboxStore((s) => s.items);
  const syncing = useSalesOutboxStore((s) => s.syncing);
  const patch = useSalesOutboxStore((s) => s.patch);
  const remove = useSalesOutboxStore((s) => s.remove);
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const attention = items.filter((i) => i.needsAttention).length;
  const pill = attention > 0 ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-950';

  const reprint = async (q: QueuedSale) => {
    const r = await window.toniclife.printer.printSale(q.receipt, false);
    if (!r.ok) toast.error('No se pudo reimprimir el ticket', { description: r.error });
  };

  const discard = (q: QueuedSale) => {
    const ok = window.confirm(
      `¿Descartar la venta ${q.provisionalNumber} (${q.customerLabel ?? 'sin cliente'}, $${q.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })})?\n\nNo se registrará en el sistema. Solo hazlo si ya la capturaste de otra forma.`,
    );
    if (ok) remove(q.id);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm transition-opacity hover:opacity-90 ${pill}`}
        title="Ventas guardadas en esta terminal que aún no llegan al servidor"
      >
        {syncing ? '⟳ ' : ''}
        {items.length} por sincronizar
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ventas por sincronizar ({items.length})</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se guardaron en esta terminal porque no hubo conexión con el servidor al
            cobrar. Se envían solas cada 30 s y al recuperar la red; no se cobran
            dos veces. Si una queda en rojo, el servidor la rechazó: léelo y decide.
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {items.map((q) => (
              <div
                key={q.id}
                className={`rounded-lg border p-3 text-sm ${q.needsAttention ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50/60'}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {q.provisionalNumber}
                    {q.saleNumber ? ` → ${q.saleNumber}` : ''}
                  </span>
                  <span className="tabular-nums">
                    ${q.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {timeLabel(q.soldAt)} · {q.customerLabel ?? 'Sin cliente'} ·{' '}
                  {q.payments.map((p) => p.paymentMethod).join(' + ') || 'sin pago'}
                </div>
                <div className={q.needsAttention ? 'font-medium text-red-700' : ''}>
                  {stageLabel(q)}
                  {q.attempts > 0 ? ` · ${q.attempts} intento(s)` : ''}
                </div>
                {q.lastError && (
                  <div className="mt-1 text-xs text-muted-foreground">{q.lastError}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-xs hover:bg-white"
                    onClick={() => void reprint(q)}
                  >
                    Reimprimir ticket
                  </button>
                  {q.needsAttention && (
                    <>
                      <button
                        type="button"
                        className="rounded-md border px-2 py-1 text-xs hover:bg-white"
                        onClick={() => {
                          patch(q.id, { needsAttention: false, lastError: null });
                          syncNow();
                        }}
                      >
                        Reintentar
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-white"
                        onClick={() => discard(q)}
                      >
                        Descartar
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={syncing}
              onClick={() => syncNow()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
