// CustomerSelector - Selector de cliente/distribuidor para el POS.
// Portado de toniclife-next PosCustomerSelector (version 4c: busqueda simple
// por nombre/numero; al seleccionar resuelve precios del tier del cliente).

import { useState } from 'react';
import { Search, User, UserCheck, X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
      customer.customerNumber,
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
          {cart.customerNumber && (
            <div className="text-[11px] text-muted-foreground font-mono">
              #{cart.customerNumber}
            </div>
          )}
        </div>
        {cart.priceTypeId && (
          <Badge className="flex items-center gap-1 text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            <Tag className="size-3" />
            Precio distribuidor
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="size-6 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
          title="Quitar cliente (precio publico)"
        >
          <X className="size-4" />
        </Button>
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
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="h-auto shrink-0 p-0 text-xs font-medium"
        >
          {open ? 'Cancelar' : 'Asignar distribuidor'}
        </Button>
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
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleSelect(c)}
                        className="block h-auto w-full rounded-none px-3 py-2 text-left whitespace-normal hover:bg-muted/60"
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
                      </Button>
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
