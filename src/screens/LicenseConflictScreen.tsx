// LicenseConflictScreen - Pantalla que se muestra cuando la API responde 409:
// la licencia ya fue activada en otro equipo. Replica la segunda captura.

import { useEffect } from 'react';
import { ShieldX, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HardwareFingerprint, LicenseConflictPayload } from '@/types';

interface LicenseConflictScreenProps {
  conflict: LicenseConflictPayload;
  currentHardware: HardwareFingerprint | null;
  onBack: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function shortHwId(fingerprint: string): string {
  return `HW-${fingerprint.slice(0, 4).toUpperCase()}:${fingerprint
    .slice(4, 8)
    .toUpperCase()}:${fingerprint.slice(8, 12).toUpperCase()}:${fingerprint
    .slice(12, 16)
    .toUpperCase()}`;
}

export function LicenseConflictScreen({
  conflict,
  currentHardware,
  onBack,
}: LicenseConflictScreenProps) {
  useEffect(() => {
    window.toniclife.window
      .setTitle('Tonic Life POS · Licencia en uso')
      .catch(() => {});
  }, []);

  return (
    <div className="h-full w-full bg-background flex items-center justify-center px-8">
      <div className="max-w-xl w-full text-center">
        <div className="mx-auto w-20 h-20 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
          <ShieldX className="size-9" />
        </div>

        <h1 className="mt-6 text-2xl font-bold text-foreground">
          Esta licencia ya esta en uso
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          La clave{' '}
          <span className="font-mono bg-muted text-foreground px-2 py-0.5 rounded">
            {conflict.licenseKey}
          </span>{' '}
          fue activada anteriormente en otro equipo. Una licencia solo puede
          operar en una maquina.
        </p>

        <Card className="mt-6 px-2 py-4 text-left text-sm">
          <div className="px-4 space-y-1">
            <Row label="Activada el" value={formatDate(conflict.activatedAt)} />
            <Row
              label="Equipo vinculado"
              value={shortHwId(conflict.existingHardwareFingerprint)}
              mono
            />
            <Row
              label="Sucursal"
              value={`${conflict.branch.code} — ${conflict.branch.name}`}
            />
            <Row
              label="Equipo actual"
              value={
                currentHardware ? shortHwId(currentHardware.fingerprint) : '—'
              }
              mono
              highlightRed
            />
          </div>
        </Card>

        <p className="mt-6 text-sm text-muted-foreground">
          Contacta a Sistemas para liberar la licencia del equipo anterior antes
          de activarla aqui.
        </p>

        <Button
          variant="outline"
          size="lg"
          onClick={onBack}
          className="mt-6"
        >
          <ArrowLeft />
          Volver
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  highlightRed,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlightRed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          mono ? 'font-mono text-xs' : 'font-semibold text-foreground',
          highlightRed ? 'text-destructive' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
