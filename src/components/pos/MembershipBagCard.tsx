// MembershipBagCard - "Bolsa" de membresía dentro del carrito: la campaña que
// el cajero eligió desde el catálogo (por código) y lo que falta para poder
// cobrarla (distribuidor, que le aplique, puntos en producto). Mientras no se
// cumpla, el botón Cobrar queda bloqueado (o se quita la bolsa). El servidor
// vuelve a validar todo al crear la venta.

import { ShoppingBag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { describeOfferBenefits } from '@/lib/membership';
import type { MembershipBag } from '@/hooks/useMembership';

const fmt = (n: number) =>
  n.toLocaleString('es-MX', { maximumFractionDigits: 0 });

const TONE_CLASS: Record<MembershipBag['tone'], string> = {
  ok: 'text-emerald-800',
  info: 'text-sky-800',
  warn: 'text-amber-800',
  error: 'text-red-700',
};

export function MembershipBagCard({ bag }: { bag: MembershipBag }) {
  if (!bag.selectedId) return null;
  const offer = bag.offer;

  return (
    <div
      className={cn(
        'm-3 rounded-lg border p-3',
        bag.ready
          ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50'
          : 'border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50',
      )}
      data-tour="pos-membership-bag"
    >
      <div className="flex items-start gap-2">
        {offer?.imageUrl ? (
          <img
            src={offer.imageUrl}
            alt={offer.name}
            className="size-12 shrink-0 rounded-md border bg-white object-contain p-0.5"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-white text-emerald-700">
            <ShoppingBag className="size-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
              Bolsa de membresía
            </span>
            {offer && (
              <span className="font-mono text-xs font-bold text-emerald-700">
                {offer.code}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium text-foreground">
            {offer?.name ?? 'Campaña de membresía'}
          </p>
          {offer && (
            <>
              <div className="mt-1 flex items-center gap-2">
                <Progress
                  value={bag.pct}
                  className={cn(
                    'h-2 flex-1 bg-white/80',
                    bag.ready && '[&>[data-slot=progress-indicator]]:bg-emerald-500',
                  )}
                />
                <span
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  title="Solo cuentan los puntos de producto: no los kits, promociones canjeables ni boletos de evento"
                >
                  {fmt(bag.points)} de {fmt(offer.minPoints)} pts
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Incluye:</span>{' '}
                {describeOfferBenefits(offer)}
              </p>
            </>
          )}
          <p className={cn('mt-1 text-[11px] font-medium', TONE_CLASS[bag.tone])}>
            {bag.message}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={bag.remove}
          className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
          title="Quitar la bolsa de membresía (la venta se cobra sin la campaña)"
          aria-label="Quitar la bolsa de membresía"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
