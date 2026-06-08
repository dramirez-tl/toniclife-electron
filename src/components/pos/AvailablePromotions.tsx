// AvailablePromotions - Banner horizontal arriba del catalogo que muestra
// las promociones canjeables HOY por el distribuidor seleccionado, segun
// los puntos personales acumulados en el periodo abierto.
//
// Aparece automaticamente cuando:
//   - Hay un distribuidor seleccionado (cart.customerId).
//   - El backend retorna una o mas promos donde el distribuidor ya alcanzo
//     el umbral de puntos (filtrado por la sucursal -> pais).
//
// Al hacer clic en una promo, se agrega al carrito como item con precio 0
// y puntos 0. El backend revalida elegibilidad al cobrar.

import { Sparkles, PlusCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAvailablePromotionsForCustomer } from '@/hooks/usePromotions';
import { usePosCartStore } from '@/stores/pos-cart.store';
import type { QuickProduct } from '@/types/pos';
import type { AvailablePromotionForCustomer } from '@/lib/promotionsApi';

interface AvailablePromotionsProps {
  customerId: string;
  branchId: string;
}

const fmt = (n: number) =>
  n.toLocaleString('es-MX', { maximumFractionDigits: 0 });

/** Etiqueta de vencimiento del derecho ganado + si es urgente (≤ 14 días). */
function expiryInfo(
  expiresAt?: string,
): { label: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  const days = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return { label: 'Vence hoy', urgent: true };
  if (days === 1) return { label: 'Vence mañana', urgent: true };
  if (days <= 14) return { label: `Vence en ${days} días`, urgent: true };
  const d = exp.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return { label: `Vence ${d}`, urgent: false };
}

export function AvailablePromotions({
  customerId,
  branchId,
}: AvailablePromotionsProps) {
  const { data: promos, isLoading } = useAvailablePromotionsForCustomer(
    customerId,
    branchId,
  );
  const addItem = usePosCartStore((s) => s.addItem);
  const cartItems = usePosCartStore((s) => s.cart.items);

  if (isLoading) return null;
  if (!promos || promos.length === 0) return null;

  function handleAdd(promo: AvailablePromotionForCustomer) {
    const alreadyInCart = cartItems.some(
      (it) => it.productId === promo.productId,
    );
    if (alreadyInCart) {
      toast.info(`${promo.code} ya esta en el carrito`);
      return;
    }

    const item: QuickProduct = {
      id: promo.productId,
      sku: promo.code,
      name: promo.name,
      slug: promo.code.toLowerCase(),
      basePrice: 0,
      points: 0,
      businessVolume: 0,
      taxRate: 0,
      isIncludedInPrice: false,
      isActive: true,
      productType: 'promotional',
      // Sin tope de stock: la promo descuenta componentes, no a si misma.
      stock: undefined,
    };

    addItem(item, 1);
    toast.success(`${promo.code} agregada — canje al cobrar`);
  }

  return (
    <div className="border-b bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-4 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="size-4 text-amber-600" />
        <span className="text-sm font-semibold text-amber-800">
          Promociones canjeables
        </span>
        <span className="text-xs text-amber-700/70">
          ({promos.length}) · {fmt(promos[0].currentPoints)} pts acumulados
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {promos.map((promo) => (
          <Button
            key={promo.productId}
            type="button"
            variant="outline"
            onClick={() => handleAdd(promo)}
            className={cn(
              'group flex h-auto shrink-0 items-center justify-start gap-3 whitespace-normal rounded-lg border border-amber-200 bg-white px-3 py-2 text-left transition-all hover:border-amber-400 hover:bg-white hover:shadow-md min-w-[240px]',
            )}
          >
            <div className="min-w-0 flex-grow">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-amber-700">
                  {promo.code}
                </span>
                {(promo.availableCount ?? 1) > 1 && (
                  <Badge className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    x{promo.availableCount}
                  </Badge>
                )}
                {promo.consumesPoints && (
                  <Badge
                    variant="destructive"
                    className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                  >
                    Descuenta {fmt(promo.minPointsRequired)} pts
                  </Badge>
                )}
              </div>
              <p className="truncate text-sm font-medium text-foreground">
                {promo.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Requiere {fmt(promo.minPointsRequired)} pts
              </p>
              {(() => {
                const e = expiryInfo(promo.expiresAt);
                return e ? (
                  <p
                    className={cn(
                      'mt-0.5 flex items-center gap-1 text-[11px]',
                      e.urgent
                        ? 'font-medium text-red-600'
                        : 'text-muted-foreground',
                    )}
                  >
                    <Clock className="size-3 shrink-0" />
                    {e.label}
                  </p>
                ) : null;
              })()}
            </div>
            <PlusCircle className="size-6 shrink-0 text-amber-600 group-hover:text-amber-700" />
          </Button>
        ))}
      </div>
    </div>
  );
}
