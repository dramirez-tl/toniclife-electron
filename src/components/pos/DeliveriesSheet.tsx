// DeliveriesSheet — Estatus de las entregas a domicilio. En modo staff
// (Call Center) arranca con "Mis entregas" (las que capturó la persona);
// también se pueden ver todas las que surte la sucursal. Se refresca solo
// cada minuto mientras está abierto. Clic en el folio abre la venta.
// Las entregas que comparten clave de envío (pedido consolidado, mig 162)
// se muestran como una sola tarjeta con todas sus ventas.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Truck, RefreshCw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';
import {
  DELIVERY_STATUS_LABELS,
  type PosDelivery,
  type PosDeliveryStatus,
} from '@/types/deliveries';

const STATUS_CLASS: Record<PosDeliveryStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  shipped: 'bg-violet-100 text-violet-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-muted text-muted-foreground',
};

type Scope = 'mine' | 'branch';
type Filter = 'open' | 'all';

interface DeliveriesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
  branchTz?: string;
  /** true en modo staff: habilita "Mis entregas". */
  staffMode: boolean;
  onSelectSale: (saleId: string) => void;
}

export function DeliveriesSheet({
  isOpen,
  onClose,
  branchId,
  branchName,
  branchTz,
  staffMode,
  onSelectSale,
}: DeliveriesSheetProps) {
  const [scope, setScope] = useState<Scope>(staffMode ? 'mine' : 'branch');
  const [filter, setFilter] = useState<Filter>('open');
  const effectiveScope: Scope = staffMode ? scope : 'branch';

  const query = useQuery({
    queryKey: ['pos-deliveries', effectiveScope, filter, branchId],
    queryFn: () =>
      posApi.getDeliveries({
        ...(effectiveScope === 'mine' ? { mine: true } : { branchId }),
        ...(filter === 'open' ? { status: 'pending,ready,shipped' } : {}),
        // Capturadas por mí: últimos 60 días (sin fechas el API muestra solo
        // hoy + abiertas); de la sucursal: lo que el API da por defecto.
        ...(effectiveScope === 'mine' ? { fromDate: daysAgoIso(60) } : {}),
        limit: 200,
      }),
    enabled: isOpen,
    refetchInterval: isOpen ? 60_000 : false,
  });
  const rows = query.data?.data ?? [];
  // Un envío consolidado = una tarjeta con todas sus ventas (mismo orden
  // en que el API entrega la primera de ellas).
  const groups = useMemo(() => {
    const byKey = new Map<string, PosDelivery[]>();
    for (const d of rows) {
      const key = d.shipmentKey ?? d.id;
      const list = byKey.get(key);
      if (list) list.push(d);
      else byKey.set(key, [d]);
    }
    return Array.from(byKey.values());
  }, [rows]);

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-3xl">
        <SheetHeader className="px-6 pb-1 pt-6">
          <SheetTitle className="flex items-center gap-2">
            <Truck className="size-5" />
            Entregas a domicilio
          </SheetTitle>
          <SheetDescription>
            {effectiveScope === 'mine'
              ? 'Pedidos a domicilio que capturaste (últimos 60 días) y en qué va cada uno.'
              : `Pedidos a domicilio que surte ${branchName}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-1">
          {staffMode && (
            <div className="inline-flex rounded-md border p-0.5">
              <button
                type="button"
                onClick={() => setScope('mine')}
                className={`rounded px-2 py-1 text-xs ${scope === 'mine' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                Mis entregas
              </button>
              <button
                type="button"
                onClick={() => setScope('branch')}
                className={`rounded px-2 py-1 text-xs ${scope === 'branch' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                Todas (sucursal)
              </button>
            </div>
          )}
          <div className="inline-flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setFilter('open')}
              className={`rounded px-2 py-1 text-xs ${filter === 'open' ? 'bg-primary text-primary-foreground' : ''}`}
            >
              En proceso
            </button>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded px-2 py-1 text-xs ${filter === 'all' ? 'bg-primary text-primary-foreground' : ''}`}
            >
              Todas
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 text-xs"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-6 pb-6">
          {query.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando entregas…
            </div>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              No se pudieron cargar las entregas.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {filter === 'open'
                ? 'No hay entregas en proceso.'
                : 'No hay entregas registradas.'}
            </p>
          ) : (
            groups.map((members) =>
              members.length > 1 || (members[0].shipmentSize ?? 1) > 1 ? (
                <ShipmentRow
                  key={members[0].shipmentKey ?? members[0].id}
                  members={members}
                  branchTz={branchTz}
                  onSelectSale={onSelectSale}
                />
              ) : (
                <DeliveryRow
                  key={members[0].id}
                  d={members[0]}
                  branchTz={branchTz}
                  onSelectSale={onSelectSale}
                />
              ),
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeliveryRow({
  d,
  branchTz,
  onSelectSale,
}: {
  d: PosDelivery;
  branchTz?: string;
  onSelectSale: (saleId: string) => void;
}) {
  const lastStep =
    d.status === 'delivered'
      ? `Entregado ${formatDateTime(d.deliveredAt ?? d.requestedAt, branchTz)}`
      : d.status === 'shipped'
        ? `Enviado ${formatDateTime(d.shippedAt ?? d.requestedAt, branchTz)}`
        : d.status === 'ready'
          ? `Listo ${formatDateTime(d.readyAt ?? d.requestedAt, branchTz)}`
          : d.status === 'cancelled'
            ? `Cancelado${d.cancelReason ? `: ${d.cancelReason}` : ''}`
            : `Capturado ${formatDateTime(d.requestedAt, branchTz)}`;
  return (
    <div className="rounded-lg border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="font-mono text-sm font-semibold text-primary hover:underline"
          onClick={() => onSelectSale(d.saleId)}
        >
          {d.saleNumber}
        </button>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[d.status] ?? ''}`}
        >
          {DELIVERY_STATUS_LABELS[d.status] ?? d.statusLabel}
        </span>
        {d.saleStatus !== 'completed' && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
            Venta {d.saleStatus === 'pending' ? 'sin cobrar' : d.saleStatus}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {d.itemsUnits} pza(s) · surte {d.fulfillBranchCode}
        </span>
      </div>
      <p className="mt-1">
        <span className="font-medium">
          {d.customerNumber ? `#${d.customerNumber} ` : ''}
          {d.customerName ?? d.recipientName}
        </span>
        <span className="text-muted-foreground">
          {' '}· recibe {d.recipientName}
          {d.recipientPhone ? ` · ${d.recipientPhone}` : ''}
        </span>
      </p>
      <p className="text-muted-foreground">{d.addressText}</p>
      {(d.carrier || d.trackingNumber) && (
        <p className="mt-1 font-medium text-violet-800">
          {d.carrier ?? 'Paquetería'}
          {d.trackingNumber ? ` · guía ${d.trackingNumber}` : ''}
        </p>
      )}
      {d.warehouseNotes && (
        <p className="mt-1 text-muted-foreground">Almacén: {d.warehouseNotes}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {lastStep} · capturó {d.requestedByName}
      </p>
    </div>
  );
}

/** Tarjeta de un envío consolidado: un paquete, varias ventas. */
function ShipmentRow({
  members,
  branchTz,
  onSelectSale,
}: {
  members: PosDelivery[];
  branchTz?: string;
  onSelectSale: (saleId: string) => void;
}) {
  const head = members[0];
  const total = head.shipmentSize ?? members.length;
  const units = members.reduce((acc, m) => acc + (m.itemsUnits ?? 0), 0);
  const lastStep =
    head.status === 'delivered'
      ? `Entregado ${formatDateTime(head.deliveredAt ?? head.requestedAt, branchTz)}`
      : head.status === 'shipped'
        ? `Enviado ${formatDateTime(head.shippedAt ?? head.requestedAt, branchTz)}`
        : head.status === 'ready'
          ? `Listo ${formatDateTime(head.readyAt ?? head.requestedAt, branchTz)}`
          : head.status === 'cancelled'
            ? `Cancelado${head.cancelReason ? `: ${head.cancelReason}` : ''}`
            : `Capturado ${formatDateTime(head.requestedAt, branchTz)}`;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          <Package className="size-3" />
          Envío consolidado · {total} venta(s)
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[head.status] ?? ''}`}
        >
          {DELIVERY_STATUS_LABELS[head.status] ?? head.statusLabel}
        </span>
        <span className="ml-auto text-muted-foreground">
          {units} pza(s)
          {members.length < total ? ` (${members.length} de ${total} ventas en esta lista)` : ''}
          {' '}· surte {head.fulfillBranchCode}
        </span>
      </div>
      <p className="mt-1">
        <span className="font-medium">recibe {head.recipientName}</span>
        <span className="text-muted-foreground">
          {head.recipientPhone ? ` · ${head.recipientPhone}` : ''}
        </span>
      </p>
      <p className="text-muted-foreground">{head.addressText}</p>
      <ul className="mt-1.5 space-y-0.5">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="font-mono font-semibold text-primary hover:underline"
              onClick={() => onSelectSale(m.saleId)}
            >
              {m.saleNumber}
            </button>
            <span>
              {m.customerNumber ? `#${m.customerNumber} ` : ''}
              {m.customerName ?? m.recipientName}
            </span>
            <span className="text-muted-foreground">· {m.itemsUnits} pza(s)</span>
            {m.saleStatus !== 'completed' && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                Venta {m.saleStatus === 'pending' ? 'sin cobrar' : m.saleStatus}
              </span>
            )}
          </li>
        ))}
      </ul>
      {(head.carrier || head.trackingNumber) && (
        <p className="mt-1 font-medium text-violet-800">
          {head.carrier ?? 'Paquetería'}
          {head.trackingNumber ? ` · guía ${head.trackingNumber}` : ''}
        </p>
      )}
      {head.warehouseNotes && (
        <p className="mt-1 text-muted-foreground">Almacén: {head.warehouseNotes}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {lastStep} · capturó {head.requestedByName}
      </p>
    </div>
  );
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
