// ComingSoonGate.tsx - Cuerpo bloqueado del POS.
//
// Se muestra en el área de venta (NO en el header) cuando la terminal no puede
// operar: candado del POS de la sucursal (CEDEAS › Punto de venta, mig 183) o el
// interruptor global pos.operations_enabled en false. Deja el header vivo para
// que la sucursal configure la impresora térmica; la pantalla se libera sola en
// el siguiente heartbeat (≤60 s). El texto "Próximamente / en preparación" era
// del rollout inicial por sucursal, que ya no se usa (Diego, 3-nov-2026).

import { Lock, Printer } from 'lucide-react';
import { LogoMark } from '@/components/LogoMark';

interface ComingSoonGateProps {
  message?: string | null;
  branchName?: string;
}

const DEFAULT_MESSAGE =
  'El punto de venta de esta sucursal está bloqueado. Comunícate con Tonic Life ' +
  'para liberarlo; en cuanto se libere, esta pantalla se activará automáticamente.';

export function ComingSoonGate({ message, branchName }: ComingSoonGateProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-primary text-primary-foreground">
      {/* Sello/marca de agua tenue */}
      <LogoMark
        variant="white"
        size={760}
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.06]"
      />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
          <Lock strokeWidth={1.5} className="size-10 text-white" />
        </div>

        <div className="max-w-lg">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            Acceso bloqueado
          </div>
          <h1 className="mt-2 text-3xl font-bold">Terminal bloqueada</h1>
          {branchName && (
            <p className="mt-1 text-sm text-white/70">Sucursal {branchName}</p>
          )}
          <p className="mt-4 text-base leading-relaxed text-white/85">
            {message || DEFAULT_MESSAGE}
          </p>

          <div className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80 ring-1 ring-white/15">
            <Printer strokeWidth={1.5} className="size-4 shrink-0" />
            Configura la impresora térmica desde el ícono de ajustes, arriba a la derecha.
          </div>

          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-white/50">
            <span className="inline-block size-2 rounded-full bg-white/80 animate-pulse" />
            La terminal se activará automáticamente cuando se libere.
          </p>
        </div>
      </div>
    </div>
  );
}
