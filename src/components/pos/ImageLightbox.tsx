// ImageLightbox - visor de imagen en grande con ZOOM, reutilizable en el POS
// (kits al inscribir, promociones vigentes...). Zoom con rueda del mouse,
// doble clic (alterna 100% / 200%) o botones; con zoom el contenedor
// scrollea para recorrer la imagen.

import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface ImageLightboxProps {
  open: boolean;
  onClose: () => void;
  /** URL absoluta de la imagen; sin ella se muestra placeholder. */
  src?: string;
  alt: string;
  title: string;
  /** Linea secundaria del header (SKU, badges...). */
  subtitle?: React.ReactNode;
  /** Barra inferior opcional (precio, boton de accion...). */
  footer?: React.ReactNode;
}

export function ImageLightbox({
  open,
  onClose,
  src,
  alt,
  title,
  subtitle,
  footer,
}: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  // Ancho útil del contenedor de scroll: la imagen se ajusta a él al 100%
  // (sin recortarse contra el diálogo) y el zoom escala sobre ese base en
  // píxeles (un % contra un contenedor w-max no es determinista).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    // Medir tras el commit del DOM del dialog abierto.
    const id = requestAnimationFrame(() => {
      setBaseWidth(scrollRef.current?.clientWidth ?? null);
    });
    return () => cancelAnimationFrame(id);
  }, [open, src]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  // 32px = p-4 a cada lado del wrapper interior.
  const fitWidth = baseWidth ? baseWidth - 32 : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-base font-bold text-foreground">
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="flex items-center gap-2 text-xs">
              {subtitle}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="relative">
          <div
            ref={scrollRef}
            className="h-[62vh] overflow-auto bg-muted/30"
            onWheel={(e) => {
              if (!src) return;
              setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
            }}
            onDoubleClick={() => src && setZoom((z) => (z > 1 ? 1 : 2))}
          >
            <div className="flex min-h-full w-max min-w-full items-center justify-center p-4">
              {src ? (
                <img
                  src={src}
                  alt={alt}
                  draggable={false}
                  className="select-none rounded-md"
                  style={
                    zoom === 1
                      ? {
                          maxHeight: '56vh',
                          // Ajuste al ancho REAL del contenedor: sin esto la
                          // imagen ancha se recortaba contra el dialogo.
                          maxWidth: fitWidth ? `${fitWidth}px` : '100%',
                          objectFit: 'contain',
                        }
                      : {
                          width: fitWidth
                            ? `${fitWidth * zoom}px`
                            : `${zoom * 100}%`,
                          maxWidth: 'none',
                        }
                  }
                  title="Doble clic o rueda del mouse para hacer zoom"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                  <ImageOff className="size-10" />
                  <span className="text-sm">Sin imagen cargada</span>
                </div>
              )}
            </div>
          </div>

          {/* Controles de zoom */}
          {src && (
            <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                disabled={zoom <= MIN_ZOOM}
                title="Alejar"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="min-w-11 text-center font-mono text-[11px] text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                disabled={zoom >= MAX_ZOOM}
                title="Acercar"
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setZoom(1)}
                disabled={zoom === 1}
                title="Tamaño original"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {footer && (
          <div className="flex items-center justify-between border-t px-5 py-3">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
