// ProductGrid - Catalogo de productos del POS + alta rapida por SKU.
// Portado de toniclife-next PosProductGrid + PosProductSearch (version 4b:
// precio publico, sin price tiers — eso llega en 4c con el selector de cliente).

import { useMemo, useState } from 'react';
import { Search, ScanBarcode, PackageX, Plus, ListPlus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { usePosCatalog } from '@/hooks/usePos';
import { usePosCartStore } from '@/stores/pos-cart.store';
import { posApi } from '@/lib/posApi';
import { ProductInfoModal } from './ProductInfoModal';
import type { QuickProduct } from '@/types/pos';

interface ProductGridProps {
  branchId: string;
  currencySymbol: string;
  /** Se invoca cuando se intenta agregar un kit de inscripcion
   *  (isEnrollmentKit=true). El kit NO se agrega al carrito directamente;
   *  PosScreen abre el flujo de enrolamiento de distribuidor. */
  onKitDetected: (product: QuickProduct) => void;
}

export function ProductGrid({
  branchId,
  currencySymbol,
  onKitDetected,
}: ProductGridProps) {
  const priceTypeId = usePosCartStore((s) => s.cart.priceTypeId);
  const { data: catalog = [], isLoading } = usePosCatalog(branchId, priceTypeId);
  const addItem = usePosCartStore((s) => s.addItem);
  const cartItems = usePosCartStore((s) => s.cart.items);

  const [filter, setFilter] = useState('');
  // Producto abierto en el modal informativo (botón ⓘ del card).
  const [infoProduct, setInfoProduct] = useState<QuickProduct | null>(null);
  const [skuInput, setSkuInput] = useState('');
  const [skuLoading, setSkuLoading] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.categoryName?.toLowerCase().includes(q) ?? false),
    );
  }, [catalog, filter]);

  const cartQtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cartItems) m.set(it.productId, it.quantity);
    return m;
  }, [cartItems]);

  function handleAdd(product: QuickProduct) {
    // Kit de inscripcion: dispara el flujo de enrolamiento en vez de agregarse
    // directo al carrito.
    if (product.isEnrollmentKit) {
      onKitDetected(product);
      return;
    }
    if (product.stock != null && product.stock <= 0) {
      toast.error(`${product.name} esta agotado`);
      return;
    }
    const inCart = cartQtyByProduct.get(product.id) ?? 0;
    if (product.stock != null && inCart >= product.stock) {
      toast.warning(`Solo hay ${product.stock} de ${product.name}`);
      return;
    }
    addItem(product, 1);
  }

  /**
   * Acepta dos formatos:
   *   - "9019"      -> agrega 1 unidad (uso tipico de scanner de barras).
   *   - "9019,12"   -> agrega 12 unidades (separador acepta ",", ";" o tab).
   * Si la cantidad solicitada excede stock disponible, muestra warning con
   * el detalle (X de Y agregados).
   */
  async function handleSkuSubmit() {
    const raw = skuInput.trim();
    if (!raw) return;

    const [skuPart, qtyPart] = raw.split(/[,;\t]/).map((s) => s.trim());
    const sku = skuPart;
    if (!sku) return;
    const qty = Math.max(1, parseInt(qtyPart || '1', 10) || 1);

    setSkuLoading(true);
    try {
      // priceTypeId garantiza que el backend resuelva precio distribuidor
      // cuando hay un cliente con tier seleccionado.
      const product = await posApi.getProductBySku(sku, branchId, priceTypeId);
      if (!product) {
        toast.error(`No se encontro el producto con codigo "${sku}"`);
        return;
      }
      // Kit de inscripcion: deriva al flujo de enrolamiento, no al carrito.
      if (product.isEnrollmentKit) {
        onKitDetected(product);
        setSkuInput('');
        return;
      }

      const inCart = cartQtyByProduct.get(product.id) ?? 0;
      const available =
        product.stock != null
          ? Math.max(0, product.stock - inCart)
          : qty;

      if (available <= 0) {
        toast.error(
          `${product.name} esta agotado (stock: ${product.stock ?? 0})`,
        );
        return;
      }

      const toAdd = Math.min(qty, available);
      addItem(product, toAdd);
      setSkuInput('');

      if (toAdd < qty) {
        toast.warning(
          `Solo se agregaron ${toAdd} de ${qty} — stock disponible: ${product.stock}`,
        );
      } else if (qty > 1) {
        // qty=1 (scanner) queda silencioso para no entorpecer cobros rapidos.
        toast.success(`${toAdd} x ${product.name} agregado(s) al carrito`);
      }
    } catch {
      toast.error('Error al buscar el producto');
    } finally {
      setSkuLoading(false);
    }
  }

  /** Modo lote: cada linea "sku,cantidad" (cantidad opcional, default 1). */
  async function handleBulkSubmit() {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setBulkLoading(true);
    let added = 0;
    const notFound: string[] = [];
    /** Productos que se agregaron pero con qty recortada por stock. */
    const capped: Array<{ name: string; added: number; requested: number }> =
      [];
    /** Tracking interno: cuanto hemos solicitado ya por producto en este
     *  mismo batch, para que dos lineas con el mismo SKU calculen su
     *  disponibilidad considerando lo ya solicitado en lineas anteriores. */
    const pendingByProduct = new Map<string, number>();

    try {
      for (const line of lines) {
        const [rawSku, rawQty] = line.split(/[,;\t]/).map((s) => s.trim());
        if (!rawSku) continue;
        const qty = Math.max(1, parseInt(rawQty || '1', 10) || 1);
        // priceTypeId garantiza que el backend resuelva precio distribuidor
        // cuando hay un cliente con tier seleccionado.
        const product = await posApi.getProductBySku(
          rawSku,
          branchId,
          priceTypeId,
        );
        if (!product) {
          notFound.push(rawSku);
          continue;
        }
        if (product.isEnrollmentKit) {
          notFound.push(`${rawSku} (kit — agregalo manualmente)`);
          continue;
        }

        // Disponibilidad real = stock - (lo que ya esta en carrito + lo que
        // ya se agrego en este batch). Si stock es null (kits o productos
        // sin tracking de inventario), no se hace cap.
        const inCart = cartQtyByProduct.get(product.id) ?? 0;
        const pending = pendingByProduct.get(product.id) ?? 0;
        const available =
          product.stock != null
            ? Math.max(0, product.stock - inCart - pending)
            : qty;
        const toAdd = Math.min(qty, available);

        if (toAdd <= 0) {
          notFound.push(
            `${rawSku} (sin stock disponible — ${product.stock ?? 0} en total)`,
          );
          continue;
        }

        addItem(product, toAdd);
        pendingByProduct.set(product.id, pending + toAdd);
        added++;

        if (toAdd < qty) {
          capped.push({
            name: product.name,
            added: toAdd,
            requested: qty,
          });
        }
      }

      if (added > 0) {
        toast.success(`${added} producto(s) agregados al carrito`);
      }
      if (capped.length > 0) {
        const detail = capped
          .map((c) => `${c.name} (${c.added}/${c.requested})`)
          .join(', ');
        toast.warning(`Stock insuficiente — agregado parcial: ${detail}`);
      }
      if (notFound.length > 0) {
        toast.error(`No se agregaron: ${notFound.join(', ')}`);
      }
      // Solo limpia + cierra si TODO salio limpio (sin caps, sin not found).
      if (added > 0 && notFound.length === 0 && capped.length === 0) {
        setBulkText('');
        setBulkMode(false);
      }
    } catch {
      toast.error('Error procesando el lote');
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barra de busqueda + SKU */}
      <div className="p-4 border-b bg-background space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar en catalogo por nombre, SKU o categoria..."
              className="pl-9"
            />
          </div>
          <div className="relative w-56">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSkuSubmit();
              }}
              placeholder="SKU / codigo de barras (ej. 9019 o 9019,12)"
              className="pl-9"
              disabled={skuLoading}
              spellCheck={false}
            />
          </div>
          <Button
            variant={bulkMode ? 'default' : 'outline'}
            onClick={() => setBulkMode((v) => !v)}
            title="Agregar productos en lote"
          >
            <ListPlus />
            Lote
          </Button>
        </div>

        {/* Modo lote */}
        {bulkMode && (
          <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Pega un producto por linea con el formato{' '}
              <span className="font-mono">SKU,cantidad</span> (la cantidad es
              opcional, por defecto 1).
            </p>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={4}
              placeholder={'5663,2\n3026,1\n8159N'}
              className="w-full px-3 py-2 border rounded-md text-sm font-mono resize-none bg-background"
              disabled={bulkLoading}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleBulkSubmit}
                disabled={bulkLoading || !bulkText.trim()}
              >
                {bulkLoading ? 'Procesando...' : 'Agregar lote al carrito'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBulkText('');
                  setBulkMode(false);
                }}
                disabled={bulkLoading}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Cargando catalogo...
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
            <PackageX className="size-10" />
            <p className="text-sm">
              {filter
                ? 'Ningun producto coincide con la busqueda'
                : 'No hay productos disponibles en el catalogo'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {filtered.map((product) => {
              const out =
                product.stock != null && product.stock <= 0;
              const inCart = cartQtyByProduct.get(product.id) ?? 0;
              return (
                // Wrapper relativo: el botón ⓘ vive FUERA del Button del card
                // (un button no puede anidar otro, y con "Agotado" el card se
                // deshabilita y tragaría el clic — la info debe verse siempre).
                <div key={product.id} className="relative">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleAdd(product)}
                  disabled={out}
                  className={cn(
                    'group relative block h-auto w-full p-0 text-left rounded-xl border bg-card overflow-hidden whitespace-normal transition-shadow hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {/* Imagen */}
                  <div className="aspect-square bg-muted/40 relative overflow-hidden">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-contain p-2"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-2xl font-bold">
                        {product.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {out && (
                      <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                        <span className="text-xs font-semibold text-destructive uppercase tracking-wide">
                          Agotado
                        </span>
                      </div>
                    )}
                    {inCart > 0 && !out && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold rounded-full size-6 flex items-center justify-center shadow">
                        {inCart}
                      </span>
                    )}
                    {!out && (
                      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-primary text-primary-foreground rounded-full p-2 shadow-lg">
                          <Plus className="size-5" />
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5">
                    <div className="text-sm font-medium text-foreground line-clamp-2 leading-tight min-h-[2.5rem]">
                      {product.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {product.sku}
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between">
                      <span className="text-base font-bold text-primary">
                        {posApi.formatCurrency(product.basePrice, currencySymbol)}
                      </span>
                      {product.stock != null && (
                        <span className="text-[11px] text-muted-foreground">
                          {product.stock} disp.
                        </span>
                      )}
                    </div>
                  </div>
                </Button>
                {/* ⓘ Detalle informativo (funciona también en agotados) */}
                <button
                  type="button"
                  onClick={() => setInfoProduct(product)}
                  className="absolute left-2 top-2 z-10 rounded-full border bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-background hover:text-primary"
                  title="Ver detalles del producto"
                  aria-label={`Ver detalles de ${product.name}`}
                >
                  <Info className="size-4" />
                </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de detalle informativo (ⓘ) */}
      <ProductInfoModal
        product={infoProduct}
        onClose={() => setInfoProduct(null)}
        currencySymbol={currencySymbol}
      />
    </div>
  );
}
