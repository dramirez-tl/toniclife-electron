// CorteModal - Resumen del corte (ventas + desglose por metodo de pago).
// Portado de toniclife-next CorteDiaModal con dos acciones:
//   - Imprimir corte en la impresora termica configurada (ESC/POS).
//   - Descargar como CSV (Blob URL + anchor click).
// El corte respeta el MISMO rango De/Hasta y el MISMO filtro de caja que el
// panel "Ventas recientes" (estado compartido en PosScreen): un solo día =
// "Corte del día"; varios días = "Corte de ventas".

import { Fragment, useMemo, useState } from 'react';
import {
  X,
  ClipboardList,
  Printer,
  Download,
  Monitor,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  usePosDailySummary,
  usePosSales,
  usePosSalesByProduct,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatTime, localDateOf } from '@/lib/date';
import { isCfdiCountry } from '@/lib/invoiceEligibility';
import {
  ALL_TERMINALS,
  saleTerminalName,
  terminalFilterLabel,
  terminalFilterParams,
  terminalRowsFromSummary,
  type TerminalOption,
  type TerminalRow,
} from '@/lib/terminalRows';
import type { Sale } from '@/types/pos';
import { GlobalDayCard } from './GlobalDayCard';
import { GlobalDaysTable } from './GlobalDaysTable';
import type { SalesRange } from './RecentSales';

interface CorteModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
  /** Zona horaria de la sucursal: horas y día local de cada venta. */
  branchTz?: string;
  /** Rango De/Hasta del panel de ventas (días locales, máx. 31). */
  range: SalesRange;
  /** Filtro de caja compartido con el panel (ALL_TERMINALS | SIN_TERMINAL_KEY
   *  | posLicenseId); cambiarlo aquí también cambia el panel. */
  terminalFilter: string;
  onTerminalFilterChange: (filter: string) => void;
  /** Cajas que aparecen en el rango (etiqueta por clave). */
  terminalOptions: TerminalOption[];
  currencySymbol: string;
  /** Click en una fila de venta — abre el detalle de la venta. */
  onSelectSale?: (saleId: string) => void;
  /** Interruptor "Facturación" de la terminal: habilita emitir la global
   *  del día desde el corte. undefined = apagado (fail-closed). */
  invoicingEnabled?: boolean;
  /** ISO-2 del país de la sucursal: la factura global (CFDI) solo se muestra
   *  en MX / FN, igual que el botón "Facturar" del panel de ventas. */
  branchCountryCode?: string;
}

export function CorteModal({
  isOpen,
  onClose,
  branchId,
  branchName,
  branchTz,
  range,
  terminalFilter,
  onTerminalFilterChange,
  terminalOptions,
  currencySymbol,
  onSelectSale,
  invoicingEnabled = false,
  branchCountryCode,
}: CorteModalProps) {
  const filterParams = terminalFilterParams(terminalFilter);
  const filtered = terminalFilter !== ALL_TERMINALS;

  const { data: summary, isLoading: loadingSummary } = usePosDailySummary(
    branchId,
    { from: range.from, to: range.to, ...filterParams },
    isOpen,
  );

  // Guardia de compatibilidad: el API viejo (producción) solo entiende
  // `date` y responde SIN fromDate. En ese caso sus cifras son del día
  // "Hasta" y de TODAS las cajas: se avisa y toda la vista (título, tabla,
  // ticket, CSV) se degrada a ese día sin filtro, para no mezclar números
  // filtrados con un resumen que no lo está.
  const legacyApi = !!summary && summary.fromDate == null;
  const from = legacyApi ? range.to : range.from;
  const to = range.to;
  const effectiveFilter = legacyApi ? ALL_TERMINALS : terminalFilter;
  const effectiveFiltered = effectiveFilter !== ALL_TERMINALS;
  const singleDay = from === to;
  // El aviso solo cuando lo pedido difiere de lo que el servidor devolvió.
  const showLegacyNotice =
    legacyApi && (range.from !== range.to || filtered);

  const { data: salesResp, isLoading: loadingSales } = usePosSales(
    isOpen ? branchId : undefined,
    from,
    to,
    legacyApi ? {} : filterParams,
  );

  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Ventas por producto con folio (CEDEAS): lo que la tienda resurte.
  const [exportingProducts, setExportingProducts] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(
    () => new Set(),
  );
  const { data: byProduct, isLoading: loadingByProduct } = usePosSalesByProduct(
    isOpen ? branchId : undefined,
    from,
    to,
  );

  const sales: Sale[] = salesResp?.data ?? [];
  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);

  const busy = printing || exporting || exportingProducts;
  const hasData = !!summary && !loadingSummary;

  /** Excel VENTAS_POR_PRODUCTO de la sucursal: se guarda en temporales y se
   *  abre con Excel (mismo camino que el PDF de la factura). */
  async function handleDownloadProductsXlsx() {
    setExportingProducts(true);
    try {
      const { bytes, filename } = await posApi.getSalesByProductXlsx(
        branchId,
        from,
        to,
      );
      const r = await window.toniclife.invoice.openPdf(
        filename,
        new Uint8Array(bytes),
      );
      if (r.ok) toast.success('Excel de ventas por producto generado.');
      else toast.error('No se pudo abrir el Excel', { description: r.error });
    } catch (err) {
      toast.error(
        `No se pudo generar el Excel: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExportingProducts(false);
    }
  }

  const toggleProduct = (productId: string) =>
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const title = singleDay ? 'Corte del día' : 'Corte de ventas';
  const cajaLabel = effectiveFiltered
    ? terminalFilterLabel(effectiveFilter, terminalOptions)
    : undefined;
  const subtitle =
    `${branchName} · ${singleDay ? from : `del ${from} al ${to}`}` +
    (cajaLabel ? ` · ${cajaLabel}` : '');

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
  // sucursal cobró con más de una terminal en el rango y NO se filtró por
  // caja: ahí el supervisor necesita separar el corte por caja.
  const terminalRows: TerminalRow[] = terminalRowsFromSummary(
    summary?.byTerminal,
  );
  const multiTerminal = !effectiveFiltered && terminalRows.length > 1;
  const saleTerminal = (s: Sale): string => saleTerminalName(s);

  // Día local de cada venta (solo con varios días: columna "Fecha" y
  // agrupación en el ticket). Calculado una vez por lote, no por render.
  const saleDays = useMemo(() => {
    const m = new Map<string, string>();
    if (!singleDay) {
      for (const s of sales) m.set(s.id, localDateOf(s.createdAt, branchTz));
    }
    return m;
  }, [sales, singleDay, branchTz]);
  const saleDay = (s: Sale): string | undefined => saleDays.get(s.id);

  async function handlePrint() {
    if (!summary) return;
    setPrinting(true);
    const r = await window.toniclife.printer.printCorte({
      branchName,
      date: from,
      ...(singleDay ? {} : { dateTo: to }),
      ...(cajaLabel ? { terminalLabel: cajaLabel } : {}),
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
      terminals: multiTerminal
        ? terminalRows.map((t) => ({
            label: t.label,
            salesCount: t.salesCount,
            amount: t.amount,
          }))
        : [],
      sales: sales.map((s) => ({
        saleNumber: s.saleNumber,
        createdAt: s.createdAt,
        customerName: s.customerName,
        total: Number(s.total),
        terminal: multiTerminal ? saleTerminal(s) : undefined,
        day: saleDay(s),
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
        from,
        to,
        terminalLabel: cajaLabel,
        branchTz,
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
      a.href = url;
      a.download = corteCsvFilename({
        branchName,
        from,
        to,
        terminalLabel: cajaLabel,
      });
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
    // Panel lateral (80 % del ancho): el corte de un rango con varias cajas
    // necesita más espacio que un modal centrado — KPIs en una fila,
    // desgloses lado a lado y la tabla de ventas completa.
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-[80vw] sm:max-w-[80vw] gap-0 p-0"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        {/* Header: título + rango a la izquierda, selector de caja a la derecha */}
        <SheetHeader className="flex-row items-center justify-between gap-4 space-y-0 px-6 py-4 border-b text-left">
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList className="size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <SheetTitle className="text-lg font-bold text-foreground">
                {title}
              </SheetTitle>
              <SheetDescription className="text-xs truncate">
                {subtitle}
              </SheetDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Selector de caja: mismo estado que el panel de ventas */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Caja:
              </span>
              <Select
                value={terminalFilter}
                onValueChange={onTerminalFilterChange}
                disabled={busy}
              >
                <SelectTrigger
                  size="sm"
                  className="w-56 text-xs"
                  title="Corte de todas las cajas o de una en específico"
                >
                  <Monitor className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Todas las cajas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TERMINALS}>Todas las cajas</SelectItem>
                  {terminalOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </div>
        </SheetHeader>

        {/* Body (scroll propio; header y footer fijos) */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {showLegacyNotice && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              El corte por rango y por caja requiere la versión nueva del
              servidor; se muestra solo el día {to}.
            </p>
          )}

          {loadingSummary ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Cargando resumen...
            </div>
          ) : !summary ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {singleDay
                ? 'No hay datos para esta fecha.'
                : 'No hay datos para este rango.'}
            </div>
          ) : (
            <>
              {/* Tarjetas de resumen */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

              {/* Desgloses lado a lado (pagos · cajas · factura global) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
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

              {/* Desglose por terminal: solo con varias cajas y sin filtro */}
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

              {/* Factura global (público en general) del día: solo con un
                  día y en sucursales que emiten CFDI */}
              {isOpen && singleDay && isCfdiCountry(branchCountryCode) && (
                <GlobalDayCard
                  branchId={branchId}
                  branchName={branchName}
                  day={to}
                  currencySymbol={currencySymbol}
                  invoicingEnabled={invoicingEnabled}
                />
              )}
              </div>

              {/* Varios días: la global de CADA día del rango, con "Emitir"
                  en los que están listos (el corte es donde el cajero cierra
                  sus días). */}
              {isOpen && !singleDay && isCfdiCountry(branchCountryCode) && (
                <GlobalDaysTable
                  branchId={branchId}
                  branchName={branchName}
                  from={from}
                  to={to}
                  currencySymbol={currencySymbol}
                  invoicingEnabled={invoicingEnabled}
                />
              )}

              {/* Tabla de ventas */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Ventas ({sales.length})
                </h3>
                {(salesResp?.total ?? 0) > sales.length && (
                  <p className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                    Mostrando {sales.length} de {salesResp?.total} ventas — el
                    resumen de totales SI incluye todas.
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
                          {!singleDay && (
                            <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                              Fecha
                            </TableHead>
                          )}
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
                            {!singleDay && (
                              <TableCell className="px-3 py-1.5 text-muted-foreground tabular-nums">
                                {saleDay(s)}
                              </TableCell>
                            )}
                            <TableCell className="px-3 py-1.5 text-muted-foreground">
                              {formatTime(s.createdAt, branchTz)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-muted-foreground truncate max-w-[22rem]">
                              {s.customerName ?? 'Publico'}
                              {s.customerNumber ? (
                                <span className="ml-1 text-xs text-muted-foreground/80">
                                  #{s.customerNumber}
                                </span>
                              ) : null}
                            </TableCell>
                            {multiTerminal && (
                              <TableCell className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[12rem]">
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

              {/* Ventas por producto con folio (CEDEAS): cada producto vendido
                  con la venta a la que pertenece, para resurtir lo mismo. */}
              {byProduct && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Ventas por producto ({byProduct.products.length}
                      {byProduct.products.length === 1 ? ' producto' : ' productos'}
                      {' · '}
                      {byProduct.totals.units} piezas)
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadProductsXlsx}
                      disabled={busy || byProduct.products.length === 0}
                      title="Excel VENTAS_POR_PRODUCTO: cada producto con el folio de cada venta (para pedir resurtido)"
                    >
                      <FileSpreadsheet />
                      {exportingProducts ? 'Generando...' : 'Excel por producto'}
                    </Button>
                  </div>
                  {loadingByProduct ? (
                    <p className="text-xs text-muted-foreground">Cargando...</p>
                  ) : byProduct.products.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Sin productos vendidos.
                    </p>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <Table className="text-sm">
                        <TableHeader className="bg-muted/60">
                          <TableRow>
                            <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                              Clave
                            </TableHead>
                            <TableHead className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                              Producto
                            </TableHead>
                            <TableHead className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                              Ventas
                            </TableHead>
                            <TableHead className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                              Piezas
                            </TableHead>
                            <TableHead className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                              Importe
                            </TableHead>
                            <TableHead className="px-3 py-1.5" />
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y">
                          {byProduct.products.map((p) => {
                            const open = expandedProducts.has(p.productId);
                            return (
                              <Fragment key={p.productId}>
                                <TableRow
                                  onClick={() => toggleProduct(p.productId)}
                                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                                  title="Ver en qué ventas se vendió"
                                >
                                  <TableCell className="px-3 py-1.5 font-mono text-xs">
                                    {p.productSku}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5">
                                    {p.productName}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                    {p.salesCount}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right font-semibold tabular-nums">
                                    {p.units}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                    {fmt(Number(p.amount))}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right text-xs text-primary">
                                    {open ? 'Ocultar' : 'Ver ventas'}
                                  </TableCell>
                                </TableRow>
                                {open && (
                                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                                    <TableCell colSpan={6} className="px-6 py-2">
                                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                                        {p.lines.map((l, i) => (
                                          <li
                                            key={`${l.saleId}-${i}`}
                                            className="flex flex-wrap gap-x-3"
                                          >
                                            <button
                                              type="button"
                                              className="font-mono text-foreground hover:underline"
                                              onClick={() => onSelectSale?.(l.saleId)}
                                            >
                                              {l.saleNumber}
                                            </button>
                                            {!singleDay && <span>{l.saleDate}</span>}
                                            <span>{l.saleTime}</span>
                                            <span className="truncate max-w-[22rem]">
                                              {l.customerNumber ? `#${l.customerNumber} ` : ''}
                                              {l.customerName}
                                            </span>
                                            <span className="tabular-nums">
                                              {l.quantity} × {fmt(Number(l.unitPrice))} ={' '}
                                              {fmt(Number(l.total))}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <SheetFooter className="mt-0 flex-row items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30">
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// CSV
// ============================================================================

interface CsvInput {
  branchName: string;
  /** Rango (días locales); un solo día = from === to. */
  from: string;
  to: string;
  /** Caja filtrada; undefined = todas las cajas. */
  terminalLabel?: string;
  branchTz?: string;
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

/** Slug para nombres de archivo: minúsculas, sin acentos, guiones. */
function fileSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** corte-{sucursal}-{desde}[-{hasta}][-{caja}].csv (fechas sin guiones). */
export function corteCsvFilename(input: {
  branchName: string;
  from: string;
  to: string;
  terminalLabel?: string;
}): string {
  const parts = ['corte', fileSlug(input.branchName), input.from.replaceAll('-', '')];
  if (input.to !== input.from) parts.push(input.to.replaceAll('-', ''));
  if (input.terminalLabel) parts.push(fileSlug(input.terminalLabel));
  return `${parts.join('-')}.csv`;
}

export function buildCorteCsv(input: CsvInput): string {
  const { summary, paymentRows, sales } = input;
  const singleDay = input.from === input.to;
  const lines: string[] = [];

  lines.push(singleDay ? 'Corte del dia' : 'Corte de ventas');
  lines.push(`Sucursal,${csvCell(input.branchName)}`);
  lines.push(`Desde,${csvCell(input.from)}`);
  lines.push(`Hasta,${csvCell(input.to)}`);
  lines.push(`Caja,${csvCell(input.terminalLabel ?? 'Todas las cajas')}`);
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
  lines.push(singleDay ? 'VENTAS DEL DIA' : 'VENTAS');
  lines.push(
    [
      'Folio',
      ...(singleDay ? [] : ['Fecha']),
      'Hora',
      'Cliente',
      ...(withTerminal ? ['Terminal'] : []),
      'Total',
    ].join(','),
  );
  for (const s of sales) {
    lines.push(
      [
        csvCell(s.saleNumber),
        ...(singleDay ? [] : [csvCell(localDateOf(s.createdAt, input.branchTz))]),
        csvCell(formatTime(s.createdAt, input.branchTz)),
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
