// KitDestinationSheet - "¿Para quién es el kit?" (panel lateral al 50 %).
//
// Con un cliente asignado a la venta, un kit de inscripción tiene DOS destinos
// válidos: la RECOMPRA / reactivación del propio cliente o la inscripción de
// un NUEVO distribuidor patrocinado por él (PosScreen.handleKitDetected).
//
// Antes era un diálogo chico al centro y, con un nombre largo, el botón se
// salía del cuadro (13-nov-2026, arranque del Buen Fin con el kit KPM14).
// Ahora es un panel lateral como el de "Registrar distribuidor": muestra el
// kit, lo que se cobrará HOY (con la promoción de temporada, que en el
// catálogo no se ve) y las dos opciones explicadas. Solo presenta: qué pasa
// con cada opción lo decide PosScreen.

import { useEffect, useRef, useState, type Ref } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Package,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { nowLocalIso } from '@/lib/date';
import { kitPositionLabel, kitPriceToday } from '@/lib/kitDestination';
import {
  isOutOfStock,
  kitUnavailableMessage,
  stockShortLabel,
} from '@/lib/kitStock';
import { posApi } from '@/lib/posApi';
import { cn } from '@/lib/utils';
import { usePosCartStore } from '@/stores/pos-cart.store';
import type { QuickProduct } from '@/types/pos';

interface KitDestinationSheetProps {
  /** Kit elegido en el catálogo; null = panel cerrado. */
  kit: QuickProduct | null;
  /** Cliente asignado a la venta (el que recompra o el que patrocina). */
  customerName?: string | null;
  customerNumber?: string | null;
  currencySymbol: string;
  onClose: () => void;
  /** Recompra / reactivación: el kit es para el cliente de la venta. */
  onForCustomer: (kit: QuickProduct) => void;
  /** Inscripción de un nuevo distribuidor patrocinado por el cliente. */
  onEnrollNew: (kit: QuickProduct) => void;
}

export function KitDestinationSheet({
  kit,
  customerName,
  customerNumber,
  currencySymbol,
  onClose,
  onForCustomer,
  onEnrollNew,
}: KitDestinationSheetProps) {
  // El panel tarda ~300 ms en deslizarse al cerrar y para entonces `kit` ya es
  // null: se conserva el último para no vaciar el contenido a media animación.
  const [lastKit, setLastKit] = useState<QuickProduct | null>(kit);
  useEffect(() => {
    if (kit) setLastKit(kit);
  }, [kit]);
  const shown = kit ?? lastKit;

  const seasonal = usePosCartStore((s) => s.seasonal);
  const forCustomerRef = useRef<HTMLButtonElement>(null);
  const enrollRef = useRef<HTMLButtonElement>(null);

  const name = customerName?.trim() || 'el cliente de la venta';
  const out = !!shown && isOutOfStock(shown);
  const stockLabel = shown ? stockShortLabel(shown) : null;
  const position = shown ? kitPositionLabel(shown.kitPosition) : null;
  // Mismo motor y misma hora local que el carrito: lo que aquí se anuncia es
  // lo que el carrito pondrá en el renglón al agregar el kit.
  const today = shown
    ? kitPriceToday(shown, seasonal, nowLocalIso(seasonal.timezone))
    : null;
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  return (
    <Sheet
      open={!!kit}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Panel lateral al 50 % de la pantalla, igual que "Registrar distribuidor". */}
      <SheetContent
        side="right"
        className="w-1/2 gap-0 overflow-y-auto p-0 sm:max-w-none"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          // El foco cae en la primera opción disponible (no en la X): con el
          // teclado, Enter sigue eligiendo la recompra como en el diálogo de
          // antes. Sin desplazar: en pantallas bajas el panel abría ya corrido
          // y el kit quedaba cortado bajo el encabezado.
          e.preventDefault();
          (out ? enrollRef : forCustomerRef).current?.focus({
            preventScroll: true,
          });
        }}
      >
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between space-y-0 border-b bg-background px-6 py-4 text-left">
          <div className="flex items-center gap-2">
            <Package className="size-5 shrink-0 text-primary" />
            <div>
              <SheetTitle className="text-lg font-bold text-foreground">
                ¿Para quién es el kit?
              </SheetTitle>
              <SheetDescription className="text-xs">
                Elige si lo compra el cliente de la venta o si es la
                inscripción de un nuevo distribuidor.
              </SheetDescription>
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
        </SheetHeader>

        {shown && today && (
          <div className="mx-auto w-full max-w-2xl space-y-4 px-6 py-5">
            {/* El kit y lo que se cobrará hoy */}
            <Card className="flex-row items-center gap-4 rounded-xl p-4 shadow-none">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {shown.imageUrl ? (
                  <img
                    src={shown.imageUrl}
                    alt={shown.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <Package className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-semibold leading-snug text-foreground">
                  {shown.name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{shown.sku}</span>
                  {position && (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {position}
                    </Badge>
                  )}
                  {stockLabel &&
                    (out ? (
                      <Badge
                        variant="destructive"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        Agotado en esta sucursal
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-800"
                      >
                        Disponible · {stockLabel}
                      </Badge>
                    ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {today.promo && (
                  <div className="text-xs text-muted-foreground line-through tabular-nums">
                    {fmt(today.listPrice)}
                  </div>
                )}
                <div
                  className="text-xl font-bold tabular-nums text-foreground"
                  data-testid="kit-destination-price"
                >
                  {fmt(today.price)}
                </div>
                {today.points > 0 && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {today.points.toLocaleString('es-MX')} pts
                  </div>
                )}
              </div>
            </Card>

            {/* Promoción de temporada: en el catálogo el kit sale a precio de lista. */}
            {today.promo && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    {today.promo.seasonName
                      ? `${today.promo.seasonName}: `
                      : ''}
                    {today.promo.name}
                  </p>
                  <p className="text-emerald-800">
                    El precio especial se aplica solo al agregar el kit al
                    carrito.
                    {today.promo.excludesKitBonus
                      ? ' Con esta promoción la inscripción no genera Bono de Inscripción.'
                      : ''}
                  </p>
                </div>
              </div>
            )}

            {out && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="size-4 text-amber-700" />
                <AlertTitle>Kit {shown.sku} agotado en esta sucursal</AlertTitle>
                <AlertDescription className="text-amber-800">
                  {kitUnavailableMessage(shown)}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Cliente de la venta:{' '}
                <span className="font-semibold text-foreground">{name}</span>
                {customerNumber ? (
                  <span className="font-mono"> · #{customerNumber}</span>
                ) : null}
              </p>

              <DestinationOption
                ref={forCustomerRef}
                primary
                icon={UserCheck}
                title={`Es para ${name}`}
                description="Recompra o reactivación. El kit se agrega a esta venta y sus puntos se le acreditan al cobrar."
                unavailable={
                  out ? 'No se puede agregar: el kit está agotado aquí.' : null
                }
                onClick={() => onForCustomer(shown)}
                testId="kit-destination-customer"
              />
              <DestinationOption
                ref={enrollRef}
                icon={UserPlus}
                title="Inscribir a un nuevo distribuidor"
                description={`${name} queda como patrocinador. Capturas los datos del nuevo distribuidor y el kit se cobra a su nombre.`}
                onClick={() => onEnrollNew(shown)}
                testId="kit-destination-enroll"
              />
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Opción grande: icono, título y a qué lleva. El texto se parte en renglones
 *  (nunca se sale del panel, por largo que sea el nombre del cliente). */
function DestinationOption({
  ref,
  primary = false,
  icon: Icon,
  title,
  description,
  unavailable = null,
  onClick,
  testId,
}: {
  ref?: Ref<HTMLButtonElement>;
  primary?: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Motivo por el que la opción no se puede elegir; null = disponible. */
  unavailable?: string | null;
  onClick: () => void;
  testId: string;
}) {
  // Una opción que no se puede elegir se pinta apagada pero LEGIBLE (el motivo
  // es lo que el cajero necesita leer), no con la opacidad del botón deshabilitado.
  const solid = primary && !unavailable;
  return (
    <Button
      ref={ref}
      type="button"
      variant={solid ? 'default' : 'outline'}
      disabled={!!unavailable}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'h-auto w-full justify-start gap-3 whitespace-normal rounded-xl px-4 py-4 text-left',
        unavailable &&
          'border-dashed bg-muted/40 shadow-none disabled:opacity-100',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          solid
            ? 'bg-primary-foreground/15'
            : unavailable
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block break-words text-base font-semibold leading-snug',
            unavailable && 'text-muted-foreground',
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'mt-0.5 block text-sm font-normal leading-snug',
            solid ? 'text-primary-foreground/85' : 'text-muted-foreground',
          )}
        >
          {description}
        </span>
        {unavailable && (
          <span className="mt-1 block text-sm font-medium text-destructive">
            {unavailable}
          </span>
        )}
      </span>
      {!unavailable && <ChevronRight className="size-5 shrink-0 opacity-70" />}
    </Button>
  );
}
