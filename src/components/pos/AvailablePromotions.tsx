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

import { Sparkles, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
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
          <button
            key={promo.productId}
            type="button"
            onClick={() => handleAdd(promo)}
            className="group flex shrink-0 items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left transition-all hover:border-amber-400 hover:shadow-md min-w-[240px]"
          >
            <div className="min-w-0 flex-grow">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-amber-700">
                  {promo.code}
                </span>
                {promo.consumesPoints && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                    Descuenta {fmt(promo.minPointsRequired)} pts
                  </span>
                )}
              </div>
              <p className="truncate text-sm font-medium text-foreground">
                {promo.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Requiere {fmt(promo.minPointsRequired)} pts
              </p>
            </div>
            <PlusCircle className="size-6 shrink-0 text-amber-600 group-hover:text-amber-700" />
          </button>
        ))}
      </div>
    </div>
  );
}
