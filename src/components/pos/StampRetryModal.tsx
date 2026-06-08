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
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { cn } from '@/lib/utils';
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
    <Dialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open && !retrying) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (retrying) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (retrying) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Reintentar timbrado
              </DialogTitle>
              <DialogDescription className="text-xs">
                Venta {state.saleNumber} — ya cobrada
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !retrying && onClose()}
            disabled={retrying}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

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
              <Select
                value={fiscal.fiscalRegime}
                onValueChange={(v) => setF('fiscalRegime', v)}
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
                value={fiscal.cfdiUse ?? 'G03'}
                onValueChange={(v) => setF('cfdiUse', v)}
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
                value={fiscal.email ?? ''}
                onChange={(e) => setF('email', e.target.value)}
              />
            </FField>
            <FField label="Metodo de pago CFDI" full>
              <div className="flex gap-2">
                {(['PUE', 'PPD'] as const).map((pm) => (
                  <Button
                    key={pm}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentMethod(pm)}
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
            </FField>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={retrying}>
            Dejar pendiente
          </Button>
          <Button onClick={handleRetry} disabled={!complete || retrying}>
            {retrying ? 'Timbrando...' : 'Reintentar timbrado'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
