// OrderTabsBar — Pestañas de pedidos encima del carrito (modo staff). Cada
// pestaña es un pedido en curso: Call Center cambia de llamada sin perder el
// carrito, el distribuidor ni la entrega a domicilio del otro pedido.

import { Plus, Truck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OrderTab } from '@/stores/pos-order-tabs.store';
import type { PosCart } from '@/types/pos';

interface OrderTabsBarProps {
  tabs: OrderTab[];
  activeId: string;
  /** Estado vivo de la pestaña activa (las demás traen su snapshot). */
  liveCart: PosCart;
  liveDeliveryMode: boolean;
  /** Mientras se cobra no se cambia de pedido. */
  disabled?: boolean;
  onSelect: (id: string) => void;
  onOpen: () => void;
  onClose: (id: string) => void;
}

/** "MARÍA GUADALUPE PÉREZ LÓPEZ" → "María Guadalupe" (cabe en la pestaña). */
function shortName(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function OrderTabsBar({
  tabs,
  activeId,
  liveCart,
  liveDeliveryMode,
  disabled,
  onSelect,
  onOpen,
  onClose,
}: OrderTabsBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-l bg-muted/40 px-2 py-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const cart = active ? liveCart : (tab.parked?.cart ?? liveCart);
        const deliveryMode = active
          ? liveDeliveryMode
          : !!tab.parked?.deliveryMode;
        const count = cart.items.reduce((sum, it) => sum + it.quantity, 0);
        const label = cart.customerName
          ? shortName(cart.customerName)
          : `Pedido ${tab.seq}`;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`group flex h-7 shrink-0 items-center gap-1 rounded-md border pl-2 pr-1 text-xs transition-colors ${
              active
                ? 'border-border bg-background font-semibold text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              disabled={disabled}
              className="flex max-w-40 items-center gap-1 truncate disabled:cursor-not-allowed"
              title={
                cart.customerName
                  ? `${cart.customerName}${cart.customerNumber ? ` #${cart.customerNumber}` : ''}`
                  : `Pedido ${tab.seq}`
              }
            >
              {deliveryMode && <Truck className="size-3 shrink-0 text-violet-600" />}
              <span className="truncate">{label}</span>
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-bold leading-4 ${
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              disabled={disabled}
              className="rounded p-0.5 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed"
              title="Cerrar este pedido"
              aria-label={`Cerrar ${label}`}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onOpen}
        disabled={disabled}
        className="h-7 shrink-0 gap-1 px-2 text-xs"
        title="Nuevo pedido (otra llamada): el actual se conserva en su pestaña"
      >
        <Plus className="size-3.5" />
        Pedido
      </Button>
    </div>
  );
}
