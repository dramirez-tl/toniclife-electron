// phone.ts - Normalización de teléfonos a E.164 para las altas del POS.
// Espejo del catálogo del API (src/common/validators/phone.validator.ts) y
// del front web (toniclife-next/src/lib/phone.ts): el API solo acepta
// '+<lada><número>' con la longitud de dígitos del país. El cajero teclea el
// número local (ej. 10 dígitos en México) y aquí se le agrega la lada del
// país de residencia elegido en el formulario.

interface PhoneCountry {
  /** ISO-2 (tonic.countries.code) */
  code: string;
  name: string;
  /** Lada sin '+' */
  dial: string;
  /** Dígitos del número local */
  digits: number;
}

const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: 'MX', name: 'México', dial: '52', digits: 10 },
  { code: 'US', name: 'Estados Unidos', dial: '1', digits: 10 },
  { code: 'GT', name: 'Guatemala', dial: '502', digits: 8 },
  { code: 'SV', name: 'El Salvador', dial: '503', digits: 8 },
  { code: 'HN', name: 'Honduras', dial: '504', digits: 8 },
  { code: 'NI', name: 'Nicaragua', dial: '505', digits: 8 },
  { code: 'CR', name: 'Costa Rica', dial: '506', digits: 8 },
  { code: 'PA', name: 'Panamá', dial: '507', digits: 8 },
  { code: 'CO', name: 'Colombia', dial: '57', digits: 10 },
  { code: 'PE', name: 'Perú', dial: '51', digits: 9 },
  { code: 'EC', name: 'Ecuador', dial: '593', digits: 9 },
  { code: 'CL', name: 'Chile', dial: '56', digits: 9 },
  { code: 'AR', name: 'Argentina', dial: '54', digits: 10 },
  { code: 'BR', name: 'Brasil', dial: '55', digits: 11 },
  { code: 'ES', name: 'España', dial: '34', digits: 9 },
];

const DIALS_BY_LEN = [...PHONE_COUNTRIES].sort(
  (a, b) => b.dial.length - a.dial.length,
);

/** 'FN' (Frontera) usa numeración de México. */
function resolveCountry(code?: string): PhoneCountry {
  const iso = (code || '').trim().toUpperCase();
  const effective = iso === 'FN' ? 'MX' : iso;
  return (
    PHONE_COUNTRIES.find((c) => c.code === effective) ?? PHONE_COUNTRIES[0]
  );
}

/** Texto de ayuda bajo el campo: "10 dígitos — la lada +52 se agrega sola". */
export function phoneHint(countryCode?: string): string {
  const c = resolveCountry(countryCode);
  return `${c.digits} dígitos — la lada +${c.dial} se agrega sola`;
}

export type NormalizePhoneResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Normaliza lo tecleado a E.164 según el país de residencia elegido.
 * Acepta: número local (se prefija la lada), local con lada ya tecleada
 * (5255…, 1305…), internacional con '+' o '00', y celular MX legacy 044/045.
 */
export function normalizePhone(
  raw: string,
  countryCode?: string,
): NormalizePhoneResult {
  const country = resolveCountry(countryCode);
  const trimmed = (raw || '').trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);

  if (!digits) {
    return { ok: false, error: 'Escribe el teléfono de contacto.' };
  }

  if (hasPlus) {
    // Internacional explícito: validar lada conocida + longitud del país.
    const match = DIALS_BY_LEN.find((c) => digits.startsWith(c.dial));
    if (match && digits.length === match.dial.length + match.digits) {
      return { ok: true, value: `+${digits}` };
    }
    return {
      ok: false,
      error: match
        ? `El número de ${match.name} lleva ${match.digits} dígitos después de +${match.dial}.`
        : 'Lada internacional no reconocida; verifica el número.',
    };
  }

  // Celular MX legacy: 044/045 + 10 dígitos.
  if (
    country.code === 'MX' &&
    /^04[45]\d{10}$/.test(digits)
  ) {
    digits = digits.slice(3);
  }

  // Número local exacto → prefijar la lada del país elegido.
  if (digits.length === country.digits) {
    return { ok: true, value: `+${country.dial}${digits}` };
  }

  // Tecleó la lada del país sin '+' (ej. 52 + 10 dígitos, 1 + 10 dígitos).
  if (
    digits.startsWith(country.dial) &&
    digits.length === country.dial.length + country.digits
  ) {
    return { ok: true, value: `+${digits}` };
  }

  return {
    ok: false,
    error: `El teléfono de ${country.name} lleva ${country.digits} dígitos (tecleaste ${digits.length}). La lada +${country.dial} se agrega sola.`,
  };
}
