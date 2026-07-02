// LogoMark - Marca grafica oficial de Tonic Life.
//
// Usa los SVGs reales en public/images/logo/ (mismos archivos que toniclife-next).
// Variantes:
//   - 'white'      : circulo blanco sobre fondo oscuro (loading screen, activation)
//   - 'dark'       : circulo oscuro relleno (sobre fondo claro)
//   - 'icon-green' : solo el icono solido verde (sin circulo)
//   - 'icon-blue'  : solo el icono solido azul (sin circulo)
//   - 'text-light' / 'text-dark' : logotipo con texto
//
// Prop `avatar`: cuando true, envuelve el SVG en un circulo blanco tipo
// avatar (util para iconos solidos sobre fondos oscuros — ej. header POS).

import { cn } from '@/lib/utils';

type LogoVariant =
  | 'white'
  | 'dark'
  | 'blue-outline'
  | 'icon-green'
  | 'icon-blue'
  | 'text-light'
  | 'text-dark';

interface LogoMarkProps {
  size?: number;
  className?: string;
  variant?: LogoVariant;
  alt?: string;
  /** Envuelve el icono en un circulo blanco (estilo avatar). */
  avatar?: boolean;
}

// Rutas RELATIVAS (sin "/" inicial): la app empaquetada carga con file:// y
// una ruta absoluta apuntaría a la raíz del disco. El POS es una SPA con el
// index.html en la raíz de dist/, así que lo relativo siempre resuelve bien
// (también en el dev server).
const LOGO_SRC: Record<LogoVariant, string> = {
  white: 'images/logo/svg/logo-circle-white.svg',
  dark: 'images/logo/svg/logo-circle-dark-filled.svg',
  'blue-outline': 'images/logo/svg/logo-circle-blue-outline.svg',
  'icon-green': 'images/logo/svg/logo-icon-green-solid.svg',
  'icon-blue': 'images/logo/svg/logo-icon-blue-solid.svg',
  'text-light': 'images/logo/svg/logo-text-light.svg',
  'text-dark': 'images/logo/svg/logo-text-dark.svg',
};

export function LogoMark({
  size = 48,
  className,
  variant = 'white',
  alt = 'Tonic Life',
  avatar = false,
}: LogoMarkProps) {
  const img = (
    <img
      src={LOGO_SRC[variant]}
      // En modo avatar, el icono ocupa ~72% del circulo para que se note.
      width={avatar ? Math.round(size * 0.72) : size}
      height={avatar ? Math.round(size * 0.72) : size}
      alt={alt}
      className={cn('object-contain select-none', avatar ? '' : className)}
      draggable={false}
    />
  );

  if (!avatar) return img;

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-white shadow-sm',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {img}
    </div>
  );
}
