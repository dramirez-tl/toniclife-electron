// DeliveryDialog — Entrega a domicilio de la venta en curso. Call Center
// confirma por teléfono con el distribuidor quién recibe, el teléfono y el
// domicilio (una dirección guardada en su ficha, una nueva que se guarda, o
// una solo para esta venta). El resultado es un borrador que PosScreen manda
// dentro de POST /pos/sales (delivery) al cobrar; el API lo congela y Almacén
// lo surte desde el admin. Los domicilios se capturan con el formulario por
// país (lib/address-forms) y el estado del catálogo del API.

import { useMemo, useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Pencil, Plus, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { posApi } from '@/lib/posApi';
import {
  getAddressForm,
  validateAddress,
  type AddressFieldSpec,
} from '@/lib/address-forms';
import {
  addressToFormValues,
  buildAddressText,
  draftFromFormValues,
  draftFromSavedAddress,
  formValuesToAddressInput,
} from '@/lib/deliveries';
import type { CustomerAddress, DeliveryDraft } from '@/types/deliveries';

type FormValues = Partial<Record<AddressFieldSpec['key'], string>>;

type Selection = { kind: 'saved'; id: string } | { kind: 'inline' } | null;

interface DeliveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId?: string;
  customerName?: string;
  customerNumber?: string;
  /** País de la sucursal (respaldo si el cliente no tiene país). */
  branchCountryCode?: string;
  /** Borrador previo (editar destinatario/domicilio ya confirmados). */
  initial: DeliveryDraft | null;
  onConfirm: (draft: DeliveryDraft) => void;
}

function initialForm(initial: DeliveryDraft | null): FormValues {
  if (!initial || initial.addressId) return {};
  return {
    street: initial.street ?? '',
    extNumber: initial.extNumber ?? '',
    intNumber: initial.intNumber ?? '',
    neighborhood: initial.neighborhood ?? '',
    city: initial.city ?? '',
    zipCode: initial.zipCode ?? '',
    reference: initial.reference ?? '',
  };
}

export function DeliveryDialog({
  isOpen,
  onClose,
  customerId,
  customerName,
  customerNumber,
  branchCountryCode,
  initial,
  onConfirm,
}: DeliveryDialogProps) {
  const queryClient = useQueryClient();

  // Destinatario: null = aún no se editó → se usa el dato de la ficha.
  const [recipientName, setRecipientName] = useState<string | null>(
    initial?.recipientName ?? null,
  );
  const [recipientPhone, setRecipientPhone] = useState<string | null>(
    initial?.recipientPhone ?? null,
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [selection, setSelection] = useState<Selection>(
    initial?.addressId
      ? { kind: 'saved', id: initial.addressId }
      : initial?.street
        ? { kind: 'inline' }
        : null,
  );
  // Formulario de domicilio (nuevo / editar / solo para esta venta).
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<FormValues>(() => initialForm(initial));
  const [stateName, setStateName] = useState(
    initial && !initial.addressId ? (initial.state ?? '') : '',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);

  const contactQuery = useQuery({
    queryKey: ['customer-contact', customerId],
    queryFn: () => posApi.getCustomerContact(customerId as string),
    enabled: isOpen && !!customerId,
    staleTime: 60_000,
  });
  const addressesQuery = useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => posApi.getCustomerAddresses(customerId as string),
    enabled: isOpen && !!customerId,
    staleTime: 30_000,
  });
  const countriesQuery = useQuery({
    queryKey: ['active-countries'],
    queryFn: () => posApi.getActiveCountries(),
    enabled: isOpen,
    staleTime: 10 * 60 * 1000,
  });
  const countries = countriesQuery.data ?? [];
  const contact = contactQuery.data;
  const addresses = useMemo(() => addressesQuery.data ?? [], [addressesQuery.data]);

  // País del domicilio: el del cliente; si no, el de la sucursal.
  const countryId =
    contact?.countryId ??
    countries.find(
      (c) => c.code?.trim().toUpperCase() === (branchCountryCode ?? '').toUpperCase(),
    )?.id;
  const country = countries.find((c) => c.id === countryId);
  const countryCode = country?.code ?? branchCountryCode;
  const addressForm = getAddressForm(countryCode);

  const statesQuery = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => posApi.getStates(countryId as string),
    enabled: isOpen && !!countryId && !!editing,
    staleTime: 10 * 60 * 1000,
  });
  const statesList = statesQuery.data ?? [];

  const defaultName = contact?.fullName || customerName || '';
  const effectiveName = recipientName ?? defaultName;
  const effectivePhone = recipientPhone ?? contact?.phone ?? '';

  // Sin elección explícita: la predeterminada de la ficha (o la única).
  const effectiveSelection: Selection = useMemo(() => {
    if (selection) {
      if (selection.kind === 'saved' && !addresses.some((a) => a.id === selection.id)) {
        return null;
      }
      return selection;
    }
    const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
    return preferred ? { kind: 'saved', id: preferred.id } : null;
  }, [selection, addresses]);

  const countryNameFor = (id: string | null | undefined) =>
    countries.find((c) => c.id === (id ?? countryId))?.name ?? null;

  const saveAddress = useMutation({
    mutationFn: async (vars: { id: string | null; values: FormValues; stateName: string }) => {
      const input = formValuesToAddressInput(vars.values, vars.stateName, countryId);
      if (!customerId) throw new Error('Sin cliente');
      return vars.id
        ? posApi.updateCustomerAddress(customerId, vars.id, input)
        : posApi.createCustomerAddress(customerId, {
            ...input,
            isDefault: addresses.length === 0,
          });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['customer-addresses', customerId] });
      setSelection({ kind: 'saved', id: saved.id });
      setEditing(null);
      toast.success(editing?.id ? 'Domicilio actualizado en la ficha' : 'Domicilio guardado en la ficha');
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setSaveBlocked(true);
        toast.error(
          'Tu cuenta no puede guardar domicilios en la ficha. Puedes usarlo solo para esta venta.',
        );
        return;
      }
      const msg =
        (axios.isAxiosError(err) && (err.response?.data as { message?: string })?.message) ||
        'No se pudo guardar el domicilio';
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg);
    },
  });

  const startNew = () => {
    setForm({});
    setStateName('');
    setEditing({ id: null });
  };
  const startEdit = (a: CustomerAddress) => {
    setForm(addressToFormValues(a));
    setStateName(a.state ?? '');
    setEditing({ id: a.id });
  };
  const validateForm = (): boolean => {
    const err = validateAddress(addressForm, form, stateName);
    if (err) {
      toast.error(err);
      return false;
    }
    return true;
  };
  const useInline = () => {
    if (!validateForm()) return;
    setSelection({ kind: 'inline' });
    setEditing(null);
  };

  const handleConfirm = () => {
    if (!customerId) return;
    const name = effectiveName.trim();
    if (name.length < 2) {
      toast.error('Captura quién recibe el pedido');
      return;
    }
    if (editing) {
      toast.error('Guarda el domicilio o elige "Usar solo en esta venta" antes de confirmar');
      return;
    }
    if (!effectiveSelection) {
      toast.error('Elige o captura el domicilio de entrega');
      return;
    }
    if (!confirmed) {
      toast.error('Marca que confirmaste los datos con el distribuidor');
      return;
    }
    const base = {
      customerId,
      recipientName: name,
      recipientPhone: effectivePhone.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (effectiveSelection.kind === 'saved') {
      const a = addresses.find((x) => x.id === effectiveSelection.id);
      if (!a) {
        toast.error('La dirección elegida ya no existe; elige otra');
        return;
      }
      onConfirm(
        draftFromSavedAddress(a, { ...base, countryName: countryNameFor(a.countryId) }),
      );
      return;
    }
    if (!validateForm()) return;
    onConfirm(
      draftFromFormValues(form, stateName, {
        ...base,
        countryId,
        countryName: countryNameFor(countryId),
      }),
    );
  };

  const loading = contactQuery.isLoading || addressesQuery.isLoading;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-5" />
            Entrega a domicilio
          </DialogTitle>
          <DialogDescription>
            Confirma por teléfono con {customerName ?? 'el distribuidor'}
            {customerNumber ? ` (#${customerNumber})` : ''} quién recibe, el teléfono y el
            domicilio. Almacén surte y envía el pedido desde la sucursal.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {!customerId ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              Asigna primero al distribuidor en la venta.
            </p>
          ) : loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando la ficha del cliente…
            </div>
          ) : (
            <>
              {/* Destinatario */}
              <section className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Label htmlFor="delivery-recipient">Recibe *</Label>
                  <Input
                    id="delivery-recipient"
                    className="mt-1"
                    value={effectiveName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    maxLength={255}
                    placeholder="Nombre de quien recibe"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Label htmlFor="delivery-phone">Teléfono de contacto</Label>
                  <Input
                    id="delivery-phone"
                    className="mt-1"
                    value={effectivePhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    maxLength={30}
                    placeholder="Para la paquetería"
                  />
                </div>
              </section>

              {/* Domicilio */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Domicilio de entrega *
                  </p>
                  {!editing && (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={startNew}>
                      <Plus className="size-3.5" /> Nueva dirección
                    </Button>
                  )}
                </div>

                {!editing && addresses.length === 0 && effectiveSelection?.kind !== 'inline' && (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    El distribuidor no tiene domicilios guardados. Captura uno nuevo.
                  </p>
                )}

                {!editing &&
                  addresses.map((a) => {
                    const active =
                      effectiveSelection?.kind === 'saved' && effectiveSelection.id === a.id;
                    return (
                      <div
                        key={a.id}
                        role="radio"
                        aria-checked={active}
                        tabIndex={0}
                        onClick={() => setSelection({ kind: 'saved', id: a.id })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelection({ kind: 'saved', id: a.id });
                          }
                        }}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                        }`}
                      >
                        <MapPin className={`mt-0.5 size-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {a.alias || (a.isDefault ? 'Domicilio principal' : 'Domicilio')}
                            {a.isDefault && (
                              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                                predeterminado
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {buildAddressText({
                              street: a.street,
                              extNumber: a.exteriorNumber,
                              intNumber: a.interiorNumber,
                              neighborhood: a.neighborhood,
                              city: a.city,
                              state: a.state,
                              zipCode: a.postalCode,
                            }) || 'Sin datos'}
                          </p>
                          {a.reference && (
                            <p className="text-[11px] text-muted-foreground">Ref.: {a.reference}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          title="Corregir este domicilio"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(a);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}

                {!editing && effectiveSelection?.kind === 'inline' && (
                  <div className="flex items-start gap-2 rounded-md border border-primary bg-primary/5 p-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">Solo para esta venta (no se guarda en la ficha)</p>
                      <p className="text-xs text-muted-foreground">
                        {buildAddressText({ ...form, state: stateName })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      title="Corregir"
                      onClick={() => setEditing({ id: null })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                )}

                {editing && (
                  <div className="rounded-lg border border-dashed p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {editing.id ? 'Corregir domicilio' : 'Nuevo domicilio'}
                      {country ? ` · ${country.name}` : ''}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {addressForm.fields.map((f) => (
                        <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                          <Label htmlFor={`delivery-${f.key}`}>
                            {f.required ? `${f.label} *` : f.label}
                          </Label>
                          <Input
                            id={`delivery-${f.key}`}
                            className="mt-1"
                            value={form[f.key] ?? ''}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                            maxLength={f.maxLength}
                            placeholder={f.placeholder}
                          />
                        </div>
                      ))}
                      <div>
                        <Label>{addressForm.stateLabel} *</Label>
                        <Select value={stateName} onValueChange={setStateName}>
                          <SelectTrigger className="mt-1 w-full">
                            <SelectValue
                              placeholder={statesQuery.isLoading ? 'Cargando…' : 'Selecciona'}
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
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!saveBlocked && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={saveAddress.isPending}
                          onClick={() => {
                            if (!validateForm()) return;
                            saveAddress.mutate({ id: editing.id, values: form, stateName });
                          }}
                        >
                          {saveAddress.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : null}
                          {editing.id ? 'Guardar cambios en la ficha' : 'Guardar en la ficha'}
                        </Button>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={useInline}>
                        Usar solo en esta venta
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(null)}
                        disabled={saveAddress.isPending}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              {/* Indicaciones */}
              <section>
                <Label htmlFor="delivery-notes">Indicaciones para Almacén (opcional)</Label>
                <Textarea
                  id="delivery-notes"
                  className="mt-1"
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Horario de entrega, dejar con el vecino, etc."
                />
              </section>

              <label className="flex cursor-pointer items-start gap-2 rounded-md bg-muted/40 p-3 text-sm">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Confirmé por teléfono con el distribuidor el nombre de quien recibe, el
                  teléfono y el domicilio de entrega.
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!customerId || loading}>
            <Truck className="size-4" />
            Confirmar entrega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
