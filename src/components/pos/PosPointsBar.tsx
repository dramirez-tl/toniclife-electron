// PosPointsBar - Progreso de puntos del distribuidor hacia la calificacion
// del periodo (3,300 pts). Portado de toniclife-next PosPointsBar.
//
// Pedido de sucursales (ago-2026): los distribuidores preguntan en mostrador
// "¿cuánto me falta para los 4,000 / 6,600?" (umbrales de las PROMOS) y el
// cajero sumaba mentalmente. La barra ahora muestra la SUMA proyectada
// (acumulado + carrito = total) y cuánto falta para la siguiente promo
// vigente del país de la sucursal; si el carrito cruza un umbral, lo avisa.

import { Award, Gift, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useCustomerPeriodStats } from '@/hooks/usePos';
import {
  useCurrentPromotions,
  useReachablePromotionsForCustomer,
} from '@/hooks/usePromotions';
import { usePosCartStore } from '@/stores/pos-cart.store';
import { reachablePromoToQuickProduct } from '@/lib/promoCart';

interface PosPointsBarProps {
  customerId: string;
  /** Puntos que aportaria la venta actual del carrito. */
  cartPoints: number;
  /** Sucursal efectiva (para los umbrales de promos vigentes del país). */
  branchId?: string;
}

export function PosPointsBar({
  customerId,
  cartPoints,
  branchId,
}: PosPointsBarProps) {
  const { data: stats, isLoading } = useCustomerPeriodStats(customerId);
  const { data: currentPromos = [] } = useCurrentPromotions(branchId);
  // Canje en la misma compra (27-oct-2026): promos que alcanza con este
  // carrito, con botón para agregarlas aquí mismo (también están arriba).
  const { data: reachable = [] } = useReachablePromotionsForCustomer(
    customerId,
    branchId,
    cartPoints,
  );
  const addItem = usePosCartStore((s) => s.addItem);
  const cartItems = usePosCartStore((s) => s.cart.items);

  if (isLoading || !stats) {
    return (
      <div className="px-4 py-2 border-b text-[11px] text-muted-foreground">
        Cargando puntos del periodo...
      </div>
    );
  }

  const threshold = stats.qualificationThreshold || 3300;
  const current = stats.personalPoints;
  const projected = current + cartPoints;
  const alreadyQualified = current >= threshold;
  const willQualify = !alreadyQualified && projected >= threshold;
  const pct = Math.min(100, (projected / threshold) * 100);
  const deficit = Math.max(0, threshold - projected);

  // Umbrales de las promos vigentes del país (ej. 4,000 / 6,600): el
  // mostrador responde "¿cuánto me falta?" sin sumar a mano.
  const promoThresholds = [
    ...new Set(
      currentPromos
        .map((p) => Number(p.minPointsRequired))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
  const crossedPromo = promoThresholds.filter(
    (t) => current < t && projected >= t,
  );
  const nextPromo = promoThresholds.find((t) => t > projected);

  return (
    <div className="px-4 py-2.5 border-b">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Award className="size-3.5" />
          Puntos del periodo
        </span>
        {alreadyQualified ? (
          <span className="font-medium text-emerald-600">Calificado</span>
        ) : willQualify ? (
          <span className="font-medium text-primary">
            ¡Califica con esta venta!
          </span>
        ) : (
          <span className="text-muted-foreground">
            Faltan {deficit.toFixed(0)} pts
          </span>
        )}
      </div>

      <Progress
        value={pct}
        className={cn(
          'h-2 rounded-full bg-muted',
          (alreadyQualified || willQualify) &&
            '[&>[data-slot=progress-indicator]]:bg-emerald-500',
        )}
      />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
        <span className="tabular-nums">
          {current.toFixed(0)}
          {cartPoints > 0 && (
            <>
              <span className="text-primary">
                {' '}
                + {cartPoints.toFixed(0)}
              </span>
              {' = '}
              <span className="font-semibold text-foreground">
                {projected.toFixed(0)}
              </span>
              <TrendingUp className="inline size-3 ml-0.5 text-primary" />
            </>
          )}
        </span>
        <span className="tabular-nums">meta {threshold.toLocaleString()}</span>
      </div>

      {/* Umbrales de promos: aviso al cruzar + cuánto falta para la siguiente */}
      {(crossedPromo.length > 0 || nextPromo != null) && (
        <div className="flex items-center justify-between gap-2 text-[11px] mt-1">
          {crossedPromo.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1 font-medium text-emerald-600">
              <Gift className="size-3" />
              {reachable.length > 0 ? (
                <>
                  ¡Con esta venta alcanza{' '}
                  {reachable.map((r) => r.code).join(', ')}!
                  {reachable.map((r) => {
                    const inCart = cartItems.some((it) => it.productId === r.productId);
                    return (
                      <button
                        key={r.productId}
                        type="button"
                        disabled={inCart}
                        onClick={() => {
                          addItem(reachablePromoToQuickProduct(r), 1);
                          toast.success(`${r.code} agregada: se canjea en esta misma compra al cobrar`);
                        }}
                        className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                        title={inCart ? 'Ya está en el carrito' : `Agregar ${r.code} y canjearla en esta compra`}
                      >
                        {inCart ? `${r.code} en el carrito` : `Agregar ${r.code}`}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
                  ¡Con esta venta llega a{' '}
                  {Math.max(...crossedPromo).toLocaleString()} pts (promo)!
                </>
              )}
            </span>
          ) : (
            <span />
          )}
          {nextPromo != null && (
            <span className="tabular-nums text-muted-foreground">
              Promo {nextPromo.toLocaleString()}: faltan{' '}
              {(nextPromo - projected).toFixed(0)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
