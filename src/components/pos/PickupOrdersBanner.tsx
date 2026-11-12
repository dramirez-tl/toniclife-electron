// PickupOrdersBanner - Franja de una línea, debajo del encabezado del POS, que
// avisa que hay pedidos en línea para recoger en la sucursal. Ámbar cuando
// hay pedidos por surtir (no se puede cerrar: hay trabajo pendiente). Azul
// claro cuando solo hay pedidos listos esperando a que pasen por ellos o en
// elaboración (nada que hacer todavía): esa sí se puede cerrar y vuelve a
// salir cuando hay uno más.

import { useEffect, useState } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pickupBannerText, type PickupSummary } from '@/lib/pickupOrders';

interface PickupOrdersBannerProps {
  summary: PickupSummary;
  /** Abre la hoja de pedidos. */
  onView: () => void;
}

export function PickupOrdersBanner({ summary, onView }: PickupOrdersBannerProps) {
  // Pedidos que no piden acción inmediata: listos + en elaboración.
  const calm = summary.ready + summary.inProduction;
  // Cuántos había cuando se cerró la franja (null = no se ha cerrado).
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Al entregar pedidos baja el tope: así, cuando otro quede listo, la franja
  // vuelve a salir aunque el total no rebase el que había al cerrarla.
  useEffect(() => {
    if (dismissedAt !== null && calm < dismissedAt) setDismissedAt(calm);
  }, [calm, dismissedAt]);

  const text = pickupBannerText(summary);
  if (!text) return null;
  const urgent = summary.toPrepare > 0;
  if (!urgent && dismissedAt !== null && calm <= dismissedAt) return null;

  return (
    <div
      role="status"
      className={`flex h-9 shrink-0 items-center gap-3 border-b px-5 text-sm ${
        urgent
          ? 'border-amber-400 bg-amber-300 text-amber-950'
          : 'border-sky-200 bg-sky-100 text-sky-950'
      }`}
    >
      <ShoppingBag className="size-4 shrink-0" />
      <span className="min-w-0 truncate font-medium" title={text}>
        {text}
      </span>
      <Button
        size="sm"
        onClick={onView}
        className={`h-7 shrink-0 px-3 text-xs ${
          urgent
            ? 'bg-amber-950 text-amber-50 hover:bg-amber-900'
            : 'bg-sky-800 text-white hover:bg-sky-700'
        }`}
      >
        Ver pedidos
      </Button>
      {!urgent && (
        <button
          type="button"
          onClick={() => setDismissedAt(calm)}
          className="ml-auto shrink-0 rounded p-1 text-sky-900/70 hover:bg-sky-200 hover:text-sky-950"
          title="Cerrar este aviso (vuelve a salir cuando haya otro pedido)"
          aria-label="Cerrar aviso"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
