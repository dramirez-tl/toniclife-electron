// ResizeHandle - Divisor vertical arrastrable para ajustar el ancho del panel
// del carrito. El carrito vive a la DERECHA, asi que arrastrar hacia la
// izquierda lo ensancha. Soporta teclado (flechas) y doble-click para resetear.

import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  /** Ancho actual del panel (px). */
  width: number;
  min: number;
  max: number;
  /** Ancho al que vuelve con doble-click. */
  defaultWidth?: number;
  /** Se llama en cada movimiento (resize en vivo). */
  onResize: (width: number) => void;
  /** Se llama al soltar / confirmar (persistir). */
  onCommit?: (width: number) => void;
  className?: string;
}

export function ResizeHandle({
  width,
  min,
  max,
  defaultWidth,
  onResize,
  onCommit,
  className,
}: ResizeHandleProps) {
  const lastRef = useRef(width);

  function clamp(w: number) {
    return Math.min(max, Math.max(min, Math.round(w)));
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    lastRef.current = width;

    const onMove = (ev: MouseEvent) => {
      // El panel esta a la derecha: mover el cursor a la izquierda lo agranda.
      const next = clamp(startWidth + (startX - ev.clientX));
      lastRef.current = next;
      onResize(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onCommit?.(lastRef.current);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const STEP = 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = clamp(width + STEP);
      onResize(next);
      onCommit?.(next);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = clamp(width - STEP);
      onResize(next);
      onCommit?.(next);
    }
  }

  function handleDoubleClick() {
    if (defaultWidth == null) return;
    const next = clamp(defaultWidth);
    onResize(next);
    onCommit?.(next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ajustar ancho del carrito"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group relative w-px shrink-0 cursor-col-resize bg-border outline-none',
        'focus-visible:bg-primary',
        className,
      )}
      title="Arrastra para ajustar el carrito (doble-click para restablecer)"
    >
      {/* Zona de agarre invisible mas ancha que la linea visible. */}
      <div className="absolute inset-y-0 -left-2 -right-2 z-10" />
      {/* Resalte de la linea al pasar el mouse / foco. */}
      <div className="absolute inset-0 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      {/* Asa central. */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 flex h-10 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <GripVertical className="size-3" />
      </div>
    </div>
  );
}
