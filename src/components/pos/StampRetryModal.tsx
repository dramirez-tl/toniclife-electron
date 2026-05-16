// StampRetryModal - Reintento de timbrado CFDI cuando el timbrado automatico
// falla tras el pago. Permite corregir los datos fiscales y reintentar.
//
// La venta YA esta cobrada; este modal solo gestiona la factura. Si el cajero
// cierra sin lograrlo, la venta queda con requiresInvoice=true y puede
// completarse despues desde el admin web.

import { useEffect, useState } from 'react';
import { X, AlertTriangle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useFiscalCatalogs } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import type { CreateFiscalDataInput } from '@/types/pos';

export interface StampRetryState {
  saleId: string;
  saleNumber: string;
  fiscalData: CreateFiscalDataInput;
  invoicePaymentMethod: 'PUE' | 'PPD';
  error: string;
}

interface StampRetryModalProps {
  state: StampRetryState | null;
  onClose: () => void;
  onStamped: () => void;
}

export function StampRetryModal({
  state,
  onClose,
  onStamped,
}: StampRetryModalProps) {
  const { data: catalogs } = useFiscalCatalogs(!!state);
  const [fiscal, setFiscal] = useState<CreateFiscalDataInput | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'PUE' | 'PPD'>('PUE');
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (state) {
      setFiscal({ ...state.fiscalData });
      setPaymentMethod(state.invoicePaymentMethod);
      setError(state.error);
      setRetrying(false);
    }
  }, [state]);

  if (!state || !fiscal) return null;

  function setF(k: keyof CreateFiscalDataInput, v: string) {
    setFiscal((f) => (f ? { ...f, [k]: v } : f));
  }

  const complete =
    fiscal.rfc.trim() &&
    fiscal.legalName.trim() &&
    fiscal.fiscalRegime &&
    fiscal.postalCode.trim();

  async function handleRetry() {
    if (!fiscal || !complete || !state) return;
    setRetrying(true);
    setError('');
    try {
      await posApi.saveFiscalData({
        ...fiscal,
        rfc: fiscal.rfc.trim().toUpperCase(),
        legalName: fiscal.legalName.trim().toUpperCase(),
        postalCode: fiscal.postalCode.trim(),
      });
      await posApi.stampSale(state.saleId, paymentMethod);
      toast.success(`Factura de la venta ${state.saleNumber} timbrada`);
      onStamped();
      onClose();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(
        e.response?.data?.message ||
          'No se pudo timbrar. Revisa los datos fiscales e intenta de nuevo.',
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => !retrying && onClose()}
      />
      <div className="relative bg-background border rounded-2xl shadow-xl max-w-xl w-full mx-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <div>
              <h2 className="text-lg font-bold text-foreground">
                Reintentar timbrado
              </h2>
              <p className="text-xs text-muted-foreground">
                Venta {state.saleNumber} — ya cobrada
              </p>
            </div>
          </div>
          <button
            onClick={() => !retrying && onClose()}
            className="p-1 hover:bg-muted rounded-md transition-colors"
            disabled={retrying}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FField label="RFC *">
              <Input
                value={fiscal.rfc}
                onChange={(e) => setF('rfc', e.target.value.toUpperCase())}
                maxLength={13}
                className="font-mono"
              />
            </FField>
            <FField label="Codigo postal *">
              <Input
                value={fiscal.postalCode}
                onChange={(e) =>
                  setF(
                    'postalCode',
                    e.target.value.replace(/\D/g, '').slice(0, 5),
                  )
                }
                maxLength={5}
              />
            </FField>
            <FField label="Razon social *" full>
              <Input
                value={fiscal.legalName}
                onChange={(e) =>
                  setF('legalName', e.target.value.toUpperCase())
                }
              />
            </FField>
            <FField label="Regimen fiscal *" full>
              <select
                value={fiscal.fiscalRegime}
                onChange={(e) => setF('fiscalRegime', e.target.value)}
                className="w-full h-9 px-2 border rounded-md text-sm bg-background"
              >
                <option value="">Selecciona...</option>
                {(catalogs?.regimes ?? []).map((r) => (
                  <option key={r.Value} value={r.Value}>
                    {r.Value} — {r.Name}
                  </option>
                ))}
              </select>
            </FField>
            <FField label="Uso CFDI" full>
              <select
                value={fiscal.cfdiUse ?? 'G03'}
                onChange={(e) => setF('cfdiUse', e.target.value)}
                className="w-full h-9 px-2 border rounded-md text-sm bg-background"
              >
                {(catalogs?.cfdiUses ?? []).map((u) => (
                  <option key={u.Value} value={u.Value}>
                    {u.Value} — {u.Name}
                  </option>
                ))}
              </select>
            </FField>
            <FField label="Correo (opcional)" full>
              <Input
                type="email"
                value={fiscal.email ?? ''}
                onChange={(e) => setF('email', e.target.value)}
              />
            </FField>
            <FField label="Metodo de pago CFDI" full>
              <div className="flex gap-2">
                {(['PUE', 'PPD'] as const).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setPaymentMethod(pm)}
                    className={[
                      'flex-1 py-1.5 text-xs rounded-md border transition-colors',
                      paymentMethod === pm
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted',
                    ].join(' ')}
                  >
                    {pm}
                  </button>
                ))}
              </div>
            </FField>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={retrying}>
            Dejar pendiente
          </Button>
          <Button onClick={handleRetry} disabled={!complete || retrying}>
            {retrying ? 'Timbrando...' : 'Reintentar timbrado'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FField({
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
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
