// ProductInfoModal - detalle INFORMATIVO de un producto del catálogo POS
// (botón ⓘ del card): nombre, código, categoría, descripción, precio, puntos,
// existencia y qué incluye (kits/promos). La imagen se amplía con el mismo
// visor de pantalla completa de promociones/kits (ImageLightbox).

import { useState } from 'react';
import { X, Info, ImageOff, ZoomIn, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageLightbox } from './ImageLightbox';
import { posApi } from '@/lib/posApi';
import type { QuickProduct } from '@/types/pos';

const TYPE_LABEL: Record<string, string> = {
  finished_good: 'Producto',
  kit: 'Kit',
  promotional: 'Promoción',
  raw_material: 'Materia prima',
  service: 'Servicio',
  virtual: 'Virtual',
};

interface ProductInfoModalProps {
  /** Producto a mostrar; null = cerrado. */
  product: QuickProduct | null;
  onClose: () => void;
  currencySymbol: string;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export function ProductInfoModal({
  product: p,
  onClose,
  currencySymbol,
}: ProductInfoModalProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
          showCloseButton={false}
        >
          {p && (
            <>
              {/* Header */}
              <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
                <div className="flex min-w-0 items-center gap-2">
                  <Info className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <DialogTitle className="truncate text-lg font-bold text-foreground">
                      {p.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Detalle del producto — solo informativo
                    </DialogDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={onClose}
                  aria-label="Cerrar"
                >
                  <X className="size-4 text-muted-foreground" />
                </Button>
              </DialogHeader>

              {/* Cuerpo: imagen + datos */}
              <div className="grid gap-5 px-6 py-5 sm:grid-cols-[220px_1fr]">
                <button
                  type="button"
                  onClick={() => p.imageUrl && setLightboxOpen(true)}
                  disabled={!p.imageUrl}
                  className="group relative aspect-square w-full overflow-hidden rounded-xl border bg-muted/40 disabled:cursor-default"
                  title={p.imageUrl ? 'Clic para ver en grande' : undefined}
                >
                  {p.imageUrl ? (
                    <>
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="h-full w-full object-contain p-2"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/25 group-hover:opacity-100">
                        <div className="rounded-full bg-background/90 p-2 shadow">
                          <ZoomIn className="size-5 text-foreground" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground/60">
                      <ImageOff className="size-8" />
                      <span className="text-xs">Sin imagen</span>
                    </div>
                  )}
                </button>

                <div className="min-w-0 space-y-2.5">
                  <InfoRow
                    label="Código"
                    value={
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {p.sku}
                      </span>
                    }
                  />
                  {p.categoryName && (
                    <InfoRow label="Categoría" value={p.categoryName} />
                  )}
                  <InfoRow
                    label="Tipo"
                    value={TYPE_LABEL[p.productType ?? ''] ?? 'Producto'}
                  />
                  <InfoRow
                    label="Precio"
                    value={
                      <span className="text-base font-bold text-primary">
                        {posApi.formatCurrency(p.basePrice, currencySymbol)}
                      </span>
                    }
                  />
                  {(p.points ?? 0) > 0 && (
                    <InfoRow
                      label="Puntos"
                      value={`${p.points} pts por unidad`}
                    />
                  )}
                  {(p.businessVolume ?? 0) > 0 &&
                    p.businessVolume !== p.points && (
                      <InfoRow
                        label="Vol. negocio"
                        value={`${p.businessVolume} por unidad`}
                      />
                    )}
                  {p.stock != null && (
                    <InfoRow
                      label="Existencia"
                      value={
                        p.stock > 0 ? (
                          `${p.stock} disponibles`
                        ) : (
                          <span className="font-semibold text-destructive">
                            Agotado
                          </span>
                        )
                      }
                    />
                  )}

                  {/* Descripción */}
                  <div className="border-t pt-2.5">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Descripción
                    </div>
                    {p.description?.trim() ? (
                      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                        {p.description}
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        Sin descripción registrada.
                      </p>
                    )}
                  </div>

                  {/* Qué incluye (kits / promociones) */}
                  {(p.components?.length ?? 0) > 0 && (
                    <div className="border-t pt-2.5">
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Gift className="size-3" />
                        Incluye
                      </div>
                      <ul className="space-y-0.5 text-sm text-foreground">
                        {p.components!.map((c) => (
                          <li key={c.code}>
                            {c.quantity} ×{' '}
                            <span className="font-medium">{c.name}</span>{' '}
                            <span className="font-mono text-xs text-muted-foreground">
                              ({c.code})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {p && (
        <ImageLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={p.imageUrl}
          alt={p.name}
          title={p.name}
          subtitle={<span className="font-mono">{p.sku}</span>}
        />
      )}
    </>
  );
}
