// PaymentModal - Modal de cobro del POS, con seccion de facturacion CFDI.
//
// Flujo:
//   - Metodo de pago unico (efectivo con calculo de cambio, o tarjeta/transfer).
//   - Si hay cliente seleccionado: opcion "requiere factura" -> formulario
//     fiscal (RFC, razon social, regimen, CP, uso CFDI, email, PUE/PPD).
//   - Al confirmar devuelve { payments, invoice? } a PosScreen, que crea la
//     venta, procesa el pago y (si aplica) guarda datos fiscales + timbra.

import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, ArrowLeftRight, Check, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { posApi } from '@/lib/posApi';
import { useFiscalCatalogs, usePosCustomerFiscalData } from '@/hooks/usePos';
import {
  PosPaymentMethod,
  type CreatePaymentInput,
  type InvoiceRequest,
} from '@/types/pos';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  currencySymbol: string;
  currencyCode: string;
  /** País de la sucursal (ISO-2). 'MX' = facturación CFDI; otros (US) = QuickBooks (próximamente). */
  branchCountry?: string;
  customerId?: string;
  customerRfc?: string;
  isProcessing: boolean;
  onConfirm: (
    payments: CreatePaymentInput[],
    invoice?: InvoiceRequest,
  ) => Promise<void> | void;
}

const METHODS: Array<{ method: PosPaymentMethod; label: string }> = [
  { method: PosPaymentMethod.CASH, label: 'Efectivo' },
  { method: PosPaymentMethod.CARD, label: 'T. Debito' },
  { method: PosPaymentMethod.CREDIT, label: 'T. Credito' },
  { method: PosPaymentMethod.TRANSFER, label: 'Transferencia' },
  { method: PosPaymentMethod.MERCADO_PAGO, label: 'Mercado Pago' },
  { method: PosPaymentMethod.CASHBACK, label: 'Cashback' },
  { method: PosPaymentMethod.PROMOTION, label: 'Promocion' },
  { method: PosPaymentMethod.USD_CASH, label: 'USD Efectivo' },
  { method: PosPaymentMethod.UNDEFINED, label: 'Sin definir' },
];

const QUICK_AMOUNTS = [50, 100, 200, 500, 1000];

const EMPTY_FISCAL = {
  rfc: '',
  legalName: '',
  fiscalRegime: '',
  postalCode: '',
  cfdiUse: 'G03',
  email: '',
};

function methodIcon(method: PosPaymentMethod) {
  if (method === PosPaymentMethod.CASH || method === PosPaymentMethod.USD_CASH) {
    return <Banknote className="size-4" />;
  }
  if (method === PosPaymentMethod.TRANSFER) {
    return <ArrowLeftRight className="size-4" />;
  }
  return <CreditCard className="size-4" />;
}

export function PaymentModal({
  isOpen,
  onClose,
  total,
  currencySymbol,
  currencyCode,
  branchCountry,
  customerId,
  customerRfc,
  isProcessing,
  onConfirm,
}: PaymentModalProps) {
  // México = CFDI (Facturama). Otros países (p. ej. US) no usan CFDI: su
  // facturación (QuickBooks) se habilitará después. Default MX si no llega país.
  const isMx = (branchCountry ?? 'MX').toUpperCase() === 'MX';
  const [method, setMethod] = useState<PosPaymentMethod>(PosPaymentMethod.CASH);
  const [received, setReceived] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<
    Array<{ method: PosPaymentMethod; amount: string }>
  >([]);
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [fiscal, setFiscal] = useState(EMPTY_FISCAL);
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState<
    'PUE' | 'PPD'
  >('PUE');
  const [prefilled, setPrefilled] = useState(false);

  const { data: catalogs } = useFiscalCatalogs(isOpen && wantsInvoice);
  const { data: existingFiscal } = usePosCustomerFiscalData(
    customerId,
    isOpen && wantsInvoice,
  );

  // Reset al abrir.
  useEffect(() => {
    if (isOpen) {
      setMethod(PosPaymentMethod.CASH);
      setReceived('');
      setSplitMode(false);
      setSplitPayments([]);
      setWantsInvoice(false);
      setFiscal({ ...EMPTY_FISCAL, rfc: customerRfc ?? '' });
      setInvoicePaymentMethod('PUE');
      setPrefilled(false);
    }
  }, [isOpen, customerRfc]);

  // Pre-llenar con los datos fiscales guardados del cliente (una vez).
  useEffect(() => {
    if (wantsInvoice && !prefilled && existingFiscal && existingFiscal[0]) {
      const fd = existingFiscal[0];
      setFiscal({
        rfc: fd.rfc ?? '',
        legalName: fd.legalName ?? '',
        fiscalRegime: fd.taxRegime ?? '',
        postalCode: fd.postalCode ?? '',
        cfdiUse: fd.defaultCfdiUse ?? 'G03',
        email: fd.email ?? '',
      });
      setPrefilled(true);
    }
  }, [wantsInvoice, prefilled, existingFiscal]);

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const isCash =
    method === PosPaymentMethod.CASH || method === PosPaymentMethod.USD_CASH;

  const receivedNum = useMemo(() => {
    const n = parseFloat(received);
    return Number.isFinite(n) ? n : 0;
  }, [received]);
  const change = useMemo(
    () => Math.max(0, receivedNum - total),
    [receivedNum, total],
  );

  const fiscalComplete =
    !wantsInvoice ||
    (fiscal.rfc.trim() &&
      fiscal.legalName.trim() &&
      fiscal.fiscalRegime &&
      fiscal.postalCode.trim());

  // Multi-pago: la suma de los pagos debe igualar el total exacto.
  const splitTotal = useMemo(
    () =>
      splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
    [splitPayments],
  );
  const splitRemaining = total - splitTotal;
  const splitOk = Math.abs(splitRemaining) < 0.01;

  const canConfirm =
    (splitMode ? splitOk : isCash ? receivedNum >= total : true) &&
    fiscalComplete &&
    !isProcessing;

  function setF(k: keyof typeof EMPTY_FISCAL, v: string) {
    setFiscal((f) => ({ ...f, [k]: v }));
  }

  function enterSplitMode() {
    // Inicia con un pago en efectivo por el total; el cajero ajusta.
    setSplitPayments([
      { method: PosPaymentMethod.CASH, amount: total.toFixed(2) },
    ]);
    setSplitMode(true);
  }

  function addSplitRow() {
    const rem = total - splitTotal;
    setSplitPayments((rows) => [
      ...rows,
      {
        method: PosPaymentMethod.CARD,
        amount: rem > 0 ? rem.toFixed(2) : '',
      },
    ]);
  }

  function updateSplitRow(
    idx: number,
    patch: Partial<{ method: PosPaymentMethod; amount: string }>,
  ) {
    setSplitPayments((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  function removeSplitRow(idx: number) {
    setSplitPayments((rows) => rows.filter((_, i) => i !== idx));
  }

  function handleConfirm() {
    if (!canConfirm || isProcessing) return;

    let payments: CreatePaymentInput[];
    if (splitMode) {
      payments = splitPayments
        .filter((p) => (parseFloat(p.amount) || 0) > 0)
        .map((p) => ({
          paymentMethod: p.method,
          amount: parseFloat(p.amount),
        }));
    } else {
      payments = [
        {
          paymentMethod: method,
          amount: total,
          ...(isCash ? { amountReceived: receivedNum } : {}),
        },
      ];
    }

    let invoice: InvoiceRequest | undefined;
    if (wantsInvoice && customerId) {
      invoice = {
        fiscalData: {
          customerId,
          rfc: fiscal.rfc.trim().toUpperCase(),
          legalName: fiscal.legalName.trim().toUpperCase(),
          fiscalRegime: fiscal.fiscalRegime,
          postalCode: fiscal.postalCode.trim(),
          cfdiUse: fiscal.cfdiUse || undefined,
          email: fiscal.email.trim() || undefined,
        },
        invoicePaymentMethod,
      };
    }
    void onConfirm(payments, invoice);
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isProcessing) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (isProcessing) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isProcessing) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div>
            <DialogTitle className="text-lg font-bold text-foreground">
              Cobrar venta
            </DialogTitle>
            <DialogDescription className="text-xs">
              Selecciona el metodo de pago
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !isProcessing && onClose()}
            disabled={isProcessing}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Total */}
        <div className="px-6 py-4 bg-primary/5 border-b text-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Total a cobrar
          </div>
          <div className="text-3xl font-bold text-primary tabular-nums">
            {fmt(total)}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {currencyCode}
            </span>
          </div>
        </div>

        {/* Metodos */}
        <div className="px-6 py-4">
          {/* --- Pago simple --- */}
          {!splitMode && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <Button
                    key={m.method}
                    type="button"
                    variant="outline"
                    onClick={() => setMethod(m.method)}
                    disabled={isProcessing}
                    className={cn(
                      'flex h-auto flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-medium',
                      method === m.method &&
                        'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                    )}
                  >
                    {methodIcon(m.method)}
                    {m.label}
                  </Button>
                ))}
              </div>

              {/* Efectivo: monto recibido + cambio */}
              {isCash && (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm">Monto recibido</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      placeholder="0.00"
                      className="text-lg text-right tabular-nums h-12"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setReceived(total.toFixed(2))}
                    >
                      Exacto
                    </Button>
                    {QUICK_AMOUNTS.map((amt) => (
                      <Button
                        key={amt}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReceived(String(amt))}
                      >
                        {fmt(amt)}
                      </Button>
                    ))}
                  </div>
                  <div className="flex justify-between items-baseline rounded-lg bg-muted/50 px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">
                      Cambio
                    </span>
                    <span
                      className={cn(
                        'text-xl font-bold tabular-nums',
                        receivedNum >= total
                          ? 'text-emerald-600'
                          : 'text-muted-foreground',
                      )}
                    >
                      {fmt(change)}
                    </span>
                  </div>
                  {receivedNum > 0 && receivedNum < total && (
                    <p className="text-xs text-destructive">
                      El monto recibido no cubre el total.
                    </p>
                  )}
                </div>
              )}

              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={enterSplitMode}
                disabled={isProcessing}
                className="mt-3 h-auto p-0 text-xs"
              >
                Dividir en varios metodos de pago
              </Button>
            </>
          )}

          {/* --- Multi-pago --- */}
          {splitMode && (
            <div className="space-y-3">
              {splitPayments.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    value={row.method}
                    onValueChange={(v) =>
                      updateSplitRow(idx, { method: v as PosPaymentMethod })
                    }
                    disabled={isProcessing}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m.method} value={m.method}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) =>
                      updateSplitRow(idx, { amount: e.target.value })
                    }
                    placeholder="0.00"
                    className="flex-1 text-right tabular-nums"
                    disabled={isProcessing}
                  />
                  {splitPayments.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSplitRow(idx)}
                      disabled={isProcessing}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={addSplitRow}
                  disabled={isProcessing}
                  className="h-auto p-0 text-xs"
                >
                  + Agregar metodo de pago
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => setSplitMode(false)}
                  disabled={isProcessing}
                  className="h-auto p-0 text-xs text-muted-foreground"
                >
                  Volver a pago simple
                </Button>
              </div>

              <div
                className={cn(
                  'flex items-center justify-between rounded-lg px-4 py-2.5 text-sm',
                  splitOk
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-muted/60 text-muted-foreground',
                )}
              >
                <span>
                  Ingresado {fmt(splitTotal)} de {fmt(total)}
                </span>
                <span className="font-bold tabular-nums">
                  {splitOk
                    ? 'Completo'
                    : splitRemaining > 0
                      ? `Falta ${fmt(splitRemaining)}`
                      : `Sobra ${fmt(-splitRemaining)}`}
                </span>
              </div>
            </div>
          )}

          {/* Facturación fuera de México (US): CFDI no aplica; QuickBooks próximamente */}
          {!isMx && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm">
                <FileText className="size-4 text-primary mt-0.5 shrink-0" />
                <div className="text-muted-foreground">
                  <p className="font-medium text-foreground">Facturación</p>
                  <p>
                    La factura CFDI solo aplica en México. La facturación electrónica
                    de esta sucursal (QuickBooks) estará disponible próximamente.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Facturacion CFDI — solo México y solo si hay cliente */}
          {isMx && customerId && (
            <div className="mt-4 border-t pt-4">
              <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Checkbox
                  checked={wantsInvoice}
                  onCheckedChange={(c) => setWantsInvoice(c === true)}
                />
                <FileText className="size-4 text-primary" />
                Requiere factura (CFDI)
              </Label>

              {wantsInvoice && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <FField label="RFC *">
                    <Input
                      value={fiscal.rfc}
                      onChange={(e) =>
                        setF('rfc', e.target.value.toUpperCase())
                      }
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
                      value={fiscal.cfdiUse}
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
                      value={fiscal.email}
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
                          onClick={() => setInvoicePaymentMethod(pm)}
                          className={cn(
                            'flex-1',
                            invoicePaymentMethod === pm &&
                              'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                          )}
                        >
                          {pm}
                          {pm === 'PUE'
                            ? ' — una exhibicion'
                            : ' — diferido'}
                        </Button>
                      ))}
                    </div>
                  </FField>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm || isProcessing}
            size="lg"
          >
            <Check />
            {isProcessing ? 'Procesando...' : `Confirmar pago ${fmt(total)}`}
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
