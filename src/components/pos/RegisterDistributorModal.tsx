// RegisterDistributorModal - Alta de distribuidor desde el POS.
//
// A diferencia de KitProspectModal (que se dispara al agregar un kit), aqui el
// cajero da de alta a alguien tecleando el NUMERO del distribuidor patrocinador.
// El kit es OPCIONAL: puede registrar y cobrar el kit en el momento, o solo
// registrar (el nuevo distribuidor compra su kit despues).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, UserPlus, CheckCircle2, Copy, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRegisterDistributor, useRegisterPreferred } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import type {
  QuickProduct,
  KitEnrollmentResponse,
  SponsorLookup,
} from '@/types/pos';

interface RegisterDistributorModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  /** Código ISO del país de la sucursal (preselección del selector de país). */
  branchCountryCode?: string;
  /** Kits de inscripcion disponibles (productos isEnrollmentKit). */
  enrollmentKits: QuickProduct[];
  /** Llamado al terminar: si se eligio kit, se pasa para cobrarlo. */
  onRegistered: (result: KitEnrollmentResponse, kit: QuickProduct | null) => void;
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  mothersLastName: '',
  email: '',
  phone: '',
  rfc: '',
};

export function RegisterDistributorModal({
  isOpen,
  onClose,
  branchId,
  branchCountryCode,
  enrollmentKits,
  onRegistered,
}: RegisterDistributorModalProps) {
  const [sponsorNumber, setSponsorNumber] = useState('');
  const [sponsor, setSponsor] = useState<SponsorLookup | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [tipo, setTipo] = useState<'distribuidor' | 'preferente'>('distribuidor');
  const [form, setForm] = useState(EMPTY_FORM);
  const [countryId, setCountryId] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [chargeKit, setChargeKit] = useState(false);
  const [kitId, setKitId] = useState<string>('');
  const [result, setResult] = useState<KitEnrollmentResponse | null>(null);

  // País de residencia: define el portal, catálogo y precios del nuevo registro.
  const countriesQuery = useQuery({
    queryKey: ['active-countries'],
    queryFn: () => posApi.getActiveCountries(),
    enabled: isOpen,
    staleTime: 10 * 60 * 1000,
  });
  const countries = countriesQuery.data ?? [];

  const registerDistributor = useRegisterDistributor();
  const registerPreferred = useRegisterPreferred();
  const isPending = registerDistributor.isPending || registerPreferred.isPending;
  const tipoLabel = tipo === 'distribuidor' ? 'Distribuidor' : 'Cliente preferente';

  useEffect(() => {
    if (isOpen) {
      setTipo('distribuidor');
      setSponsorNumber('');
      setSponsor(null);
      setSponsorError(null);
      setForm(EMPTY_FORM);
      setCountryId('');
      setSendEmail(true);
      setChargeKit(false);
      setKitId('');
      setResult(null);
    }
  }, [isOpen]);

  // Preseleccionar el país de la sucursal en cuanto haya catálogo (el cajero
  // puede cambiarlo si el nuevo registro vive en otro país).
  useEffect(() => {
    if (!isOpen || countryId || countries.length === 0) return;
    const branchCountry = countries.find(
      (c) => c.code?.toUpperCase() === branchCountryCode?.toUpperCase(),
    );
    if (branchCountry) setCountryId(branchCountry.id);
  }, [isOpen, countryId, countries, branchCountryCode]);

  const set = (k: keyof typeof EMPTY_FORM, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleLookupSponsor() {
    const num = sponsorNumber.trim();
    if (!num) return;
    setLookingUp(true);
    setSponsorError(null);
    setSponsor(null);
    try {
      const found = await posApi.lookupSponsor(num);
      if (!found.isValid) {
        setSponsorError(
          found.customerType !== 'distributor'
            ? 'Ese número no es de un distribuidor.'
            : 'El distribuidor patrocinador no está activo.',
        );
        setSponsor(null);
      } else {
        setSponsor(found);
      }
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setSponsorError(e.response?.data?.message || 'Patrocinador no encontrado');
    } finally {
      setLookingUp(false);
    }
  }

  const selectedKit = enrollmentKits.find((k) => k.id === kitId) ?? null;

  const isDistribuidor = tipo === 'distribuidor';
  const canSubmit =
    !!sponsor?.isValid &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    !!countryId &&
    (!isDistribuidor || !chargeKit || !!kitId) &&
    !isPending;

  async function handleSubmit() {
    if (!canSubmit || !sponsor) return;
    const base = {
      sponsorCustomerNumber: sponsor.customerNumber,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      mothersLastName: form.mothersLastName.trim() || undefined,
      email: form.email.trim(),
      phone: form.phone.trim(),
      rfc: form.rfc.trim() || undefined,
      branchId,
      countryId: countryId || undefined,
      sendCredentialsByEmail: sendEmail,
    };
    try {
      const resp = isDistribuidor
        ? await registerDistributor.mutateAsync({
            ...base,
            kitProductId: chargeKit && kitId ? kitId : undefined,
          })
        : await registerPreferred.mutateAsync(base);
      setResult(resp);
      toast.success(`${tipoLabel} registrado: ${resp.customerNumber}`);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message ||
          `Error al registrar ${isDistribuidor ? 'al distribuidor' : 'al cliente preferente'}`,
      );
    }
  }

  function handleContinue() {
    if (result) {
      onRegistered(result, isDistribuidor && chargeKit ? selectedKit : null);
    }
    onClose();
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Registrar {isDistribuidor ? 'distribuidor' : 'cliente preferente'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Alta vinculada a un distribuidor patrocinador por su número.
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !isPending && onClose()}
            disabled={isPending}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {result ? (
          /* SUCCESS VIEW */
          <div className="px-6 py-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="size-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="size-7" />
              </div>
              <h3 className="text-lg font-bold text-foreground">{result.fullName}</h3>
              <p className="text-sm text-muted-foreground">
                Número de distribuidor:{' '}
                <span className="font-mono font-semibold text-foreground">
                  {result.customerNumber}
                </span>
              </p>
            </div>

            {result.emailSent && (
              <Card className="gap-0 rounded-lg border-emerald-200 bg-emerald-50 p-3 text-sm shadow-none">
                <p className="text-emerald-800">
                  Invitación enviada por correo. El distribuidor definirá su propia
                  contraseña desde el enlace.
                </p>
              </Card>
            )}

            {result.tempPassword && (
              <Card className="gap-2 rounded-lg bg-muted/40 p-4 text-sm shadow-none">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {result.emailSent
                      ? 'Contraseña temporal (respaldo)'
                      : 'Contraseña temporal'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(result.tempPassword ?? '')
                        .then(() => toast.success('Contraseña copiada'))
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
                    ? 'Respaldo presencial: también puede iniciar con esta contraseña.'
                    : 'Anota la contraseña: no se volverá a mostrar.'}
                </p>
              </Card>
            )}

            {result.sponsorBonus && (
              <Card className="gap-0 rounded-lg border-emerald-200 bg-emerald-50 p-4 text-sm shadow-none">
                <p className="font-semibold text-emerald-900 mb-1">
                  Bono al patrocinador
                </p>
                <p className="text-emerald-800">
                  {sponsor?.name ?? 'El sponsor'} recibirá{' '}
                  <span className="font-bold">
                    {result.sponsorBonus.currencyCode}{' '}
                    {result.sponsorBonus.amount.toLocaleString('es-MX', {
                      minimumFractionDigits: 2,
                    })}
                  </span>{' '}
                  por esta inscripción ({result.sponsorBonus.countryCode}).
                </p>
              </Card>
            )}

            <p className="text-xs text-muted-foreground text-center">
              {!isDistribuidor
                ? 'Cliente preferente activo. Ya puede comprar con precio preferente.'
                : chargeKit && selectedKit
                  ? 'El kit se agregará al carrito y el cliente cambiará al nuevo distribuidor para cobrar la inscripción.'
                  : 'El distribuidor quedó pendiente. Podrá comprar su kit después para activarse.'}
            </p>

            <Button className="w-full" onClick={handleContinue}>
              {isDistribuidor && chargeKit && selectedKit
                ? 'Continuar al cobro del kit'
                : 'Listo'}
            </Button>
          </div>
        ) : (
          /* FORM VIEW */
          <div className="px-6 py-5 space-y-4">
            {/* Tipo de alta */}
            <div className="flex rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setTipo('distribuidor')}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isDistribuidor
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Distribuidor
              </button>
              <button
                type="button"
                onClick={() => {
                  setTipo('preferente');
                  setChargeKit(false);
                  setKitId('');
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  !isDistribuidor
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Cliente preferente
              </button>
            </div>

            {/* Patrocinador por numero */}
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">
                Número del distribuidor patrocinador *
              </Label>
              <div className="flex gap-2">
                <Input
                  value={sponsorNumber}
                  onChange={(e) => {
                    setSponsorNumber(e.target.value);
                    setSponsor(null);
                    setSponsorError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleLookupSponsor();
                    }
                  }}
                  placeholder="Ej. TL000123"
                  className="font-mono"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLookupSponsor}
                  disabled={lookingUp || !sponsorNumber.trim()}
                >
                  {lookingUp ? <Loader2 className="size-4 animate-spin" /> : 'Validar'}
                </Button>
              </div>
              {sponsor?.isValid && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="size-3.5" />
                  {sponsor.name} (#{sponsor.customerNumber})
                </p>
              )}
              {sponsorError && (
                <p className="mt-1 text-xs text-destructive">{sponsorError}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre(s) *">
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
              </Field>
              <Field label="Apellido paterno *">
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
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
                  onChange={(e) => set('rfc', e.target.value.toUpperCase())}
                  maxLength={13}
                  className="font-mono"
                />
              </Field>
              <Field label="Correo electrónico *">
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Teléfono *">
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
            </div>

            {/* País de residencia: define portal, catálogo y precios */}
            <Field label="País de residencia *">
              <Select value={countryId} onValueChange={setCountryId}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      countriesQuery.isLoading
                        ? 'Cargando países…'
                        : 'Selecciona el país'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.currencyCode ? ` (${c.currencyCode})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Define la moneda y el catálogo de productos con el que verá el portal.
              </p>
            </Field>

            {/* Kit opcional (solo distribuidor) */}
            {isDistribuidor && (
            <Card className="gap-3 rounded-lg bg-muted/30 p-4 shadow-none">
              <Label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={chargeKit}
                  onCheckedChange={(c) => {
                    setChargeKit(c === true);
                    if (c !== true) setKitId('');
                  }}
                />
                Cobrar kit de inscripción ahora
              </Label>
              {chargeKit && (
                <Select value={kitId} onValueChange={setKitId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecciona el kit" />
                  </SelectTrigger>
                  <SelectContent>
                    {enrollmentKits.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No hay kits de inscripción en el catálogo
                      </div>
                    ) : (
                      enrollmentKits.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.sku} — {k.name}
                          {k.kitPosition ? ` (${k.kitPosition})` : ''}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
              {!chargeKit && (
                <p className="text-[11px] text-muted-foreground">
                  Sin kit, el distribuidor queda pendiente hasta que compre uno.
                </p>
              )}
            </Card>
            )}

            <Label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={sendEmail}
                onCheckedChange={(c) => setSendEmail(c === true)}
              />
              Enviar credenciales por correo al distribuidor
            </Label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {isPending
                  ? 'Registrando...'
                  : isDistribuidor && chargeKit
                    ? 'Registrar y cobrar kit'
                    : 'Registrar'}
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
