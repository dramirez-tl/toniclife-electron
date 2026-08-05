// address-forms.ts — Formulario de DOMICILIO estructurado por país.
//
// Cada país pide su domicilio distinto (MX: calle/no. ext/colonia/CP/
// municipio/estado; US: street/city/state/ZIP; GT: dirección/zona/
// departamento; CO: dirección/barrio/ciudad/departamento). El select de
// estado/departamento se llena del catálogo del API (GET /states?countryId=,
// público, sembrado para MX/US/GT/CO).
//
// ⚠️ DUPLICADO DELIBERADO: este archivo existe idéntico en
// toniclife-electron/src/lib y toniclife-next/src/lib (repos separados).
// Si cambias uno, cambia el otro.

export interface AddressFieldSpec {
  key:
    | 'street'
    | 'extNumber'
    | 'intNumber'
    | 'neighborhood'
    | 'city'
    | 'zipCode'
    | 'reference';
  label: string;
  required: boolean;
  placeholder?: string;
  maxLength?: number;
  /** RegExp (source) aplicada si el campo trae valor. */
  pattern?: string;
  patternHint?: string;
  /** Render a media columna. */
  half?: boolean;
}

export interface CountryAddressForm {
  stateLabel: string;
  fields: AddressFieldSpec[];
}

/** Valores capturados (el shape que viaja al API como `address`). */
export interface RegistrationAddress {
  street: string;
  extNumber?: string;
  intNumber?: string;
  neighborhood?: string;
  city: string;
  stateName: string;
  zipCode?: string;
  reference?: string;
}

const MX: CountryAddressForm = {
  stateLabel: 'Estado',
  fields: [
    { key: 'street', label: 'Calle', required: true, maxLength: 255 },
    { key: 'extNumber', label: 'No. exterior', required: true, maxLength: 20, half: true },
    { key: 'intNumber', label: 'No. interior', required: false, maxLength: 20, half: true },
    { key: 'neighborhood', label: 'Colonia', required: true, maxLength: 100 },
    {
      key: 'zipCode', label: 'Código postal', required: true, maxLength: 5, half: true,
      pattern: '^\\d{5}$', patternHint: '5 dígitos',
    },
    { key: 'city', label: 'Municipio / Alcaldía', required: true, maxLength: 100, half: true },
    { key: 'reference', label: 'Referencias (opcional)', required: false, maxLength: 500 },
  ],
};

const US: CountryAddressForm = {
  stateLabel: 'State',
  fields: [
    { key: 'street', label: 'Street address', required: true, maxLength: 255, placeholder: '123 Main St' },
    { key: 'intNumber', label: 'Apt / Suite / Unit', required: false, maxLength: 20, half: true },
    { key: 'city', label: 'City', required: true, maxLength: 100, half: true },
    {
      key: 'zipCode', label: 'ZIP code', required: true, maxLength: 10, half: true,
      pattern: '^\\d{5}(-\\d{4})?$', patternHint: '12345 o 12345-6789',
    },
  ],
};

const GT: CountryAddressForm = {
  stateLabel: 'Departamento',
  fields: [
    { key: 'street', label: 'Dirección (calle/avenida y número)', required: true, maxLength: 255, placeholder: '5a Avenida 12-34' },
    { key: 'neighborhood', label: 'Zona', required: true, maxLength: 100, placeholder: 'Zona 10', half: true },
    { key: 'city', label: 'Ciudad / Municipio', required: true, maxLength: 100, half: true },
    {
      key: 'zipCode', label: 'Código postal (opcional)', required: false, maxLength: 5, half: true,
      pattern: '^\\d{5}$', patternHint: '5 dígitos',
    },
  ],
};

const CO: CountryAddressForm = {
  stateLabel: 'Departamento',
  fields: [
    { key: 'street', label: 'Dirección (Calle/Carrera y número)', required: true, maxLength: 255, placeholder: 'Cra 15 # 93-60' },
    { key: 'neighborhood', label: 'Barrio (opcional)', required: false, maxLength: 100, half: true },
    { key: 'city', label: 'Ciudad / Municipio', required: true, maxLength: 100, half: true },
    {
      key: 'zipCode', label: 'Código postal (opcional)', required: false, maxLength: 6, half: true,
      pattern: '^\\d{6}$', patternHint: '6 dígitos',
    },
  ],
};

const DEFAULT_FORM: CountryAddressForm = {
  stateLabel: 'Estado / Provincia',
  fields: [
    { key: 'street', label: 'Dirección', required: true, maxLength: 255 },
    { key: 'city', label: 'Ciudad', required: true, maxLength: 100, half: true },
    { key: 'zipCode', label: 'Código postal (opcional)', required: false, maxLength: 10, half: true },
  ],
};

const FORMS: Record<string, CountryAddressForm> = { MX, US, GT, CO };

export function getAddressForm(countryCode?: string | null): CountryAddressForm {
  return FORMS[(countryCode || '').toUpperCase()] ?? DEFAULT_FORM;
}

/**
 * Valida los valores contra el formulario del país. Devuelve el primer
 * mensaje de error, o null si todo está bien.
 */
export function validateAddress(
  form: CountryAddressForm,
  values: Partial<Record<AddressFieldSpec['key'], string>>,
  stateName: string,
): string | null {
  for (const f of form.fields) {
    const v = (values[f.key] || '').trim();
    if (f.required && !v) return `Captura "${f.label}" del domicilio`;
    if (v && f.pattern && !new RegExp(f.pattern).test(v)) {
      return `"${f.label}" inválido${f.patternHint ? ` (${f.patternHint})` : ''}`;
    }
  }
  if (!stateName.trim()) return `Selecciona "${form.stateLabel}"`;
  return null;
}

/** Arma el payload `address` para el API a partir de los valores de la UI. */
export function buildAddressPayload(
  values: Partial<Record<AddressFieldSpec['key'], string>>,
  stateName: string,
): RegistrationAddress {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  return {
    street: (values.street || '').trim(),
    extNumber: clean(values.extNumber),
    intNumber: clean(values.intNumber),
    neighborhood: clean(values.neighborhood),
    city: (values.city || '').trim(),
    stateName: stateName.trim(),
    zipCode: clean(values.zipCode),
    reference: clean(values.reference),
  };
}
