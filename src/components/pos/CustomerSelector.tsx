// CustomerSelector - Selector de cliente/distribuidor para el POS.
// Portado de toniclife-next PosCustomerSelector (version 4c: busqueda simple
// por nombre/numero; al seleccionar resuelve precios del tier del cliente).

import { useState } from 'react';
import { Search, User, UserCheck, X, Tag, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePosCustomerSearch, usePosCustomerByNumber } from '@/hooks/usePos';
import { usePosCartStore } from '@/stores/pos-cart.store';
import type { PosCustomer } from '@/types/pos';

export function CustomerSelector() {
  const cart = usePosCartStore((s) => s.cart);
  const setCustomer = usePosCartStore((s) => s.setCustomer);
  const setPublicPrice = usePosCartStore((s) => s.setPublicPrice);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Busqueda EXACTA por numero de distribuidor: escribir "2" trae SOLO al
  // socio #2 (la busqueda general es parcial: "2" matchea 20, 200, 1112...).
  const [numberQuery, setNumberQuery] = useState('');
  const { data: fuzzyResults = [], isFetching: fuzzyFetching } =
    usePosCustomerSearch(numberQuery.trim() ? '' : query);
  const { data: numberResults = [], isFetching: numberFetching } =
    usePosCustomerByNumber(numberQuery);

  const byNumber = numberQuery.trim().length >= 1;
  const results = byNumber ? numberResults : fuzzyResults;
  const isFetching = byNumber ? numberFetching : fuzzyFetching;
  const hasQuery = byNumber || query.trim().length >= 1;

  function handleSelect(customer: PosCustomer) {
    // La busqueda exacta muestra tambien inactivos (para explicar el "no
    // aparece"), pero NO se les puede vender.
    // EXCEPCION (fix Tulsa): un distribuidor PENDIENTE si se puede asignar —
    // es el paso obligado para COBRARLE su kit de inscripcion, que es lo que
    // lo activa al pagar. El backend valida que a un pendiente solo se le
    // cobre su kit (createSale rechaza ventas sin kit para pendientes).
    if (customer.status === 'pending') {
      toast.warning(
        `El cliente #${customer.customerNumber ?? ''} esta pendiente: agrega su kit de inscripcion al ticket — se activara al cobrarlo. No se le puede vender otra cosa todavia.`,
        { duration: 6000 },
      );
    } else if (customer.status && customer.status !== 'active') {
      toast.error(
        `El cliente #${customer.customerNumber ?? ''} esta ${customer.status === 'inactive' ? 'inactivo' : customer.status} — no se puede asignar a la venta.`,
      );
      return;
    }
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
    setNumberQuery('');
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
        <div className="px-4 pb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim()) setNumberQuery('');
              }}
              placeholder="Buscar por nombre, email o numero (parcial)..."
              className="pl-9"
              autoFocus
            />
          </div>

          {/* Busqueda EXACTA por numero de distribuidor */}
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={numberQuery}
              onChange={(e) => {
                setNumberQuery(e.target.value);
                if (e.target.value.trim()) setQuery('');
              }}
              onKeyDown={(e) => {
                // Enter = seleccionar el resultado exacto (flujo rapido:
                // teclear numero + Enter)
                if (e.key === 'Enter' && byNumber && results.length === 1) {
                  e.preventDefault();
                  handleSelect(results[0]);
                }
              }}
              placeholder="No. de distribuidor EXACTO (ej. 2) + Enter"
              className="pl-9 font-mono"
            />
          </div>

          {hasQuery && (
            <div className="mt-2 border rounded-lg bg-card max-h-56 overflow-y-auto">
              {isFetching ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Buscando...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {byNumber
                    ? `No existe ningun cliente con el numero exacto "${numberQuery.trim()}".`
                    : 'Sin resultados'}
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map((c) => {
                    const pending = c.status === 'pending';
                    const blocked =
                      !!c.status && c.status !== 'active' && !pending;
                    return (
                      <li key={c.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleSelect(c)}
                          className={`block h-auto w-full rounded-none px-3 py-2 text-left whitespace-normal hover:bg-muted/60 ${
                            blocked ? 'opacity-60' : ''
                          }`}
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
                            {c.priceTypeId && !blocked && !pending && (
                              <span className="text-primary">distribuidor</span>
                            )}
                            {pending && (
                              <span className="text-amber-600 font-medium">
                                PENDIENTE — cobrale su kit para activarlo
                              </span>
                            )}
                            {blocked && (
                              <span className="text-destructive font-medium">
                                {c.status === 'inactive'
                                  ? 'INACTIVO — no se puede vender'
                                  : c.status?.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
