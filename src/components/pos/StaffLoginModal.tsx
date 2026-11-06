// StaffLoginModal - Login OCULTO del modo staff (se abre con clic al logo).
// Call center / corporativo entra con SU cuenta (la misma del admin web) o
// con Google (se abre el navegador del SO; si esa cuenta de Google aún no está
// vinculada, confirma UNA vez con usuario + contraseña) y elige la sucursal a
// operar. La autorización la decide el server: /pos/staff/branches responde
// 403 si el rol no puede operar el POS.

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BranchSearchSelect } from '@/components/pos/BranchSearchSelect';
import {
  staffAuthenticate,
  staffAuthenticateGoogle,
  staffGoogleStatus,
  staffLinkGoogle,
  StaffLoginError,
  type StaffAuthResult,
} from '@/lib/staffApi';
import { useStaffSession, type StaffBranch } from '@/stores/staff-session.store';

interface StaffLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sucursal de la terminal (preselección si el usuario puede operarla). */
  terminalBranchId: string;
  /** Se llama al confirmar la sucursal: el POS queda en modo staff. */
  onEntered: (branch: StaffBranch) => void;
}

/** La "G" de Google (cuatro colores), sin assets. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function StaffLoginModal({
  isOpen,
  onClose,
  terminalBranchId,
  onEntered,
}: StaffLoginModalProps) {
  const [step, setStep] = useState<'login' | 'link' | 'branch'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [auth, setAuth] = useState<StaffAuthResult | null>(null);
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  // Google: client ID de escritorio si el API lo tiene encendido; mientras el
  // operador está en el navegador, el modal espera (googleWaiting).
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleWaiting, setGoogleWaiting] = useState(false);
  const [link, setLink] = useState<{ linkTicket: string; email: string } | null>(null);
  const staff = useStaffSession();
  // El flujo "vive" mientras el modal no se cierre: un login que resuelve
  // DESPUÉS de cerrar el modal se descarta (no debe quedar sesión invisible).
  const flowIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    staffGoogleStatus().then((s) => {
      if (alive) setGoogleClientId(s?.enabled && s.desktopClientId ? s.desktopClientId : null);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  const reset = () => {
    flowIdRef.current += 1;
    if (googleWaiting) void window.toniclife.google.cancel();
    setStep('login');
    setIdentifier('');
    setPassword('');
    setAuth(null);
    setBranchId('');
    setBusy(false);
    setGoogleWaiting(false);
    setLink(null);
  };

  const handleClose = () => {
    // Cerrar sin haber confirmado sucursal = no queda sesión staff a medias
    // (cubre el paso de sucursal Y cualquier estado intermedio del store).
    if (staff.user && !staff.selectedBranch) staff.end();
    reset();
    onClose();
  };

  /** Sesión del API creada y autorizada: pasar a elegir sucursal. */
  const afterAuth = (result: StaffAuthResult) => {
    setAuth(result);
    // Preselección: la sucursal de la terminal si está en la lista.
    const preferred =
      result.branches.find((b) => b.id === terminalBranchId) ??
      result.branches[0];
    setBranchId(preferred.id);
    setStep('branch');
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !password || busy) return;
    setBusy(true);
    const flowId = flowIdRef.current;
    try {
      const result = await staffAuthenticate(identifier.trim(), password);
      if (flowIdRef.current !== flowId) return; // el modal se cerró en vuelo
      afterAuth(result);
    } catch (err) {
      if (flowIdRef.current !== flowId) return;
      const e = err as StaffLoginError;
      toast.error(e.message || 'No se pudo iniciar sesión');
    } finally {
      if (flowIdRef.current === flowId) setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!googleClientId || busy) return;
    setBusy(true);
    setGoogleWaiting(true);
    const flowId = flowIdRef.current;
    try {
      const r = await staffAuthenticateGoogle(googleClientId);
      if (flowIdRef.current !== flowId) return;
      if (r.kind === 'link') {
        // Google no está vinculado a nadie: confirmar una vez con usuario + contraseña.
        setLink({ linkTicket: r.linkTicket, email: r.email });
        setIdentifier('');
        setPassword('');
        setStep('link');
        return;
      }
      afterAuth(r.result);
    } catch (err) {
      if (flowIdRef.current !== flowId) return;
      const e = err as StaffLoginError;
      if (e.kind !== 'cancelled') {
        toast.error(e.message || 'No se pudo iniciar sesión con Google');
      }
    } finally {
      if (flowIdRef.current === flowId) {
        setBusy(false);
        setGoogleWaiting(false);
      }
    }
  };

  const handleLink = async () => {
    if (!link || !identifier.trim() || !password || busy) return;
    setBusy(true);
    const flowId = flowIdRef.current;
    try {
      const result = await staffLinkGoogle(link.linkTicket, identifier.trim(), password);
      if (flowIdRef.current !== flowId) return;
      toast.success('Cuenta de Google vinculada: la próxima vez entras con un clic');
      afterAuth(result);
    } catch (err) {
      if (flowIdRef.current !== flowId) return;
      const e = err as StaffLoginError;
      toast.error(e.message || 'No se pudo vincular la cuenta');
    } finally {
      if (flowIdRef.current === flowId) setBusy(false);
    }
  };

  const handleEnter = () => {
    if (!auth) return;
    const branch = auth.branches.find((b) => b.id === branchId);
    if (!branch) return;
    // La sesión arranca AQUÍ (con el modal vivo y sucursal confirmada).
    staff.start(auth.user, auth.tokens, auth.branches);
    staff.selectBranch(branch);
    reset();
    onEntered(branch);
  };

  const credentialFields = (onEnter: () => void) => (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="staff-email">Correo o usuario</Label>
        <Input
          id="staff-email"
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          placeholder="correo@toniclife.com"
          autoComplete="off"
          disabled={busy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="staff-password">Contraseña</Label>
        <Input
          id="staff-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          autoComplete="off"
          disabled={busy}
        />
      </div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-violet-600" />
            Acceso de personal autorizado
          </DialogTitle>
        </DialogHeader>

        {step === 'login' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Para call center y corporativo: entra con tu cuenta (la misma del
              panel administrativo) para operar el POS a nombre de una
              sucursal. Cada movimiento quedará registrado a tu nombre.
            </p>
            {credentialFields(handleLogin)}
            {googleClientId && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  o
                  <div className="h-px flex-1 bg-border" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogle}
                  disabled={busy}
                >
                  {googleWaiting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <GoogleGlyph />
                  )}
                  {googleWaiting
                    ? 'Esperando a Google en el navegador…'
                    : 'Iniciar sesión con Google'}
                </Button>
                {googleWaiting && (
                  <p className="text-[11px] text-muted-foreground">
                    Se abrió tu navegador: elige tu cuenta de Google y vuelve al
                    POS. Si cierras esa pestaña, cancela aquí.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'link' && link && (
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-foreground">
              <p className="font-semibold">Vincula tu cuenta de Google</p>
              <p className="mt-1">
                La cuenta <span className="font-semibold">{link.email}</span> aún no
                está vinculada a ningún usuario. Confirma quién eres con tu usuario
                y contraseña; la próxima vez entrarás solo con Google.
              </p>
            </div>
            {credentialFields(handleLink)}
          </div>
        )}

        {step === 'branch' && (
          <div className="space-y-3">
            <p className="text-sm">
              Hola <span className="font-semibold">{auth?.user.fullName}</span>.
              Elige la sucursal a operar:
            </p>
            <BranchSearchSelect
              branches={auth?.branches ?? []}
              value={branchId}
              onSelect={(b) => setBranchId(b.id)}
              className="w-full"
            />
            <p className="text-[11px] text-muted-foreground">
              El catálogo, precios, stock, folios y caja serán los de la
              sucursal elegida. Puedes cambiarla en cualquier momento desde la
              barra morada.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'link' ? (
            <Button
              variant="outline"
              onClick={() => {
                setLink(null);
                setIdentifier('');
                setPassword('');
                setStep('login');
              }}
              disabled={busy}
            >
              Usar otra cuenta
            </Button>
          ) : (
            <Button variant="outline" onClick={handleClose} disabled={busy && !googleWaiting}>
              Cancelar
            </Button>
          )}
          {step === 'login' && (
            <Button onClick={handleLogin} disabled={busy || !identifier || !password}>
              {busy && !googleWaiting && <Loader2 className="size-4 animate-spin" />}
              Iniciar sesión
            </Button>
          )}
          {step === 'link' && (
            <Button onClick={handleLink} disabled={busy || !identifier || !password}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Vincular y entrar
            </Button>
          )}
          {step === 'branch' && (
            <Button onClick={handleEnter} disabled={!branchId}>
              Entrar en modo staff
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
