// ImageLightbox - visor de imagen a PANTALLA COMPLETA estilo galeria (fondo
// oscuro, barra superior con titulo y controles). Reutilizable en el POS
// (kits al inscribir, promociones vigentes...). Zoom con rueda del mouse,
// doble clic (100% <-> 200%) o botones; con zoom el area scrollea.
//
// Se usa pantalla completa (no un dialog angosto) para que la imagen NUNCA
// se recorte: al 100% se ajusta con unidades de viewport (92vw / alto libre)
// y el zoom escala sobre ese base.

import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ImageOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

  useEffect(() => {
    if (open) setZoom(1);
  }, [open, src]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Alto disponible: viewport menos barra superior (56px) y footer (60px).
  const maxH = footer ? 'calc(100vh - 128px)' : 'calc(100vh - 72px)';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        // sm:max-w-none es OBLIGATORIO: el DialogContent base trae sm:max-w-lg
        // (512px) y un max-w-none "a secas" no anula la variante sm: — el visor
        // quedaba como columna de 512px pegada a la izquierda.
        className="inset-0 left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black/95 p-0 sm:max-w-none"
      >
        {/* Barra superior: titulo + controles (patron visor de galeria) */}
        <div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between gap-4 px-4">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold text-white">
              {title}
            </DialogTitle>
            {subtitle && (
              <DialogDescription className="flex items-center gap-2 text-xs text-white/60">
                {subtitle}
              </DialogDescription>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {src && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                  disabled={zoom <= MIN_ZOOM}
                  title="Alejar"
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span className="min-w-12 text-center font-mono text-xs text-white/70">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
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
                  className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={() => setZoom(1)}
                  disabled={zoom === 1}
                  title="Tamaño original"
                >
                  <RotateCcw className="size-4" />
                </Button>
                <div className="mx-1 h-5 w-px bg-white/20" />
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Area de imagen: centrada; con zoom scrollea para recorrerla */}
        <div
          className="h-full w-full overflow-auto pt-14"
          style={footer ? { paddingBottom: 60 } : undefined}
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
                className="select-none"
                style={
                  zoom === 1
                    ? { maxHeight: maxH, maxWidth: '92vw', objectFit: 'contain' }
                    : { width: `${zoom * 92}vw`, maxWidth: 'none' }
                }
                title="Doble clic o rueda del mouse para hacer zoom"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-16 text-white/60">
                <ImageOff className="size-10" />
                <span className="text-sm">Sin imagen cargada</span>
              </div>
            )}
          </div>
        </div>

        {/* Barra inferior opcional (precio / accion) */}
        {footer && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex h-[60px] items-center justify-between border-t border-white/10 bg-background px-5">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
