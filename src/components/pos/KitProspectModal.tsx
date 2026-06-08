// KitProspectModal - Inscripcion de un nuevo distribuidor al vender un kit.
// Portado de toniclife-next KitProspectModal.
//
// Flujo: se detecta un producto kit (productType='kit' + kitPosition) ->
// se requiere un patrocinador (el cliente del carrito) -> se capturan los
// datos del prospecto -> POST /customers/kit-enrollment -> al exito el POS
// cambia el cliente al nuevo distribuidor y agrega el kit al carrito.

import { useEffect, useState } from 'react';
import { X, UserPlus, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEnrollKit } from '@/hooks/usePos';
import type {
  QuickProduct,
  KitEnrollmentResponse,
} from '@/types/pos';

interface KitSponsor {
  id: string;
  name: string;
}

interface KitProspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  sponsor: KitSponsor | null;
  kit: QuickProduct | null;
  branchId: string;
  onEnrolled: (result: KitEnrollmentResponse, kit: QuickProduct) => void;
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  mothersLastName: '',
  email: '',
  phone: '',
  rfc: '',
};

export function KitProspectModal({
  isOpen,
  onClose,
  sponsor,
  kit,
  branchId,
  onEnrolled,
}: KitProspectModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [sendEmail, setSendEmail] = useState(true);
  const [result, setResult] = useState<KitEnrollmentResponse | null>(null);
  const enroll = useEnrollKit();

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setSendEmail(true);
      setResult(null);
    }
  }, [isOpen]);

  const set = (k: keyof typeof EMPTY_FORM, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    !!sponsor &&
    !!kit &&
    !!kit.kitPosition &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    !enroll.isPending;

  async function handleSubmit() {
    if (!canSubmit || !sponsor || !kit) return;
    try {
      const resp = await enroll.mutateAsync({
        sponsorCustomerId: sponsor.id,
        kitProductId: kit.id,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        mothersLastName: form.mothersLastName.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim(),
        rfc: form.rfc.trim() || undefined,
        branchId,
        sendCredentialsByEmail: sendEmail,
      });
      setResult(resp);
      toast.success(`Distribuidor inscrito: ${resp.customerNumber}`);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message || 'Error al inscribir al distribuidor',
      );
    }
  }

  function handleContinue() {
    if (result && kit) {
      onEnrolled(result, kit);
    }
    onClose();
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !enroll.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (enroll.isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (enroll.isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Inscripcion de distribuidor
              </DialogTitle>
              {kit && (
                <DialogDescription className="text-xs">
                  Kit {kit.sku} — {kit.name}
                  {kit.kitPosition ? ` (${kit.kitPosition})` : ''}
                </DialogDescription>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !enroll.isPending && onClose()}
            disabled={enroll.isPending}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* SUCCESS VIEW */}
        {result ? (
          <div className="px-6 py-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="size-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="size-7" />
              </div>
              <h3 className="text-lg font-bold text-foreground">
                {result.fullName}
              </h3>
              <p className="text-sm text-muted-foreground">
                Numero de distribuidor:{' '}
                <span className="font-mono font-semibold text-foreground">
                  {result.customerNumber}
                </span>
              </p>
            </div>

            <Card className="gap-2 rounded-lg bg-muted/40 p-4 text-sm shadow-none">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Contrasena temporal</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(result.tempPassword)
                      .then(() => toast.success('Contrasena copiada'))
                      .catch(() => {});
                  }}
                  className="h-auto gap-1 p-0 font-mono font-semibold text-foreground hover:text-primary"
                >
                  {result.tempPassword}
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {result.emailSent
                  ? 'Las credenciales se enviaron por correo al distribuidor.'
                  : 'Anota la contrasena: no se volvera a mostrar.'}
              </p>
            </Card>

            {result.sponsorBonus && (
              <Card className="gap-0 rounded-lg border-emerald-200 bg-emerald-50 p-4 text-sm shadow-none">
                <p className="font-semibold text-emerald-900 mb-1">
                  Bono al patrocinador
                </p>
                <p className="text-emerald-800">
                  {sponsor?.name ?? 'El sponsor'} recibira{' '}
                  <span className="font-bold">
                    {result.sponsorBonus.currencyCode}{' '}
                    {result.sponsorBonus.amount.toLocaleString('es-MX', {
                      minimumFractionDigits: 2,
                    })}
                  </span>{' '}
                  por esta inscripcion ({result.sponsorBonus.countryCode}).
                </p>
                <p className="text-[11px] text-emerald-700 mt-1">
                  El pago se procesa en el siguiente ciclo de comisiones.
                </p>
              </Card>
            )}

            <p className="text-xs text-muted-foreground text-center">
              El kit se agregara al carrito y el cliente cambiara al nuevo
              distribuidor para cobrar la inscripcion.
            </p>

            <Button className="w-full" onClick={handleContinue}>
              Continuar al cobro del kit
            </Button>
          </div>
        ) : (
          /* FORM VIEW */
          <div className="px-6 py-5 space-y-4">
            {/* Patrocinador */}
            <Card className="block gap-0 rounded-lg bg-primary/5 px-4 py-2.5 text-sm shadow-none">
              <span className="text-muted-foreground">Patrocinador: </span>
              <span className="font-medium text-foreground">
                {sponsor?.name ?? '— sin patrocinador —'}
              </span>
            </Card>

            {!sponsor && (
              <p className="text-xs text-destructive">
                Debes seleccionar primero al distribuidor patrocinador en el
                carrito.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre(s) *">
                <Input
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Apellido paterno *">
                <Input
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                />
              </Field>
              <Field label="Apellido materno">
                <Input
                  value={form.mothersLastName}
                  onChange={(e) => set('mothersLastName', e.target.value)}
                />
              </Field>
              <Field label="RFC (opcional)">
                <Input
                  value={form.rfc}
                  onChange={(e) =>
                    set('rfc', e.target.value.toUpperCase())
                  }
                  maxLength={13}
                  className="font-mono"
                />
              </Field>
              <Field label="Correo electronico *">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label="Telefono *">
                <Input
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>
            </div>

            <Label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={sendEmail}
                onCheckedChange={(c) => setSendEmail(c === true)}
              />
              Enviar credenciales por correo al distribuidor
            </Label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={enroll.isPending}
              >
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {enroll.isPending ? 'Inscribiendo...' : 'Inscribir distribuidor'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </Label>
      {children}
    </div>
  );
}
