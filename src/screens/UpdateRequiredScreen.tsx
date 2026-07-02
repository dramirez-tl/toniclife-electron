// UpdateRequiredScreen.tsx - Overlay BLOQUEANTE cuando hay actualización lista.
//
// Por política de operación, la terminal no puede seguir usándose con versión
// vieja una vez descargada la nueva: este overlay cubre TODO (incluso el
// header) y la única acción posible es "Reiniciar y actualizar". No es
// cerrable. El carrito en curso no se pierde (persiste en localStorage).

import { useState } from 'react';
import { RefreshCw, Rocket } from 'lucide-react';
import { LogoMark } from '@/components/LogoMark';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';

interface UpdateRequiredScreenProps {
  version: string;
}

export function UpdateRequiredScreen({ version }: UpdateRequiredScreenProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = () => {
    setInstalling(true);
    void window.toniclife.updater.install();
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-primary text-primary-foreground">
      {/* Marca de agua */}
      <LogoMark
        variant="white"
        size={760}
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.06]"
      />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-8 p-8 text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
          <Rocket strokeWidth={1.5} className="size-12 text-white" />
        </div>

        <div className="max-w-xl">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
            Actualización obligatoria
          </div>
          <h1 className="mt-3 text-4xl font-bold">
            Nueva versión lista para instalar
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-white/85">
            La versión{' '}
            <span className="rounded bg-white/15 px-2 py-0.5 font-mono font-semibold">
              v{version}
            </span>{' '}
            ya se descargó en esta terminal. Para continuar usando el punto de
            venta es necesario reiniciar y aplicar la actualización — toma menos
            de un minuto.
          </p>
          <p className="mt-2 text-sm text-white/60">
            Versión actual: v{APP_VERSION}. Tu licencia, impresora y venta en
            curso se conservan.
          </p>
        </div>

        <Button
          size="lg"
          onClick={handleInstall}
          disabled={installing}
          className="h-16 min-w-96 bg-white text-lg font-bold text-primary hover:bg-white/90"
        >
          <RefreshCw className={`size-6 ${installing ? 'animate-spin' : ''}`} />
          {installing
            ? 'Instalando… la terminal se reiniciará sola'
            : 'Reiniciar y actualizar ahora'}
        </Button>
      </div>
    </div>
  );
}
