// CurrentPromotionsModal - Promociones VIGENTES del país de la sucursal.
// SOLO INFORMATIVO (mostrador): qué promos corren hoy, cuántos puntos piden y
// qué incluyen en este país. No otorga ni canjea nada — los derechos se ganan
// automáticamente por puntos y el canje aparece al asignar al distribuidor.

import { useState } from 'react';
import {
  X,
  BadgePercent,
  Gift,
  CalendarRange,
  Repeat,
  Loader2,
  PartyPopper,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageLightbox } from '@/components/pos/ImageLightbox';
import { useCurrentPromotions } from '@/hooks/usePromotions';
import type { CurrentPromotion } from '@/lib/promotionsApi';

interface CurrentPromotionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
}

const fmtPoints = (n: number) => new Intl.NumberFormat('es-MX').format(n);

/** '2026-08-25' → '25/08/2026' sin pasar por Date (evita corrimiento de TZ). */
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export function CurrentPromotionsModal({
  isOpen,
  onClose,
  branchId,
  branchName,
}: CurrentPromotionsModalProps) {
  const { data: promos = [], isLoading } = useCurrentPromotions(
    isOpen ? branchId : undefined,
  );
  // Promo cuya imagen se ve en grande (lightbox con zoom).
  const [previewPromo, setPreviewPromo] = useState<CurrentPromotion | null>(
    null,
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <BadgePercent className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Promociones vigentes
              </DialogTitle>
              <DialogDescription className="text-xs">
                Lo que aplica hoy en {branchName} — solo informativo
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Los derechos se otorgan automáticamente cuando el distribuidor
            alcanza los puntos del periodo. El canje aparece en la venta al
            asignar al distribuidor — aquí no se canjea nada.
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando promociones...
            </div>
          ) : promos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <PartyPopper className="size-10 text-muted-foreground/50" />
              <p className="text-sm">
                No hay promociones vigentes para esta sucursal.
              </p>
              <p className="text-xs text-muted-foreground/80">
                Cuando el corporativo active una promoción para este país,
                aparecerá aquí.
              </p>
            </div>
          ) : (
            promos.map((p) => (
              <Card key={p.productId} className="gap-0 rounded-lg py-0 shadow-none">
                <CardContent className="p-0">
                  {/* Encabezado de la promo */}
                  <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* Imagen de la promo (si tiene): clic = ver en grande */}
                      {p.imageUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewPromo(p)}
                          className="group relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted"
                          title="Ver imagen de la promoción"
                        >
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="size-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                        </button>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {p.name}
                        </div>
                        {p.description && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {p.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground">
                      {p.code}
                    </span>
                  </div>

                  {/* Condiciones */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {fmtPoints(p.minPointsRequired)} puntos del periodo
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="size-3" />
                      {p.recurrence === 'per_period'
                        ? 'Cada periodo'
                        : 'Una sola vez'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarRange className="size-3" />
                      {p.availableFrom || p.availableTo
                        ? `${p.availableFrom ? fmtDay(p.availableFrom) : '…'} al ${p.availableTo ? fmtDay(p.availableTo) : '…'}`
                        : 'Sin fecha límite'}
                    </span>
                    <span>
                      Derecho vigente {p.validityDays} días
                      {p.consumesPoints ? ' · descuenta puntos al canjear' : ''}
                    </span>
                  </div>

                  {/* Qué incluye en este país */}
                  {p.items.length > 0 && (
                    <div className="border-t px-4 py-2.5">
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Gift className="size-3" />
                        Incluye
                      </div>
                      <ul className="space-y-0.5 text-xs text-foreground">
                        {p.items.map((it) => (
                          <li key={it.code}>
                            {it.quantity} ×{' '}
                            <span className="font-medium">{it.name}</span>{' '}
                            <span className="font-mono text-muted-foreground">
                              ({it.code})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Imagen en grande con zoom */}
        <ImageLightbox
          open={!!previewPromo}
          onClose={() => setPreviewPromo(null)}
          src={previewPromo?.imageUrl}
          alt={previewPromo?.name ?? 'Promoción'}
          title={previewPromo?.name ?? ''}
          subtitle={
            previewPromo && (
              <span className="font-mono">{previewPromo.code}</span>
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
