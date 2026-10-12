// CorteModal - Resumen del corte del dia (ventas + desglose por metodo de pago).
// Portado de toniclife-next CorteDiaModal con dos acciones:
//   - Imprimir corte en la impresora termica configurada (ESC/POS).
//   - Descargar como CSV (Blob URL + anchor click).

import { useState } from 'react';
import { X, ClipboardList, Printer, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePosDailySummary, usePosSales } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatTime } from '@/lib/date';
import type { Sale } from '@/types/pos';

interface CorteModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
  date: string;
  currencySymbol: string;
  /** Click en una fila de venta — abre el detalle de la venta. */
  onSelectSale?: (saleId: string) => void;
}

const SIN_TERMINAL = 'Sin terminal (call center)';

/** Nombre legible de una terminal: su etiqueta o, si no tiene, el final de
 *  la clave de licencia. */
function terminalName(
  label: string | null | undefined,
  licenseKey: string | null | undefined,
): string {
  if (label && label.trim()) return label.trim();
  if (licenseKey) return `Terminal ${licenseKey.slice(-9)}`;
  return SIN_TERMINAL;
}

interface TerminalRow {
  id: string | null;
  label: string;
  salesCount: number;
  amount: number;
  cancelledCount: number;
}

export function CorteModal({
  isOpen,
  onClose,
  branchId,
  branchName,
  date,
  currencySymbol,
  onSelectSale,
}: CorteModalProps) {
  const { data: summary, isLoading: loadingSummary } = usePosDailySummary(
    branchId,
    date,
    isOpen,
  );
  const { data: salesResp, isLoading: loadingSales } = usePosSales(
    isOpen ? branchId : undefined,
    date,
  );

  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const sales: Sale[] = salesResp?.data ?? [];
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  const busy = printing || exporting;
  const hasData = !!summary && !loadingSummary;

  const paymentRows: Array<{ label: string; value: number }> = summary
    ? [
        { label: 'Efectivo', value: summary.totalCash },
        { label: 'Tarjeta', value: summary.totalCard },
        { label: 'Credito', value: summary.totalCredit },
        { label: 'Transferencia', value: summary.totalTransfer },
        { label: 'Mercado Pago', value: summary.totalMercadoPago },
        { label: 'Cashback', value: summary.totalCashback },
        { label: 'Promocion', value: summary.totalPromotion },
        { label: 'USD efectivo', value: summary.totalUsdCash },
        { label: 'Deposito', value: summary.totalDeposit ?? 0 },
        { label: 'Mixto', value: summary.totalMixed },
      ].filter((r) => Number(r.value) > 0)
    : [];

  // Desglose por terminal (licencia POS). Solo se muestra e imprime cuando la
  // sucursal cobró con más de una terminal ese día: ahí el supervisor
  // necesita separar el corte por caja.
  const terminalRows: TerminalRow[] = (summary?.byTerminal ?? []).map((t) => ({
    id: t.posLicenseId,
    label: terminalName(t.label, t.licenseKey),
    salesCount: Number(t.salesCount),
    amount: Number(t.totalAmount),
    cancelledCount: Number(t.cancelledCount),
  }));
  const multiTerminal = terminalRows.length > 1;
  const saleTerminal = (s: Sale): string =>
    s.posLicenseId
      ? terminalName(s.posLicenseLabel, s.posLicenseKey)
      : SIN_TERMINAL;

  async function handlePrint() {
    if (!summary) return;
    setPrinting(true);
    const r = await window.toniclife.printer.printCorte({
      branchName,
      date,
      currencySymbol,
      totalSales: Number(summary.totalSales),
      totalAmount: Number(summary.totalAmount),
      averageTicket: Number(summary.averageTicket),
      itemsSold: Number(summary.itemsSold),
      totalRefunds: Number(summary.totalRefunds),
      refundsCount: Number(summary.refundsCount),
      payments: paymentRows.map((p) => ({
        label: p.label,
        amount: Number(p.value),
      })),
      terminals: terminalRows.map((t) => ({
        label: t.label,
        salesCount: t.salesCount,
        amount: t.amount,
      })),
      sales: sales.map((s) => ({
        saleNumber: s.saleNumber,
        createdAt: s.createdAt,
        customerName: s.customerName,
        total: Number(s.total),
        terminal: multiTerminal ? saleTerminal(s) : undefined,
      })),
    });
    setPrinting(false);
    if (r.ok) {
      toast.success('Corte enviado a la impresora.');
    } else {
      toast.error(`Error de impresion: ${r.error}`);
    }
  }

  function handleDownloadCsv() {
    if (!summary) return;
    setExporting(true);
    try {
      const csv = buildCorteCsv({
        branchName,
        date,
        summary,
        paymentRows,
        terminalRows: multiTerminal ? terminalRows : [],
        saleTerminal: multiTerminal ? saleTerminal : undefined,
        sales,
      });
      // BOM UTF-8 para que Excel detecte acentos correctamente.
      const blob = new Blob(['﻿' + csv], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeDate = date.replaceAll('-', '');
      const safeBranch = branchName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      a.href = url;
      a.download = `corte-${safeBranch}-${safeDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV descargado.');
    } catch (err) {
      toast.error(
        `No se pudo generar el CSV: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Corte del dia
              </DialogTitle>
              <DialogDescription className="text-xs">
                {branchName} · {date}
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {loadingSummary ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Cargando resumen...
            </div>
          ) : !summary ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No hay datos para esta fecha.
            </div>
          ) : (
            <>
              {/* Tarjetas de resumen */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Ventas"
                  value={String(summary.totalSales)}
                />
                <StatCard
                  label="Monto total"
                  value={fmt(Number(summary.totalAmount))}
                  highlight
                />
                <StatCard
                  label="Ticket promedio"
                  value={fmt(Number(summary.averageTicket))}
                />
                <StatCard
                  label="Items vendidos"
                  value={String(summary.itemsSold)}
                />
              </div>

              {/* Desglose por metodo de pago */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Desglose por metodo de pago
                </h3>
                {paymentRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Sin pagos registrados.
                  </p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {paymentRows.map((r) => (
                      <div
                        key={r.label}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {r.label}
                        </span>
                        <span className="font-medium text-foreground tabular-nums">
                          {fmt(Number(r.value))}
                        </span>
                      </div>
                    ))}
                    {Number(summary.totalRefunds) > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 text-sm bg-red-50/60">
                        <span className="text-red-700">
                          Reembolsos ({summary.refundsCount})
                        </span>
                        <span className="font-medium text-red-700 tabular-nums">
                          - {fmt(Number(summary.totalRefunds))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Desglose por terminal: solo con varias cajas en el dia */}
              {multiTerminal && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Ventas por terminal
                  </h3>
                  <div className="rounded-lg border divide-y">
                    {terminalRows.map((t) => (
                      <div
                        key={t.id ?? 'sin-terminal'}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {t.label}
                          <span className="ml-1.5 text-xs text-muted-foreground/80">
                            · {t.salesCount}{' '}
                            {t.salesCount === 1 ? 'venta' : 'ventas'}
                            {t.cancelledCount > 0
                              ? ` · ${t.cancelledCount} cancelada${t.cancelledCount === 1 ? '' : 's'}`
                              : ''}
                          </span>
                        </span>
                        <span className="font-medium text-foreground tabular-nums">
                          {fmt(t.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabla de ventas */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Ventas del dia ({sales.length})
                </h3>
                {(salesResp?.total ?? 0) > sales.length && (
                  <p className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                    Mostrando {sales.length} de {salesResp?.total} ventas del
                    dia — el resumen de totales SI incluye todas.
                  </p>
                )}
                {loadingSales ? (
                  <p className="text-xs text-muted-foreground">Cargando...</p>
                ) : sales.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Sin ventas.
                  </p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <Table className="text-sm">
                      <TableHeader className="bg-muted/60">
                        <TableRow>
                          <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                            Folio
                          </TableHead>
                          <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                            Hora
                          </TableHead>
                          <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                            Cliente
                          </TableHead>
                          {multiTerminal && (
                            <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                              Terminal
                            </TableHead>
                          )}
                          <TableHead className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                            Total
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y">
                        {sales.map((s) => (
                          <TableRow
                            key={s.id}
                            onClick={() => onSelectSale?.(s.id)}
                            className={
                              onSelectSale
                                ? 'cursor-pointer hover:bg-muted/50 transition-colors'
                                : ''
                            }
                            title={
                              onSelectSale ? 'Ver detalle de la venta' : undefined
                            }
                          >
                            <TableCell className="px-3 py-1.5 font-mono text-xs">
                              {s.saleNumber}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-muted-foreground">
                              {formatTime(s.createdAt)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-muted-foreground truncate max-w-[10rem]">
                              {s.customerName ?? 'Publico'}
                            </TableCell>
                            {multiTerminal && (
                              <TableCell className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[8rem]">
                                {saleTerminal(s)}
                              </TableCell>
                            )}
                            <TableCell className="px-3 py-1.5 text-right font-medium tabular-nums">
                              {fmt(Number(s.total))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={!hasData || exporting || printing}
              size="sm"
            >
              <Download />
              {exporting ? 'Generando...' : 'Descargar CSV'}
            </Button>
            <Button
              onClick={handlePrint}
              disabled={!hasData || printing || exporting}
              size="sm"
            >
              <Printer />
              {printing ? 'Imprimiendo...' : 'Imprimir corte'}
            </Button>
          </div>
          <Button variant="outline" onClick={onClose} disabled={printing}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CSV
// ============================================================================

interface CsvInput {
  branchName: string;
  date: string;
  summary: {
    totalSales: number;
    totalAmount: number;
    averageTicket: number;
    itemsSold: number;
    totalRefunds: number;
    refundsCount: number;
  };
  paymentRows: Array<{ label: string; value: number }>;
  /** Vacío cuando la sucursal cobró con una sola terminal (no se exporta). */
  terminalRows: TerminalRow[];
  /** Nombre de la terminal de cada venta (solo con varias terminales). */
  saleTerminal?: (s: Sale) => string;
  sales: Sale[];
}

/** Escapa un valor para CSV (RFC 4180): quote si contiene coma, comilla o LF. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCorteCsv(input: CsvInput): string {
  const { summary, paymentRows, sales } = input;
  const lines: string[] = [];

  lines.push('Corte del dia');
  lines.push(`Sucursal,${csvCell(input.branchName)}`);
  lines.push(`Fecha,${csvCell(input.date)}`);
  lines.push('');

  lines.push('RESUMEN');
  lines.push(`Ventas,${summary.totalSales}`);
  lines.push(`Monto total,${Number(summary.totalAmount).toFixed(2)}`);
  lines.push(`Ticket promedio,${Number(summary.averageTicket).toFixed(2)}`);
  lines.push(`Items vendidos,${summary.itemsSold}`);
  if (summary.refundsCount > 0) {
    lines.push(`Reembolsos (count),${summary.refundsCount}`);
    lines.push(
      `Reembolsos (monto),-${Number(summary.totalRefunds).toFixed(2)}`,
    );
  }
  lines.push('');

  lines.push('DESGLOSE POR METODO DE PAGO');
  lines.push('Metodo,Monto');
  for (const row of paymentRows) {
    lines.push(`${csvCell(row.label)},${Number(row.value).toFixed(2)}`);
  }
  lines.push('');

  if (input.terminalRows.length > 0) {
    lines.push('VENTAS POR TERMINAL');
    lines.push('Terminal,Ventas,Canceladas,Monto');
    for (const t of input.terminalRows) {
      lines.push(
        [
          csvCell(t.label),
          t.salesCount,
          t.cancelledCount,
          Number(t.amount).toFixed(2),
        ].join(','),
      );
    }
    lines.push('');
  }

  const withTerminal = !!input.saleTerminal;
  lines.push('VENTAS DEL DIA');
  lines.push(
    withTerminal ? 'Folio,Hora,Cliente,Terminal,Total' : 'Folio,Hora,Cliente,Total',
  );
  for (const s of sales) {
    lines.push(
      [
        csvCell(s.saleNumber),
        csvCell(formatTime(s.createdAt)),
        csvCell(s.customerName ?? 'Publico'),
        ...(withTerminal ? [csvCell(input.saleTerminal!(s))] : []),
        Number(s.total).toFixed(2),
      ].join(','),
    );
  }

  return lines.join('\r\n');
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div
        className={[
          'mt-1 font-bold tabular-nums',
          highlight ? 'text-primary text-lg' : 'text-foreground text-base',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
