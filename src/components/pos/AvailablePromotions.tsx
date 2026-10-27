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

import { useEffect } from 'react';
import { Sparkles, PlusCircle, Clock, MapPin, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  useAvailablePromotionsForCustomer,
  useReachablePromotionsForCustomer,
  useRedeemedPromotionsForCustomer,
} from '@/hooks/usePromotions';
import { useCustomerPeriodStats } from '@/hooks/usePos';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  reachablePromoToQuickProduct,
  unreachablePromoItems,
} from '@/lib/promoCart';
import type { QuickProduct } from '@/types/pos';
import type {
  AvailablePromotionForCustomer,
  ReachablePromotion,
} from '@/lib/promotionsApi';

interface AvailablePromotionsProps {
  customerId: string;
  branchId: string;
  /** Puntos que generaría el carrito (sin promos): con ellos se consultan las
   *  promos que el distribuidor ALCANZA con esta compra. */
  cartPoints: number;
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
  cartPoints,
}: AvailablePromotionsProps) {
  const { data: promos, isLoading } = useAvailablePromotionsForCustomer(
    customerId,
    branchId,
  );
  // Canjes RECIENTES con dónde se cobraron: cuando el distribuidor pide una
  // promo que "no aparece", el cajero puede responder "ya se cobró en X".
  const { data: redeemed = [] } = useRedeemedPromotionsForCustomer(
    customerId,
    branchId,
  );
  // Canje en la misma compra (27-oct-2026): promos que ALCANZA con los puntos
  // del carrito. Se ofrecen con un clic; el derecho nace y se canjea al cobrar.
  const { data: reachableData } = useReachablePromotionsForCustomer(
    customerId,
    branchId,
    cartPoints,
  );
  const { data: stats } = useCustomerPeriodStats(customerId);
  const addItem = usePosCartStore((s) => s.addItem);
  const removeItem = usePosCartStore((s) => s.removeItem);
  const cartItems = usePosCartStore((s) => s.cart.items);

  // Si el cajero quita producto y el carrito deja de alcanzar la promo "de
  // esta compra", se retira sola (el servidor la rechazaría al cobrar).
  const currentPoints = stats?.personalPoints;
  useEffect(() => {
    if (currentPoints == null) return;
    const gone = unreachablePromoItems(cartItems, currentPoints, cartPoints);
    for (const g of gone) {
      removeItem(g.productId);
      toast.warning(
        `${g.productSku} se quitó del carrito: ya no alcanza los ${fmt(g.promoMinPoints)} pts con esta compra`,
      );
    }
  }, [cartItems, currentPoints, cartPoints, removeItem]);

  if (isLoading) return null;
  const available = promos ?? [];
  const reachable = (cartPoints > 0 ? (reachableData ?? []) : []).filter(
    (r) => !available.some((a) => a.productId === r.productId),
  );
  // Se muestra el banner si hay canjeables, alcanzables con esta compra O
  // canjes recientes que informar.
  if (
    available.length === 0 &&
    reachable.length === 0 &&
    redeemed.length === 0
  ) {
    return null;
  }

  function handleAddReachable(promo: ReachablePromotion) {
    if (cartItems.some((it) => it.productId === promo.productId)) {
      toast.info(`${promo.code} ya esta en el carrito`);
      return;
    }
    addItem(reachablePromoToQuickProduct(promo), 1);
    toast.success(
      `${promo.code} agregada: se canjea en esta misma compra al cobrar`,
    );
  }

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
      // Tope de canje = derechos disponibles del distribuidor (normalmente 1).
      maxQuantity: promo.availableCount ?? 1,
      components: promo.items,
    };

    addItem(item, 1);
    toast.success(`${promo.code} agregada — canje al cobrar`);
  }

  return (
    <div className="border-b bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-4 py-2.5">
      {available.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">
            Promociones canjeables
          </span>
          <span className="text-xs text-amber-700/70">
            ({available.length}) · {fmt(available[0].currentPoints)} pts acumulados
          </span>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {available.map((promo) => (
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
              {promo.items && promo.items.length > 0 && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Incluye:</span>{' '}
                  {promo.items
                    .map((it) =>
                      it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name,
                    )
                    .join(', ')}
                </p>
              )}
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

      {/* Canje en la misma compra: promos que ALCANZA con los puntos del
          carrito. Un clic la agrega; al cobrar el servidor acumula los
          puntos, otorga el derecho y lo canjea en la misma transacción. */}
      {reachable.length > 0 && (
        <div className={cn('pt-1', available.length > 0 && 'mt-1 border-t border-amber-200/70')}>
          <div className="mb-1.5 flex items-center gap-2">
            <Zap className="size-4 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800">
              Con esta compra alcanza
            </span>
            <span className="text-xs text-emerald-700/70">
              {fmt(reachable[0].currentPoints)} + {fmt(cartPoints)} ={' '}
              {fmt(reachable[0].projectedPoints)} pts · cóbrala en esta misma venta
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {reachable.map((promo) => {
              const inCart = cartItems.some((it) => it.productId === promo.productId);
              return (
                <Button
                  key={promo.productId}
                  type="button"
                  variant="outline"
                  onClick={() => handleAddReachable(promo)}
                  disabled={inCart}
                  className={cn(
                    'group flex h-auto shrink-0 items-center justify-start gap-3 whitespace-normal rounded-lg border border-emerald-200 bg-white px-3 py-2 text-left transition-all hover:border-emerald-400 hover:bg-white hover:shadow-md min-w-[240px] disabled:opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-grow">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        {promo.code}
                      </span>
                      <Badge className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {inCart ? 'En el carrito' : `Alcanza ${fmt(promo.minPointsRequired)} pts`}
                      </Badge>
                    </div>
                    <p className="truncate text-sm font-medium text-foreground">
                      {promo.name}
                    </p>
                    {promo.items.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">Incluye:</span>{' '}
                        {promo.items
                          .map((it) =>
                            it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name,
                          )
                          .join(', ')}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-emerald-700">
                      {inCart
                        ? 'Se canjea al cobrar esta venta'
                        : 'Agregar y canjear en esta compra'}
                    </p>
                  </div>
                  <PlusCircle className="size-6 shrink-0 text-emerald-600 group-hover:text-emerald-700" />
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Canjes recientes: DÓNDE se cobró cada promo (sucursal + folio +
          fecha) — la respuesta para "vengo a cobrar mi promo" cuando ya se
          cobró en otra sucursal. */}
      {redeemed.length > 0 && (
        <div className={cn('pt-1', (available.length > 0 || reachable.length > 0) && 'mt-1 border-t border-amber-200/70')}>
          <p className="mb-1 text-[11px] font-semibold text-amber-800/80">
            Promociones ya canjeadas:
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {redeemed.map((r, i) => (
              <span
                key={`${r.code}-${i}`}
                className="flex items-center gap-1 text-[11px] text-amber-900/70"
              >
                <MapPin className="size-3 shrink-0" />
                <span className="font-mono font-semibold">{r.code}</span>
                <span>
                  — canjeada en{' '}
                  <span className="font-medium">
                    {r.branchCode ? `${r.branchCode} ` : ''}
                    {r.branchName ?? 'sucursal desconocida'}
                  </span>{' '}
                  el{' '}
                  {new Date(r.redeemedAt).toLocaleDateString('es-MX', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {r.saleNumber ? ` (venta ${r.saleNumber})` : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
