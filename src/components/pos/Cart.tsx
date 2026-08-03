// Cart - Panel del carrito del POS.
// Portado de toniclife-next PosCart: items + cliente + cupón + totales.
// El descuento MANUAL fue retirado (decisión ago-2026): todo descuento entra
// por CUPÓN creado en admin, validado server-side y trazado en el canje.

import { useState } from 'react';
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  X,
  Tag,
  Package,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePosCartStore } from '@/stores/pos-cart.store';
import { posApi } from '@/lib/posApi';
import { CustomerSelector } from './CustomerSelector';
import { PosPointsBar } from './PosPointsBar';

interface CartProps {
  currencySymbol: string;
  currencyCode: string;
  isProcessing?: boolean;
  onCheckout?: () => void;
}

export function Cart({
  currencySymbol,
  currencyCode,
  isProcessing,
  onCheckout,
}: CartProps) {
  const cart = usePosCartStore((s) => s.cart);
  const updateItemQuantity = usePosCartStore((s) => s.updateItemQuantity);
  const removeItem = usePosCartStore((s) => s.removeItem);
  const clearCart = usePosCartStore((s) => s.clearCart);
  const setCoupon = usePosCartStore((s) => s.setCoupon);
  const clearCoupon = usePosCartStore((s) => s.clearCoupon);

  const [expandedIncludes, setExpandedIncludes] = useState<
    Record<string, boolean>
  >({});
  const toggleIncludes = (productId: string) =>
    setExpandedIncludes((prev) => ({ ...prev, [productId]: !prev[productId] }));

  const [showCoupon, setShowCoupon] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const itemCount = cart.items.reduce((sum, it) => sum + it.quantity, 0);
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const hasCoupon = !!cart.couponCode && (cart.couponDiscount ?? 0) > 0;
  // Compat: descuento manual solo puede venir de estado viejo; ya no hay UI.
  const hasManualDiscount = !!cart.discountAmount && cart.discountAmount > 0;

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setValidatingCoupon(true);
    setCouponError(null);
    try {
      // Base del descuento: subtotal + impuestos (lo que paga el cliente),
      // ANTES de cupón. El API re-valida al crear la venta.
      const result = await posApi.validateCoupon({
        code,
        subtotal: Math.round((cart.subtotal + cart.taxAmount) * 100) / 100,
        customerId: cart.customerId,
      });
      if (!result.valid || !result.coupon) {
        setCouponError(result.reason || 'Cupón inválido');
        return;
      }
      setCoupon(
        result.coupon.code,
        result.discount,
        result.coupon.description || undefined,
      );
      setShowCoupon(false);
      setCouponInput('');
      toast.success(
        `Cupón ${result.coupon.code}: - ${fmt(result.discount)}${result.coupon.employeeOnly ? ' (empleados)' : ''}`,
      );
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setCouponError(e.response?.data?.message || 'No se pudo validar el cupón');
    } finally {
      setValidatingCoupon(false);
    }
  }

  function removeCoupon() {
    clearCoupon();
    setCouponInput('');
    setCouponError(null);
  }

  return (
    <div className="flex flex-col h-full bg-card border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-5 text-primary" />
          <h2 className="font-semibold text-foreground">Carrito</h2>
          {itemCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold rounded-full px-2 py-0.5">
              {itemCount}
            </span>
          )}
        </div>
        {cart.items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearCart}
            className="h-auto p-0 gap-1 text-xs text-muted-foreground hover:bg-transparent hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Vaciar
          </Button>
        )}
      </div>

      {/* Selector de cliente / precio publico */}
      <CustomerSelector />

      {/* Progreso de puntos del distribuidor */}
      {cart.customerId && (
        <PosPointsBar
          customerId={cart.customerId}
          cartPoints={cart.totalPoints}
        />
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {cart.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 px-6 text-center">
            <ShoppingCart className="size-10 opacity-30" />
            <p className="text-sm">
              El carrito esta vacio. Busca productos para agregar.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {cart.items.map((item) => (
              <li key={item.productId} className="p-3 flex gap-3">
                {/* Imagen */}
                <div className="size-12 rounded-md bg-muted/40 overflow-hidden shrink-0">
                  {item.productImage ? (
                    <img
                      src={item.productImage}
                      alt={item.productName}
                      className="w-full h-full object-contain p-0.5"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-xs font-bold">
                      {item.productName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Detalle */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {item.productName}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {item.productSku}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(item.productId)}
                      className="size-6 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
                      title="Quitar"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>

                  {/* "Incluye" — componentes de la promo/kit */}
                  {item.components && item.components.length > 0 && (
                    <div className="mt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleIncludes(item.productId)}
                        className="h-auto gap-1 p-0 text-[11px] font-medium text-primary hover:bg-transparent"
                      >
                        <Package className="size-3" />
                        Incluye ({item.components.length})
                        {expandedIncludes[item.productId] ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                      </Button>
                      {expandedIncludes[item.productId] && (
                        <ul className="mt-1 space-y-0.5 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                          {item.components.map((c) => (
                            <li
                              key={c.code}
                              className="flex justify-between gap-2"
                            >
                              <span className="truncate">
                                {c.name}{' '}
                                <span className="font-mono text-muted-foreground/80">
                                  ({c.code})
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums">
                                ×{c.quantity}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="mt-1.5 flex items-center justify-between">
                    {/* Stepper de cantidad */}
                    <div className="flex items-center border rounded-md">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateItemQuantity(item.productId, item.quantity - 1)
                        }
                        className="size-7 rounded-none hover:bg-muted"
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="px-2 text-sm font-medium tabular-nums min-w-[2rem] text-center">
                        {item.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateItemQuantity(item.productId, item.quantity + 1)
                        }
                        disabled={
                          item.stock != null && item.quantity >= item.stock
                        }
                        className="size-7 rounded-none hover:bg-muted disabled:opacity-40"
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground tabular-nums">
                        {fmt(item.total)}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {fmt(item.unitPrice)} c/u
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cupón de descuento (los descuentos manuales fueron retirados) */}
      {cart.items.length > 0 && (
        <div className="border-t px-4 py-2.5">
          {hasCoupon ? (
            <div className="flex items-center justify-between text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-emerald-700">
                <Tag className="size-3.5 shrink-0" />
                <span className="truncate">
                  Cupón <span className="font-mono font-semibold">{cart.couponCode}</span>
                  {cart.couponDescription ? ` — ${cart.couponDescription}` : ''}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={removeCoupon}
                className="size-6 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
                title="Quitar cupón"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : showCoupon ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void applyCoupon();
                    }
                  }}
                  placeholder="Código del cupón"
                  className="h-8 flex-1 font-mono uppercase"
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={() => void applyCoupon()}
                  disabled={validatingCoupon || !couponInput.trim()}
                >
                  {validatingCoupon ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    'Aplicar'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCoupon(false);
                    setCouponError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
              {couponError && (
                <p className="text-xs text-destructive">{couponError}</p>
              )}
            </div>
          ) : (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setShowCoupon(true)}
              className="h-auto gap-1.5 p-0 text-xs"
            >
              <Tag className="size-3.5" />
              Aplicar cupón
            </Button>
          )}
        </div>
      )}

      {/* Totales + Cobrar */}
      <div className="border-t p-4 space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{fmt(cart.subtotal)}</span>
        </div>
        {hasManualDiscount && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Descuento</span>
            <span className="tabular-nums">- {fmt(cart.discountAmount!)}</span>
          </div>
        )}
        {hasCoupon && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>
              Cupón <span className="font-mono">{cart.couponCode}</span>
            </span>
            <span className="tabular-nums">- {fmt(cart.couponDiscount!)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Impuestos</span>
          <span className="tabular-nums">{fmt(cart.taxAmount)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-2 border-t">
          <span className="font-semibold text-foreground">Total</span>
          <span className="text-xl font-bold text-primary tabular-nums">
            {fmt(cart.total)}
          </span>
        </div>
        {cart.totalPoints > 0 && (
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Puntos de la venta</span>
            <span className="tabular-nums">{cart.totalPoints.toFixed(2)} pts</span>
          </div>
        )}

        <Button
          size="xl"
          className="w-full mt-2"
          disabled={cart.items.length === 0 || isProcessing}
          onClick={onCheckout}
        >
          {isProcessing
            ? 'Procesando...'
            : `Cobrar ${cart.items.length > 0 ? fmt(cart.total) : ''}`}
          {!isProcessing && (
            <span className="text-xs font-normal opacity-80 ml-1">
              {currencyCode}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
