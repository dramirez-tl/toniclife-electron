// InvoiceSaleModal - Facturar (CFDI nominativa) una venta YA cobrada desde la
// lista de ventas: el cliente decidió "a la mera hora" que sí quiere factura.
//
// Flujo: carga el detalle de la venta + datos fiscales guardados del cliente
// (si no tiene, formulario vacío con su RFC), captura/corrige, y al confirmar
// guarda los datos fiscales (POST /billing/fiscal-data) y timbra
// (POST /pos/sales/:id/stamp). Regla única del negocio: que NO esté en una
// factura global y que sea del mes natural en curso; el API lo vuelve a
// validar (fail-closed) y aquí se refleja con invoiceEligibility. NUNCA se
// manda acknowledgeGlobal desde el POS.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { posKeys, useFiscalCatalogs, usePosSale } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { getApiErrorMessage } from '@/lib/apiError';
import { formatDateTime } from '@/lib/date';
import { notifyInvoiceStamped } from '@/lib/invoiceEmail';
import {
  INVOICE_INELIGIBLE_LABELS,
  invoiceEligibility,
} from '@/lib/invoiceEligibility';
import {
  EMPTY_FISCAL_FORM,
  FiscalDataFields,
  isFiscalFormComplete,
  normalizeFiscalForm,
  type FiscalFormValue,
} from './FiscalDataFields';

interface InvoiceSaleModalProps {
  /** Venta a facturar; null = cerrado. */
  saleId: string | null;
  onClose: () => void;
  /** Tras timbrar con éxito (la lista ya se refresca aquí). */
  onStamped?: () => void;
  currencySymbol: string;
  branchTz?: string;
  branchCountryCode?: string;
  invoicingEnabled: boolean;
}

export function InvoiceSaleModal({
  saleId,
  onClose,
  onStamped,
  currencySymbol,
  branchTz,
  branchCountryCode,
  invoicingEnabled,
}: InvoiceSaleModalProps) {
  const open = !!saleId;
  const qc = useQueryClient();
  const { data: sale, isLoading: loadingSale } = usePosSale(
    saleId ?? undefined,
    open,
  );
  const { data: catalogs } = useFiscalCatalogs(open);

  const [fiscal, setFiscal] = useState<FiscalFormValue>(EMPTY_FISCAL_FORM);
  const [paymentMethod, setPaymentMethod] = useState<'PUE' | 'PPD'>('PUE');
  const [loadingFiscal, setLoadingFiscal] = useState(false);
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stamping, setStamping] = useState(false);

  // Reset al abrir otra venta.
  useEffect(() => {
    if (open) {
      setFiscal(EMPTY_FISCAL_FORM);
      setPaymentMethod('PUE');
      setPrefilledFor(null);
      setError('');
      setStamping(false);
    }
  }, [open, saleId]);

  // Pre-llenar con los datos fiscales guardados del cliente (una vez por
  // venta). Sin datos (404 / lista vacía): formulario con el RFC de la venta.
  const customerId = sale?.customerId;
  const saleRfc = sale?.customerRfc;
  useEffect(() => {
    if (!open || !saleId || !customerId || prefilledFor === saleId) return;
    let cancelled = false;
    setLoadingFiscal(true);
    void (async () => {
      try {
        const rows = await posApi.getCustomerFiscalData(customerId);
        if (cancelled) return;
        const fd = rows.find((r) => r.isDefault) ?? rows[0];
        if (fd) {
          setFiscal({
            rfc: fd.rfc ?? '',
            legalName: fd.legalName ?? '',
            fiscalRegime: fd.taxRegime ?? '',
            postalCode: fd.postalCode ?? '',
            cfdiUse: fd.defaultCfdiUse ?? 'G03',
            email: fd.email ?? '',
          });
        } else {
          setFiscal({ ...EMPTY_FISCAL_FORM, rfc: saleRfc ?? '' });
        }
      } catch {
        // Sin red o error del API: el cajero captura a mano.
        if (!cancelled) setFiscal({ ...EMPTY_FISCAL_FORM, rfc: saleRfc ?? '' });
      } finally {
        if (!cancelled) {
          setLoadingFiscal(false);
          setPrefilledFor(saleId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, saleId, customerId, saleRfc, prefilledFor]);

  // Siempre PUE: en el POS "T. Credito" (método `credit`) es TARJETA de crédito,
  // un cobro recibido en el momento (forma SAT 04), no una venta a crédito.
  // El 13-oct-2026 se forzaba PPD por ese método y Naucalpan/327 no podían
  // facturar; el API aplica la misma regla.
  useEffect(() => {
    if (open) setPaymentMethod('PUE');
  }, [open, saleId]);

  const eligibility = sale
    ? invoiceEligibility({
        sale,
        branchCountryCode,
        branchTz,
        invoicingEnabled,
      })
    : null;
  const complete = isFiscalFormComplete(fiscal);
  const canStamp =
    !!sale && !!eligibility?.eligible && complete && !stamping && !loadingFiscal;
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  async function handleStamp() {
    if (!sale || !sale.customerId || !canStamp) return;
    setStamping(true);
    setError('');
    try {
      await posApi.saveFiscalData({
        ...normalizeFiscalForm(fiscal),
        customerId: sale.customerId,
      });
      const stamped = await posApi.stampSale(sale.id, 'PUE');
      // Avisa también si el correo salió o no (el API la manda al timbrar);
      // relee la venta porque la respuesta del timbrado no trae el envío.
      void notifyInvoiceStamped(sale.id, sale.saleNumber, stamped);
      // La lista y el detalle deben reflejar el CFDI de inmediato.
      void qc.invalidateQueries({ queryKey: posKeys.all });
      onStamped?.();
      onClose();
    } catch (err) {
      // El modal queda abierto para corregir y reintentar.
      setError(
        getApiErrorMessage(
          err,
          'No se pudo timbrar. Revisa los datos fiscales e intenta de nuevo.',
        ),
      );
    } finally {
      setStamping(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !stamping) onClose();
      }}
    >
      <DialogContent
        className="z-[70] max-w-xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        overlayClassName="z-[70]"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (stamping) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (stamping) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Facturar venta
              </DialogTitle>
              <DialogDescription className="text-xs">
                {sale
                  ? `Venta ${sale.saleNumber} · ${formatDateTime(sale.createdAt, branchTz)} · ${fmt(Number(sale.total))}`
                  : 'Cargando venta...'}
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !stamping && onClose()}
            disabled={stamping}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {loadingSale || !sale ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Cargando venta...
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                Cliente:{' '}
                <span className="text-foreground">
                  {sale.customerName ?? 'Sin cliente'}
                </span>
                {sale.customerNumber ? (
                  <span className="ml-1 font-mono text-xs">
                    #{sale.customerNumber}
                  </span>
                ) : null}
              </div>

              {eligibility && !eligibility.eligible && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertDescription>
                    {INVOICE_INELIGIBLE_LABELS[eligibility.reason]}
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {loadingFiscal ? (
                <div className="text-xs text-muted-foreground">
                  Cargando datos fiscales del cliente...
                </div>
              ) : (
                <FiscalDataFields
                  value={fiscal}
                  onChange={(patch) => setFiscal((f) => ({ ...f, ...patch }))}
                  catalogs={catalogs}
                  paymentMethod={paymentMethod}
                  onPaymentMethodChange={setPaymentMethod}
                  allowPpd={false}
                  disabled={stamping || !eligibility?.eligible}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={stamping}>
            Cancelar
          </Button>
          <Button onClick={handleStamp} disabled={!canStamp}>
            <FileText />
            {stamping ? 'Timbrando...' : 'Timbrar factura'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
