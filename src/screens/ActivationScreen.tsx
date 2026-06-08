// ActivationScreen - Primera pantalla que ve el cajero al instalar la terminal.
//
// Layout:
//   - Panel izquierdo (bg-primary = teal de marca): logo + instrucciones.
//   - Panel derecho (bg-background): input shadcn + identificador del equipo
//     + boton "Activar terminal" + boton shortcut (rayo, solo dev).
//
// Feedback:
//   - Errores bloqueantes -> Alert destructive inline (queda visible).
//   - Acciones transitorias (copiado, dev shortcut) -> sonner toast.

import { useEffect, useState } from 'react';
import {
  Shield,
  Monitor,
  Headphones,
  Fingerprint,
  AlertCircle,
  FolderOpen,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { LogoMark } from '@/components/LogoMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type {
  HardwareFingerprint,
  ActivationResponse,
  LicenseConflictPayload,
} from '@/types';
import { activateLicense } from '@/lib/activation';

interface ActivationScreenProps {
  hardware: HardwareFingerprint | null;
  onActivated: (response: ActivationResponse) => void;
  onConflict: (conflict: LicenseConflictPayload) => void;
}

const LICENSE_KEY_REGEX = /^TONC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function formatLicenseInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const segments: string[] = [];
  if (clean.length > 0) segments.push(clean.slice(0, 4));
  if (clean.length > 4) segments.push(clean.slice(4, 8));
  if (clean.length > 8) segments.push(clean.slice(8, 12));
  if (clean.length > 12) segments.push(clean.slice(12, 16));
  return segments.join('-');
}

export function ActivationScreen({
  hardware,
  onActivated,
  onConflict,
}: ActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState<string>('');

  useEffect(() => {
    window.toniclife.window
      .setTitle('Tonic Life POS · Activacion de Terminal')
      .catch(() => {});
    // Diagnostico: ruta donde se guarda la sesion/licencia.
    window.toniclife.app
      .getUserDataPath()
      .then(setUserDataPath)
      .catch(() => {});
  }, []);

  const isValid = LICENSE_KEY_REGEX.test(licenseKey);
  const canSubmit = isValid && !!hardware && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit || !hardware) return;
    setIsSubmitting(true);
    setError(null);

    const result = await activateLicense({ licenseKey, hardware });
    setIsSubmitting(false);

    switch (result.kind) {
      case 'ok':
        onActivated(result.data);
        return;
      case 'conflict':
        onConflict(result.conflict);
        return;
      case 'not-found':
        setError(
          'La licencia no existe. Verifica que la escribiste correctamente.',
        );
        return;
      case 'revoked':
        setError('Esta licencia fue revocada. Solicita una nueva a Sistemas.');
        return;
      case 'network-error':
        setError(`Sin conexion con el servidor: ${result.message}`);
        return;
      case 'unknown-error':
        setError(result.message);
    }
  }

  const hwId = hardware
    ? `HW-${hardware.fingerprint.slice(0, 4).toUpperCase()}:${hardware.fingerprint
        .slice(4, 8)
        .toUpperCase()}:${hardware.fingerprint
        .slice(8, 12)
        .toUpperCase()}:${hardware.fingerprint.slice(12, 16).toUpperCase()}`
    : null;
  const cpuShort = hardware?.info.cpuModel.split(' ').slice(0, 2).join('-');
  const macShort = hardware?.info.primaryMac.replaceAll(':', '').toUpperCase();

  return (
    <div className="flex h-full w-full">
      {/* Panel izquierdo: brand teal */}
      <div className="relative w-[42%] bg-primary text-primary-foreground px-10 py-12 flex flex-col overflow-hidden">
        {/* Sello: logo gigante semitransparente sobre el panel */}
        <LogoMark
          size={560}
          variant="blue-outline"
          className="pointer-events-none absolute -right-32 -bottom-24 rotate-[-12deg] opacity-[0.12]"
        />

        <div className="relative z-10 mt-10 flex-1">
          <h1 className="text-3xl font-bold leading-tight">
            Activacion de
            <br />
            Punto de Venta
          </h1>
          <p className="mt-4 text-sm text-white/80 leading-relaxed max-w-sm">
            Esta terminal aun no ha sido autorizada. Solicita tu clave al equipo
            de Sistemas para vincular este equipo de forma permanente.
          </p>
        </div>

        <div className="relative z-10 mt-auto text-xs text-white/70 space-y-1.5">
          <div className="flex items-center gap-2">
            <Shield className="size-3.5" /> Licencia vinculada por hardware
          </div>
          <div className="flex items-center gap-2">
            <Monitor className="size-3.5" /> Uso exclusivo en una maquina
          </div>
          <div className="flex items-center gap-2">
            <Headphones className="size-3.5" /> Soporte: soporte@toniclife.com
          </div>

          {/* Diagnostico: ruta del archivo de sesion */}
          {userDataPath && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
                <FolderOpen className="size-3" />
                Datos guardados en
              </div>
              <div className="font-mono text-[10px] text-white/60 break-all">
                {userDataPath}
              </div>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  navigator.clipboard
                    .writeText(userDataPath)
                    .then(() => toast.success('Ruta copiada'))
                    .catch(() => {});
                }}
                className="h-auto gap-1 p-0 text-[10px] font-normal text-white/70 hover:text-white"
              >
                <Copy className="size-3" />
                Copiar ruta
              </Button>
              <div className="text-[10px] text-white/50">
                La licencia se guarda en{' '}
                <span className="font-mono">session.json</span> dentro de esa
                carpeta.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 bg-background px-12 py-12 flex flex-col justify-center">
        <div className="max-w-md w-full">
          <h2 className="text-xl font-bold text-foreground">
            Ingresa tu clave de licencia
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Formato: <span className="font-mono">XXXX-XXXX-XXXX-XXXX</span>
          </p>

          <Input
            value={licenseKey}
            onChange={(e) => {
              setLicenseKey(formatLicenseInput(e.target.value));
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="TONC-XXXX-XXXX-XXXX"
            className="mt-5 h-12 text-center text-lg font-mono tracking-wider"
            maxLength={19}
            autoFocus
            spellCheck={false}
          />

          {/* Hardware identifier */}
          <div className="mt-4 rounded-xl border bg-muted/50 px-4 py-3">
            <Label className="text-xs font-medium text-muted-foreground">
              <Fingerprint className="size-3.5" />
              Identificador de este equipo
            </Label>
            <div className="mt-1.5 font-mono text-xs text-foreground/80 break-all">
              {hardware ? (
                <>
                  {hwId} · CPU-{cpuShort} · MAC-{macShort}
                </>
              ) : (
                'Calculando identificador del equipo...'
              )}
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Boton */}
          <Button
            type="button"
            size="xl"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="mt-5 w-full"
          >
            {isSubmitting ? 'Activando...' : 'Activar terminal'}
          </Button>
        </div>
      </div>
    </div>
  );
}
