// RegisterDistributorModal - Alta de distribuidor desde el POS.
//
// A diferencia de KitProspectModal (que se dispara al agregar un kit), aqui el
// cajero da de alta a alguien tecleando el NUMERO del distribuidor patrocinador.
// El kit es OPCIONAL: puede registrar y cobrar el kit en el momento, o solo
// registrar (el nuevo distribuidor compra su kit despues).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  UserPlus,
  CheckCircle2,
  Copy,
  Loader2,
  Check,
  Search,
  Hash,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ImageLightbox } from '@/components/pos/ImageLightbox';
import {
  useRegisterDistributor,
  useRegisterPreferred,
  useSponsorSearch,
  useSponsorByNumber,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import {
  getAddressForm,
  validateAddress,
  buildAddressPayload,
  type AddressFieldSpec,
} from '@/lib/address-forms';
import { normalizePhone, phoneHint } from '@/lib/phone';
import type {
  QuickProduct,
  KitEnrollmentResponse,
  SponsorLookup,
} from '@/types/pos';

const KIT_POSITION_LABEL: Record<string, string> = {
  basic: 'Básico',
  premium: 'Premium',
  preferred: 'Preferente',
};
const KIT_POSITION_ORDER: Record<string, number> = {
  basic: 0,
  premium: 1,
  preferred: 2,
};

interface RegisterDistributorModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  /** Código ISO del país de la sucursal (preselección del selector de país). */
  branchCountryCode?: string;
  /** Símbolo de moneda de la sucursal (para mostrar precio de los kits). */
  currencySymbol?: string;
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
  // Alta de DISTRIBUIDOR: fecha de nacimiento OBLIGATORIA + opcionales.
  birthDate: '',
  nationality: '',
  curp: '',
  maritalStatus: '',
  postalCode: '',
  identificationType: '',
};

/** Formato oficial del CURP (18): mismo regex que valida el API. */
const CURP_REGEX = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}$/;

const MARITAL_OPTIONS = [
  { value: 'soltero', label: 'Soltero(a)' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'union_libre', label: 'Unión libre' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'viudo', label: 'Viudo(a)' },
];

/** Tipos de identificación oficial según el país de residencia elegido. */
function idTypeOptions(countryCode?: string): string[] {
  switch (countryCode) {
    case 'MX':
    case 'FN':
      return ['INE', 'Pasaporte', 'Cédula profesional', 'Otro'];
    case 'US':
      return ['Licencia de conducir', 'Pasaporte', 'ID estatal', 'Otro'];
    default:
      return ['DNI', 'Pasaporte', 'Otro'];
  }
}

export function RegisterDistributorModal({
  isOpen,
  onClose,
  branchId,
  branchCountryCode,
  currencySymbol = '$',
  enrollmentKits,
  onRegistered,
}: RegisterDistributorModalProps) {
  // Buscador de patrocinador con DOS inputs (mismo patron que el buscador de
  // clientes del carrito): general por nombre/apellidos, y numero EXACTO
  // (hay distribuidores con numero de 1 digito que la busqueda general
  // enterraria). Al seleccionar queda fijado en `sponsor`.
  const [sponsorQuery, setSponsorQuery] = useState('');
  const [sponsorNumber, setSponsorNumber] = useState('');
  const [sponsor, setSponsor] = useState<SponsorLookup | null>(null);
  const byNumber = sponsorNumber.trim().length >= 1;
  const sponsorSearch = useSponsorSearch(
    sponsor || byNumber ? '' : sponsorQuery,
  );
  const numberLookup = useSponsorByNumber(sponsor ? '' : sponsorNumber);
  const sponsorResults = byNumber
    ? numberLookup.data
      ? [numberLookup.data]
      : []
    : (sponsorSearch.data ?? []);
  const sponsorFetching = byNumber
    ? numberLookup.isFetching
    : sponsorSearch.isFetching;

  const [tipo, setTipo] = useState<'distribuidor' | 'preferente'>('distribuidor');
  const [form, setForm] = useState(EMPTY_FORM);
  const [countryId, setCountryId] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [chargeKit, setChargeKit] = useState(false);
  const [kitId, setKitId] = useState<string>('');
  // Kit en vista previa (lightbox de imagen para ver el detalle del kit).
  const [previewKit, setPreviewKit] = useState<QuickProduct | null>(null);
  const [result, setResult] = useState<KitEnrollmentResponse | null>(null);

  // País de residencia: define el portal, catálogo y precios del nuevo registro.
  const countriesQuery = useQuery({
    queryKey: ['active-countries'],
    queryFn: () => posApi.getActiveCountries(),
    enabled: isOpen,
    staleTime: 10 * 60 * 1000,
  });
  const countries = countriesQuery.data ?? [];

  // Domicilio ESTRUCTURADO por país (MX/US/GT/CO): los campos cambian según
  // el país de residencia y el estado/departamento sale del catálogo del API.
  const [address, setAddress] = useState<
    Partial<Record<AddressFieldSpec['key'], string>>
  >({});
  const [addressStateName, setAddressStateName] = useState('');
  const statesQuery = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => posApi.getStates(countryId),
    enabled: isOpen && !!countryId,
    staleTime: 10 * 60 * 1000,
  });
  const statesList = statesQuery.data ?? [];

  const registerDistributor = useRegisterDistributor();
  const registerPreferred = useRegisterPreferred();
  const isPending = registerDistributor.isPending || registerPreferred.isPending;
  const tipoLabel = tipo === 'distribuidor' ? 'Distribuidor' : 'Cliente preferente';

  useEffect(() => {
    if (isOpen) {
      setTipo('distribuidor');
      setSponsorQuery('');
      setSponsorNumber('');
      setSponsor(null);
      setForm(EMPTY_FORM);
      setCountryId('');
      setSendEmail(true);
      setChargeKit(false);
      setKitId('');
      setPreviewKit(null);
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

  function handleSelectSponsor(found: SponsorLookup) {
    if (!found.isValid) {
      toast.error(
        found.customerType !== 'distributor'
          ? `#${found.customerNumber} no es un distribuidor.`
          : `El distribuidor #${found.customerNumber} no está activo — no puede patrocinar.`,
      );
      return;
    }
    setSponsor(found);
    setSponsorQuery('');
    setSponsorNumber('');
  }

  // Kits ordenados por posicion (basico → premium → preferente) y nombre.
  const sortedKits = [...enrollmentKits].sort((a, b) => {
    const pa = KIT_POSITION_ORDER[a.kitPosition ?? ''] ?? 99;
    const pb = KIT_POSITION_ORDER[b.kitPosition ?? ''] ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name, 'es');
  });
  const selectedKit = enrollmentKits.find((k) => k.id === kitId) ?? null;

  const isDistribuidor = tipo === 'distribuidor';
  // País de residencia elegido: decide CURP (solo México/Frontera) y las
  // opciones de identificación oficial.
  const selectedCountryCode = countries
    .find((c) => c.id === countryId)
    ?.code?.trim()
    .toUpperCase();
  const showCurp = selectedCountryCode === 'MX' || selectedCountryCode === 'FN';
  const addressForm = getAddressForm(selectedCountryCode);
  const todayIso = new Date().toISOString().slice(0, 10);
  const canSubmit =
    !!sponsor?.isValid &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    !!countryId &&
    (!isDistribuidor ||
      (form.birthDate.trim().length > 0 && form.birthDate <= todayIso)) &&
    (!isDistribuidor || !chargeKit || !!kitId) &&
    !isPending;

  async function handleSubmit() {
    if (!canSubmit || !sponsor) return;
    // Domicilio: obligatorio para distribuidores, con los campos del país.
    if (isDistribuidor) {
      const addrError = validateAddress(addressForm, address, addressStateName);
      if (addrError) {
        toast.error(addrError);
        return;
      }
    }
    // Teléfono: el cajero teclea el número local; se agrega la lada del país
    // de residencia elegido (el API solo acepta E.164 '+<lada><número>').
    const phone = normalizePhone(
      form.phone,
      selectedCountryCode || branchCountryCode,
    );
    if (!phone.ok) {
      toast.error(phone.error);
      return;
    }
    // CURP: si se captura, debe traer los 18 caracteres del formato oficial
    // (mismo regex que el API — antes se guardaba incompleto y el admin lo
    // rechazaba después al editar).
    const curpTyped = showCurp ? form.curp.trim().toUpperCase() : '';
    if (curpTyped && !CURP_REGEX.test(curpTyped)) {
      toast.error(
        `CURP inválido: son 18 caracteres con el formato oficial (capturaste ${curpTyped.length}). ` +
          'Revisa que no falte la segunda letra (vocal del primer apellido).',
      );
      return;
    }
    const base = {
      sponsorCustomerNumber: sponsor.customerNumber,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      mothersLastName: form.mothersLastName.trim() || undefined,
      email: form.email.trim(),
      phone: phone.value,
      rfc: form.rfc.trim() || undefined,
      branchId,
      countryId: countryId || undefined,
      sendCredentialsByEmail: sendEmail,
    };
    try {
      const resp = isDistribuidor
        ? await registerDistributor.mutateAsync({
            ...base,
            birthDate: form.birthDate,
            nationality: form.nationality.trim() || undefined,
            curp: showCurp ? form.curp.trim().toUpperCase() || undefined : undefined,
            maritalStatus: form.maritalStatus || undefined,
            postalCode: form.postalCode.trim() || undefined,
            identificationType: form.identificationType || undefined,
            kitProductId: chargeKit && kitId ? kitId : undefined,
            address: buildAddressPayload(address, addressStateName),
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
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      {/* Panel lateral al 50% de la pantalla: mas espacio para el formulario
          y para las tarjetas de kit con imagen. */}
      <SheetContent
        side="right"
        className="w-1/2 gap-0 overflow-y-auto p-0 sm:max-w-none"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between space-y-0 border-b bg-background px-6 py-4 text-left">
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            <div>
              <SheetTitle className="text-lg font-bold text-foreground">
                Registrar {isDistribuidor ? 'distribuidor' : 'cliente preferente'}
              </SheetTitle>
              <SheetDescription className="text-xs">
                Alta vinculada a un distribuidor patrocinador por su número.
              </SheetDescription>
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
        </SheetHeader>

        {result ? (
          /* SUCCESS VIEW */
          <div className="mx-auto w-full max-w-xl px-6 py-6 space-y-4">
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
          <div className="mx-auto w-full max-w-2xl px-6 py-5 space-y-4">
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

            {/* Patrocinador: buscador por nombre o numero */}
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">
                Distribuidor patrocinador *
              </Label>
              {sponsor ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <Check className="size-4 shrink-0 text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-emerald-900">
                      {sponsor.name}
                    </div>
                    <div className="font-mono text-[11px] text-emerald-700">
                      #{sponsor.customerNumber}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setSponsor(null)}
                    title="Cambiar patrocinador"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Busqueda general: nombre, apellidos o email */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sponsorQuery}
                        onChange={(e) => {
                          setSponsorQuery(e.target.value);
                          if (e.target.value.trim()) setSponsorNumber('');
                        }}
                        placeholder="Nombre y apellidos..."
                        className="pl-9"
                        autoFocus
                      />
                    </div>
                    {/* Numero de distribuidor EXACTO: "2" trae SOLO al #2 */}
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sponsorNumber}
                        onChange={(e) => {
                          setSponsorNumber(e.target.value);
                          if (e.target.value.trim()) setSponsorQuery('');
                        }}
                        onKeyDown={(e) => {
                          // Enter = seleccionar el resultado exacto (flujo
                          // rapido: teclear numero + Enter).
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const first = sponsorResults.find(
                              (s) => s.isValid,
                            );
                            if (first) handleSelectSponsor(first);
                          }
                        }}
                        placeholder="No. EXACTO (ej. 2) + Enter"
                        className="pl-9 font-mono"
                      />
                    </div>
                  </div>
                  {(byNumber || sponsorQuery.trim().length >= 1) && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border bg-card">
                      {sponsorFetching && sponsorResults.length === 0 ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Buscando...
                        </div>
                      ) : sponsorResults.length === 0 ? (
                        <div className="px-3 py-2.5 text-sm text-muted-foreground">
                          {byNumber
                            ? `No existe ningún distribuidor con el número exacto "${sponsorNumber.trim()}".`
                            : `Sin distribuidores que coincidan con "${sponsorQuery.trim()}".`}
                        </div>
                      ) : (
                        <ul className="divide-y">
                          {sponsorResults.map((s) => (
                            <li key={s.id}>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => handleSelectSponsor(s)}
                                className={`block h-auto w-full rounded-none px-3 py-2 text-left whitespace-normal hover:bg-muted/60 ${
                                  s.isValid ? '' : 'opacity-60'
                                }`}
                              >
                                <div className="text-sm font-medium text-foreground">
                                  {s.name}
                                </div>
                                <div className="flex gap-2 text-[11px] text-muted-foreground">
                                  <span className="font-mono">
                                    #{s.customerNumber}
                                  </span>
                                  {!s.isValid && (
                                    <span className="font-medium text-destructive">
                                      {s.customerType !== 'distributor'
                                        ? 'NO ES DISTRIBUIDOR'
                                        : 'INACTIVO — no puede patrocinar'}
                                    </span>
                                  )}
                                </div>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
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
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {phoneHint(selectedCountryCode || branchCountryCode)}
                </p>
              </Field>
              {isDistribuidor && (
                <Field label="Fecha de nacimiento *">
                  <Input
                    type="date"
                    value={form.birthDate}
                    max={todayIso}
                    onChange={(e) => set('birthDate', e.target.value)}
                  />
                </Field>
              )}
            </div>

            {/* País de residencia: define portal, catálogo y precios */}
            <Field label="País de residencia *">
              <Select
                value={countryId}
                onValueChange={(v) => {
                  setCountryId(v);
                  // El formulario de domicilio cambia por país: limpiar.
                  setAddress({});
                  setAddressStateName('');
                }}
              >
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

            {/* Domicilio ESTRUCTURADO según el país de residencia (MX/US/GT/CO).
                Los campos y validaciones vienen de lib/address-forms.ts y el
                estado/departamento del catálogo del API. */}
            {isDistribuidor && countryId && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Domicilio *
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {addressForm.fields.map((f) => (
                    <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                      <Field label={f.required ? `${f.label} *` : f.label}>
                        <Input
                          value={address[f.key] ?? ''}
                          onChange={(e) =>
                            setAddress((a) => ({ ...a, [f.key]: e.target.value }))
                          }
                          maxLength={f.maxLength}
                          placeholder={f.placeholder}
                        />
                      </Field>
                    </div>
                  ))}
                  <Field label={`${addressForm.stateLabel} *`}>
                    <Select
                      value={addressStateName}
                      onValueChange={setAddressStateName}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            statesQuery.isLoading ? 'Cargando…' : 'Selecciona'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {statesList.map((s) => (
                          <SelectItem key={s.id} value={s.name}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            )}

            {/* Datos adicionales del distribuidor (todos opcionales) */}
            {isDistribuidor && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Datos adicionales (opcionales)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nacionalidad">
                    <Input
                      value={form.nationality}
                      onChange={(e) => set('nationality', e.target.value)}
                      placeholder="Mexicana…"
                    />
                  </Field>
                  <Field label="Estado civil">
                    <Select
                      value={form.maritalStatus}
                      onValueChange={(v) => set('maritalStatus', v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {MARITAL_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {showCurp && (
                    <Field label="CURP">
                      <Input
                        value={form.curp}
                        onChange={(e) => set('curp', e.target.value.toUpperCase())}
                        maxLength={18}
                        className="font-mono"
                      />
                      {form.curp.trim().length > 0 &&
                        !CURP_REGEX.test(form.curp.trim()) && (
                          <p className="mt-1 text-xs text-destructive">
                            CURP incompleto: son 18 caracteres (lleva{' '}
                            {form.curp.trim().length}) — 4 letras + fecha +
                            sexo + estado + 3 consonantes + 2 finales.
                          </p>
                        )}
                    </Field>
                  )}
                  {/* El C.P. ahora viaja dentro del DOMICILIO estructurado
                      (el backend lo espeja a customers.postal_code). */}
                  <Field label="Tipo de identificación oficial">
                    <Select
                      value={form.identificationType}
                      onValueChange={(v) => set('identificationType', v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {idTypeOptions(selectedCountryCode).map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            )}

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
              {chargeKit &&
                (sortedKits.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    <Package className="size-4 shrink-0" />
                    No hay kits de inscripción disponibles en esta sucursal.
                  </div>
                ) : (
                  <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {sortedKits.map((k) => {
                      const selected = k.id === kitId;
                      return (
                        // div clickeable (no <button>) porque la imagen lleva
                        // su propio boton anidado para abrir el lightbox.
                        <div
                          key={k.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setKitId(selected ? '' : k.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setKitId(selected ? '' : k.id);
                            }
                          }}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                            selected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border bg-background hover:bg-muted/50'
                          }`}
                        >
                          {/* Imagen del kit: clic = ver en grande (lightbox) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewKit(k);
                            }}
                            className="group relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted"
                            title="Ver imagen del kit"
                          >
                            {k.imageUrl ? (
                              <img
                                src={k.imageUrl}
                                alt={k.name}
                                className="size-full object-cover transition-transform group-hover:scale-105"
                                loading="lazy"
                              />
                            ) : (
                              <Package className="m-auto size-6 text-muted-foreground" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                              {k.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">{k.sku}</span>
                              {k.kitPosition && (
                                <Badge
                                  variant="secondary"
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  {KIT_POSITION_LABEL[k.kitPosition] ??
                                    k.kitPosition}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-sm font-semibold text-foreground">
                              {posApi.formatCurrency(k.basePrice, currencySymbol)}
                            </div>
                          </div>
                          {selected && (
                            <Check className="size-4 shrink-0 text-primary" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
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
        {/* Lightbox: imagen del kit en grande (con zoom) para revisar el detalle */}
        <ImageLightbox
          open={!!previewKit}
          onClose={() => setPreviewKit(null)}
          src={previewKit?.imageUrl}
          alt={previewKit?.name ?? 'Kit'}
          title={previewKit?.name ?? ''}
          subtitle={
            previewKit && (
              <>
                <span className="font-mono">{previewKit.sku}</span>
                {previewKit.kitPosition && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {KIT_POSITION_LABEL[previewKit.kitPosition] ??
                      previewKit.kitPosition}
                  </Badge>
                )}
              </>
            )
          }
          footer={
            previewKit && (
              <>
                <span className="text-lg font-bold text-foreground">
                  {posApi.formatCurrency(previewKit.basePrice, currencySymbol)}
                </span>
                <Button
                  onClick={() => {
                    setKitId(previewKit.id);
                    setPreviewKit(null);
                  }}
                >
                  Seleccionar este kit
                </Button>
              </>
            )
          }
        />
      </SheetContent>
    </Sheet>
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
