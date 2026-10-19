// lib/deliveries.ts — Ayudas puras de la entrega a domicilio del POS:
// domicilio en una línea (misma regla que el API, pos/lib/deliveries.lib.ts)
// y conversión dirección guardada ↔ borrador.

import type {
  CreateSaleDeliveryInput,
  CustomerAddress,
  CustomerAddressInput,
  DeliveryDraft,
} from '@/types/deliveries';
import type { AddressFieldSpec } from './address-forms';

export interface AddressParts {
  street?: string | null;
  extNumber?: string | null;
  intNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  countryName?: string | null;
}

const clean = (v: string | null | undefined): string =>
  (v ?? '').replace(/\s+/g, ' ').trim();

/** "Av. Reforma #120 Int. 4, Col. Centro, 36500 Irapuato, Guanajuato, México" */
export function buildAddressText(p: AddressParts): string {
  const line1 = [
    clean(p.street),
    clean(p.extNumber) ? `#${clean(p.extNumber)}` : '',
    clean(p.intNumber) ? `Int. ${clean(p.intNumber)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cityLine = [clean(p.zipCode), clean(p.city)].filter(Boolean).join(' ');
  return [
    line1,
    clean(p.neighborhood) ? `Col. ${clean(p.neighborhood)}` : '',
    cityLine,
    clean(p.state),
    clean(p.countryName),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Dirección guardada → valores del formulario por país (address-forms). */
export function addressToFormValues(
  a: CustomerAddress,
): Partial<Record<AddressFieldSpec['key'], string>> {
  return {
    street: a.street ?? '',
    extNumber: a.exteriorNumber ?? '',
    intNumber: a.interiorNumber ?? '',
    neighborhood: a.neighborhood ?? '',
    city: a.city ?? '',
    zipCode: a.postalCode ?? '',
    reference: a.reference ?? '',
  };
}

/** Valores del formulario → payload de /customers/:id/addresses. */
export function formValuesToAddressInput(
  values: Partial<Record<AddressFieldSpec['key'], string>>,
  stateName: string,
  countryId?: string,
): CustomerAddressInput {
  const opt = (v?: string) => (clean(v) ? clean(v) : undefined);
  return {
    street: clean(values.street),
    exteriorNumber: opt(values.extNumber),
    interiorNumber: opt(values.intNumber),
    neighborhood: opt(values.neighborhood),
    city: clean(values.city),
    state: clean(stateName),
    postalCode: opt(values.zipCode),
    reference: opt(values.reference),
    ...(countryId ? { countryId } : {}),
  };
}

/** Arma el borrador (lo que viaja en la venta) desde una dirección guardada. */
export function draftFromSavedAddress(
  a: CustomerAddress,
  base: {
    customerId: string;
    recipientName: string;
    recipientPhone?: string;
    notes?: string;
    countryName?: string | null;
  },
): DeliveryDraft {
  return {
    customerId: base.customerId,
    recipientName: base.recipientName,
    recipientPhone: base.recipientPhone || undefined,
    notes: base.notes || undefined,
    addressId: a.id,
    street: a.street ?? undefined,
    extNumber: a.exteriorNumber ?? undefined,
    intNumber: a.interiorNumber ?? undefined,
    neighborhood: a.neighborhood ?? undefined,
    city: a.city ?? undefined,
    state: a.state ?? undefined,
    zipCode: a.postalCode ?? undefined,
    countryId: a.countryId ?? undefined,
    reference: a.reference ?? undefined,
    addressText: buildAddressText({
      street: a.street,
      extNumber: a.exteriorNumber,
      intNumber: a.interiorNumber,
      neighborhood: a.neighborhood,
      city: a.city,
      state: a.state,
      zipCode: a.postalCode,
      countryName: base.countryName,
    }),
  };
}

/** Arma el borrador desde el formulario (dirección NO guardada en la ficha). */
export function draftFromFormValues(
  values: Partial<Record<AddressFieldSpec['key'], string>>,
  stateName: string,
  base: {
    customerId: string;
    recipientName: string;
    recipientPhone?: string;
    notes?: string;
    countryId?: string;
    countryName?: string | null;
  },
): DeliveryDraft {
  const opt = (v?: string) => (clean(v) ? clean(v) : undefined);
  return {
    customerId: base.customerId,
    recipientName: base.recipientName,
    recipientPhone: base.recipientPhone || undefined,
    notes: base.notes || undefined,
    street: clean(values.street),
    extNumber: opt(values.extNumber),
    intNumber: opt(values.intNumber),
    neighborhood: opt(values.neighborhood),
    city: clean(values.city),
    state: clean(stateName) || undefined,
    zipCode: opt(values.zipCode),
    countryId: base.countryId,
    reference: opt(values.reference),
    addressText: buildAddressText({
      street: values.street,
      extNumber: values.extNumber,
      intNumber: values.intNumber,
      neighborhood: values.neighborhood,
      city: values.city,
      state: stateName,
      zipCode: values.zipCode,
      countryName: base.countryName,
    }),
  };
}

/** Lo que se manda al API (sin los campos de solo-UI). */
export function draftToInput(d: DeliveryDraft): CreateSaleDeliveryInput {
  return {
    recipientName: d.recipientName,
    recipientPhone: d.recipientPhone,
    addressId: d.addressId,
    street: d.street,
    extNumber: d.extNumber,
    intNumber: d.intNumber,
    neighborhood: d.neighborhood,
    city: d.city,
    state: d.state,
    zipCode: d.zipCode,
    countryId: d.countryId,
    reference: d.reference,
    notes: d.notes,
    fulfillBranchId: d.fulfillBranchId,
  };
}
