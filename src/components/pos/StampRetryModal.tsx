// StampRetryModal - Reintento de timbrado CFDI cuando el timbrado automatico
// falla tras el pago. Permite corregir los datos fiscales y reintentar.
//
// La venta YA esta cobrada; este modal solo gestiona la factura. Si el cajero
// cierra sin lograrlo, la venta queda con requiresInvoice=true y puede
// completarse despues desde "Facturar" en ventas recientes o desde el admin.

import { useEffect, useState } from 'react';
import { X, AlertTriangle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFiscalCatalogs } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { notifyInvoiceStamped } from '@/lib/invoiceEmail';
import type { CreateFiscalDataInput } from '@/types/pos';
import {
  FiscalDataFields,
  isFiscalFormComplete,
  normalizeFiscalForm,
} from './FiscalDataFields';

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

  const complete = isFiscalFormComplete(fiscal);

  async function handleRetry() {
    if (!fiscal || !complete || !state) return;
    setRetrying(true);
    setError('');
    try {
      await posApi.saveFiscalData({
        ...normalizeFiscalForm(fiscal),
        customerId: fiscal.customerId,
      });
      const stamped = await posApi.stampSale(state.saleId, paymentMethod);
      // Avisa también si el correo salió o no (el API la manda al timbrar);
      // relee la venta porque la respuesta del timbrado no trae el envío.
      void notifyInvoiceStamped(state.saleId, state.saleNumber, stamped);
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

          <FiscalDataFields
            value={fiscal}
            onChange={(patch) =>
              setFiscal((f) => (f ? { ...f, ...patch } : f))
            }
            catalogs={catalogs}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            disabled={retrying}
          />
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
