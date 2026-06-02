// CustomerSelector - Selector de cliente/distribuidor para el POS.
// Portado de toniclife-next PosCustomerSelector (version 4c: busqueda simple
// por nombre/numero; al seleccionar resuelve precios del tier del cliente).

import { useState } from 'react';
import { Search, User, UserCheck, X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { usePosCustomerSearch } from '@/hooks/usePos';
import { usePosCartStore } from '@/stores/pos-cart.store';
import type { PosCustomer } from '@/types/pos';

export function CustomerSelector() {
  const cart = usePosCartStore((s) => s.cart);
  const setCustomer = usePosCartStore((s) => s.setCustomer);
  const setPublicPrice = usePosCartStore((s) => s.setPublicPrice);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data: results = [], isFetching } = usePosCustomerSearch(query);

  function handleSelect(customer: PosCustomer) {
    // El re-cotizado de los items del carrito se hace de forma reactiva en
    // PosScreen al cambiar el tipo de precio (cubre asignar Y quitar distribuidor).
    setCustomer(
      customer.id,
      customer.fullName,
      customer.rfc,
      customer.priceTypeId,
    );
    setOpen(false);
    setQuery('');
    toast.success(`Cliente: ${customer.fullName}`);
  }

  function handleClear() {
    setPublicPrice(true);
    toast.info('Venta a precio publico');
  }

  // --- Cliente ya seleccionado ---
  if (cart.customerId) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b">
        <UserCheck className="size-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {cart.customerName}
          </div>
          {cart.customerRfc && (
            <div className="text-[11px] text-muted-foreground font-mono">
              {cart.customerRfc}
            </div>
          )}
        </div>
        {cart.priceTypeId && (
          <span className="flex items-center gap-1 text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            <Tag className="size-3" />
            Precio distribuidor
          </span>
        )}
        <button
          onClick={handleClear}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
          title="Quitar cliente (precio publico)"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  // --- Sin cliente ---
  return (
    <div className="border-b">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <User className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">
          Precio publico — venta sin distribuidor
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          {open ? 'Cancelar' : 'Asignar distribuidor'}
        </button>
      </div>

      {open && (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o numero de cliente..."
              className="pl-9"
              autoFocus
            />
          </div>

          {query.trim().length >= 1 && (
            <div className="mt-2 border rounded-lg bg-card max-h-56 overflow-y-auto">
              {isFetching ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Buscando...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Sin resultados
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => handleSelect(c)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                      >
                        <div className="text-sm font-medium text-foreground">
                          {c.fullName}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex gap-2">
                          {c.customerNumber && (
                            <span className="font-mono">
                              #{c.customerNumber}
                            </span>
                          )}
                          {c.rfc && <span className="font-mono">{c.rfc}</span>}
                          {c.priceTypeId && (
                            <span className="text-primary">distribuidor</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
