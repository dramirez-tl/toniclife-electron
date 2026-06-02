// InventoryLockScreen.tsx - Pantalla full-screen que bloquea el POS mientras
// Operaciones realiza el conteo de inventario de la sucursal. No es cerrable;
// desaparece sola cuando el backend emite el desbloqueo (pos:lock locked=false).

import { LogoMark } from '@/components/LogoMark';

interface InventoryLockScreenProps {
  message?: string | null;
  branchName?: string;
}

export function InventoryLockScreen({ message, branchName }: InventoryLockScreenProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-primary text-primary-foreground">
      {/* Sello/marca de agua: logo grande, muy tenue, centrado detrás del contenido */}
      <LogoMark
        variant="white"
        size={760}
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.06]"
      />

      {/* Contenido */}
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-10 text-white"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-bold">Inventario en progreso</h1>
          {branchName && (
            <p className="mt-1 text-sm text-white/70">Sucursal {branchName}</p>
          )}
          <p className="mt-4 text-base leading-relaxed text-white/85">
            {message ||
              'No se pueden realizar movimientos en esta sucursal hasta que finalice el conteo de inventario.'}
          </p>
          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-white/50">
            <span className="inline-block size-2 rounded-full bg-white/80 animate-pulse" />
            La terminal se reactivará automáticamente cuando Operaciones termine.
          </p>
        </div>
      </div>
    </div>
  );
}
