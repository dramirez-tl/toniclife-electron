// FiscalDataFields - Campos de datos fiscales del receptor (RFC, CP, razón
// social, régimen, uso CFDI, correo) + método de pago CFDI (PUE/PPD).
// Compartido por el reintento de timbrado y por "Facturar" desde la lista de
// ventas, para que ambos pidan exactamente lo mismo.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { CreateFiscalDataInput, SatCatalogItem } from '@/types/pos';

/** Valores del formulario (sin customerId: lo pone quien guarda). */
export type FiscalFormValue = Omit<CreateFiscalDataInput, 'customerId'>;

export const EMPTY_FISCAL_FORM: FiscalFormValue = {
  rfc: '',
  legalName: '',
  fiscalRegime: '',
  postalCode: '',
  cfdiUse: 'G03',
  email: '',
};

/** Obligatorios para timbrar: RFC, razón social, régimen y CP. */
export function isFiscalFormComplete(f: FiscalFormValue): boolean {
  return !!(
    f.rfc.trim() &&
    f.legalName.trim() &&
    f.fiscalRegime &&
    f.postalCode.trim()
  );
}

/** Normaliza lo capturado antes de mandarlo al API (mayúsculas, sin
 *  espacios sobrantes). */
export function normalizeFiscalForm(f: FiscalFormValue): FiscalFormValue {
  return {
    ...f,
    rfc: f.rfc.trim().toUpperCase(),
    legalName: f.legalName.trim().toUpperCase(),
    postalCode: f.postalCode.trim(),
    email: f.email?.trim() || undefined,
  };
}

interface FiscalDataFieldsProps {
  value: FiscalFormValue;
  onChange: (patch: Partial<FiscalFormValue>) => void;
  catalogs?: { regimes: SatCatalogItem[]; cfdiUses: SatCatalogItem[] };
  paymentMethod: 'PUE' | 'PPD';
  onPaymentMethodChange: (pm: 'PUE' | 'PPD') => void;
  /** false = PPD no se ofrece (venta sin pago a crédito): queda fijo PUE. */
  allowPpd?: boolean;
  disabled?: boolean;
}

export function FiscalDataFields({
  value,
  onChange,
  catalogs,
  paymentMethod,
  onPaymentMethodChange,
  allowPpd = true,
  disabled = false,
}: FiscalDataFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FField label="RFC *">
        <Input
          value={value.rfc}
          onChange={(e) => onChange({ rfc: e.target.value.toUpperCase() })}
          maxLength={13}
          className="font-mono"
          disabled={disabled}
        />
      </FField>
      <FField label="Codigo postal *">
        <Input
          value={value.postalCode}
          onChange={(e) =>
            onChange({
              postalCode: e.target.value.replace(/\D/g, '').slice(0, 5),
            })
          }
          maxLength={5}
          disabled={disabled}
        />
      </FField>
      <FField label="Razon social *" full>
        <Input
          value={value.legalName}
          onChange={(e) =>
            onChange({ legalName: e.target.value.toUpperCase() })
          }
          disabled={disabled}
        />
      </FField>
      <FField label="Regimen fiscal *" full>
        <Select
          value={value.fiscalRegime}
          onValueChange={(v) => onChange({ fiscalRegime: v })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecciona..." />
          </SelectTrigger>
          <SelectContent>
            {(catalogs?.regimes ?? []).map((r) => (
              <SelectItem key={r.Value} value={r.Value}>
                {r.Value} — {r.Name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FField>
      <FField label="Uso CFDI" full>
        <Select
          value={value.cfdiUse ?? 'G03'}
          onValueChange={(v) => onChange({ cfdiUse: v })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecciona..." />
          </SelectTrigger>
          <SelectContent>
            {(catalogs?.cfdiUses ?? []).map((u) => (
              <SelectItem key={u.Value} value={u.Value}>
                {u.Value} — {u.Name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FField>
      <FField label="Correo (opcional)" full>
        <Input
          type="email"
          value={value.email ?? ''}
          onChange={(e) => onChange({ email: e.target.value })}
          disabled={disabled}
        />
      </FField>
      <FField label="Metodo de pago CFDI" full>
        {allowPpd ? (
          <div className="flex gap-2">
            {(['PUE', 'PPD'] as const).map((pm) => (
              <Button
                key={pm}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPaymentMethodChange(pm)}
                disabled={disabled}
                className={cn(
                  'flex-1',
                  paymentMethod === pm &&
                    'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                {pm}
              </Button>
            ))}
          </div>
        ) : (
          // Sin pago a crédito la factura es PUE (pago en una sola
          // exhibición); PPD solo aplica a ventas a crédito.
          <div className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-foreground">
            PUE — pago en una sola exhibición
          </div>
        )}
      </FField>
    </div>
  );
}

export function FField({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
