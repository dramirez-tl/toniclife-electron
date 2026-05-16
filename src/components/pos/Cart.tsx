// Cart - Panel del carrito del POS.
// Portado de toniclife-next PosCart: items + cliente + descuento + totales.

import { useState } from 'react';
import { ShoppingCart, Trash2, Plus, Minus, X, Tag } from 'lucide-react';
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
  const setDiscount = usePosCartStore((s) => s.setDiscount);

  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(
    'percent',
  );
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  const itemCount = cart.items.reduce((sum, it) => sum + it.quantity, 0);
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const hasDiscount = !!cart.discountAmount && cart.discountAmount > 0;

  function applyDiscount() {
    const v = parseFloat(discountValue);
    if (!Number.isFinite(v) || v <= 0) return;
    if (discountType === 'percent') {
      setDiscount(Math.min(v, 100), undefined, discountReason.trim() || undefined);
    } else {
      setDiscount(undefined, v, discountReason.trim() || undefined);
    }
    setShowDiscount(false);
  }

  function clearDiscount() {
    setDiscount(undefined, undefined, undefined);
    setDiscountValue('');
    setDiscountReason('');
    setShowDiscount(false);
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
          <button
            onClick={clearCart}
            className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
          >
            <Trash2 className="size-3.5" />
            Vaciar
          </button>
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
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Quitar"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between">
                    {/* Stepper de cantidad */}
                    <div className="flex items-center border rounded-md">
                      <button
                        onClick={() =>
                          updateItemQuantity(item.productId, item.quantity - 1)
                        }
                        className="px-1.5 py-1 hover:bg-muted transition-colors"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="px-2 text-sm font-medium tabular-nums min-w-[2rem] text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateItemQuantity(item.productId, item.quantity + 1)
                        }
                        disabled={
                          item.stock != null && item.quantity >= item.stock
                        }
                        className="px-1.5 py-1 hover:bg-muted transition-colors disabled:opacity-40"
                      >
                        <Plus className="size-3" />
                      </button>
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

      {/* Descuento */}
      {cart.items.length > 0 && (
        <div className="border-t px-4 py-2.5">
          {hasDiscount ? (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-emerald-700">
                <Tag className="size-3.5" />
                Descuento
                {cart.discountPercent
                  ? ` (${cart.discountPercent}%)`
                  : ''}
                {cart.discountReason ? ` — ${cart.discountReason}` : ''}
              </span>
              <button
                onClick={clearDiscount}
                className="text-muted-foreground hover:text-destructive"
                title="Quitar descuento"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : showDiscount ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex border rounded-md overflow-hidden">
                  <button
                    onClick={() => setDiscountType('percent')}
                    className={`px-2.5 text-sm ${discountType === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                  >
                    %
                  </button>
                  <button
                    onClick={() => setDiscountType('amount')}
                    className={`px-2.5 text-sm ${discountType === 'amount' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                  >
                    {currencySymbol.trim() || '$'}
                  </button>
                </div>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === 'percent' ? '0-100' : '0.00'}
                  className="flex-1 h-8 text-right tabular-nums"
                  autoFocus
                />
              </div>
              <Input
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="Motivo del descuento (opcional)"
                className="h-8 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={applyDiscount}>
                  Aplicar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDiscount(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDiscount(true)}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Tag className="size-3.5" />
              Aplicar descuento
            </button>
          )}
        </div>
      )}

      {/* Totales + Cobrar */}
      <div className="border-t p-4 space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{fmt(cart.subtotal)}</span>
        </div>
        {hasDiscount && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Descuento</span>
            <span className="tabular-nums">- {fmt(cart.discountAmount!)}</span>
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
