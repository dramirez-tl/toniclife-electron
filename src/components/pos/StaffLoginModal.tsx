// StaffLoginModal - Login OCULTO del modo staff (se abre con clic al logo).
// Call center / corporativo entra con SU cuenta (la misma del admin web) y
// elige la sucursal a operar. La autorización la decide el server:
// /pos/staff/branches responde 403 si el rol no puede operar el POS.

import { useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  staffAuthenticate,
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

export function StaffLoginModal({
  isOpen,
  onClose,
  terminalBranchId,
  onEntered,
}: StaffLoginModalProps) {
  const [step, setStep] = useState<'login' | 'branch'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [auth, setAuth] = useState<StaffAuthResult | null>(null);
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const staff = useStaffSession();
  // El flujo "vive" mientras el modal no se cierre: un login que resuelve
  // DESPUÉS de cerrar el modal se descarta (no debe quedar sesión invisible).
  const flowIdRef = useRef(0);

  const reset = () => {
    flowIdRef.current += 1;
    setStep('login');
    setIdentifier('');
    setPassword('');
    setAuth(null);
    setBranchId('');
    setBusy(false);
  };

  const handleClose = () => {
    // Cerrar sin haber confirmado sucursal = no queda sesión staff a medias
    // (cubre el paso de sucursal Y cualquier estado intermedio del store).
    if (staff.user && !staff.selectedBranch) staff.end();
    reset();
    onClose();
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !password || busy) return;
    setBusy(true);
    const flowId = flowIdRef.current;
    try {
      const result = await staffAuthenticate(identifier.trim(), password);
      if (flowIdRef.current !== flowId) return; // el modal se cerró en vuelo
      setAuth(result);
      // Preselección: la sucursal de la terminal si está en la lista.
      const preferred =
        result.branches.find((b) => b.id === terminalBranchId) ??
        result.branches[0];
      setBranchId(preferred.id);
      setStep('branch');
    } catch (err) {
      if (flowIdRef.current !== flowId) return;
      const e = err as StaffLoginError;
      toast.error(e.message || 'No se pudo iniciar sesión');
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-violet-600" />
            Acceso de personal autorizado
          </DialogTitle>
        </DialogHeader>

        {step === 'login' ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Para call center y corporativo: entra con tu cuenta (la misma del
              panel administrativo) para operar el POS a nombre de una
              sucursal. Cada movimiento quedará registrado a tu nombre.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Correo o usuario</Label>
              <Input
                id="staff-email"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="correo@toniclife.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Contraseña</Label>
              <Input
                id="staff-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                autoComplete="off"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Hola <span className="font-semibold">{auth?.user.fullName}</span>.
              Elige la sucursal a operar:
            </p>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sucursal…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(auth?.branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.code} — {b.name}
                    {b.isCedea ? ' · CEDEA' : ''}
                    {b.currencyCode && b.currencyCode !== 'MXN'
                      ? ` (${b.currencyCode})`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              El catálogo, precios, stock, folios y caja serán los de la
              sucursal elegida. Puedes cambiarla en cualquier momento desde la
              barra morada.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          {step === 'login' ? (
            <Button onClick={handleLogin} disabled={busy || !identifier || !password}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Iniciar sesión
            </Button>
          ) : (
            <Button onClick={handleEnter} disabled={!branchId}>
              Entrar en modo staff
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
