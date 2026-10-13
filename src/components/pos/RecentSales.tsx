// RecentSales - Barra lateral izquierda del POS.
// Muestra las ventas de un RANGO de días (De / Hasta, máx. 31 días) con filtro
// por terminal ("caja"), resumen por caja, badges de factura (CFDI / Global),
// acción "Facturar" para ventas cobradas sin factura y, cuando el rango es un
// solo día, el estado de la factura global de ese día. Accesos a movimientos
// de caja y corte del día.
// La sesion de caja se abre automaticamente al primer cobro (ver
// ensureSession en PosScreen) — no hay UI manual de apertura.
//
// FEATURE FLAGS: poner en true para reactivar funcionalidad oculta.
const SHOW_CASH_MOVEMENTS = false; // "Movimientos de caja" — ocultado may-2026
                                   // a peticion del usuario; el modal y el
                                   // IPC siguen montados para reactivar.

/** Máximo de días (inclusive) que se listan de una vez. */
export const SALES_RANGE_MAX_DAYS = 31;

import { useMemo, useState } from 'react';
import {
  Receipt,
  ClipboardList,
  RefreshCw,
  Wallet,
  PanelLeftClose,
  Search,
  X,
  FileText,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePosSales } from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import {
  addDaysIso,
  daysBetweenIso,
  formatTime,
  localDateOf,
} from '@/lib/date';
import { canInvoiceSale, isCfdiCountry } from '@/lib/invoiceEligibility';
import {
  aggregateTerminalRows,
  saleTerminalKey,
  SIN_TERMINAL,
  SIN_TERMINAL_KEY,
} from '@/lib/terminalRows';
import { PosSaleStatus, type Sale } from '@/types/pos';
import { GlobalDayCard } from './GlobalDayCard';

export interface SalesRange {
  from: string;
  to: string;
}

interface RecentSalesProps {
  branchId: string;
  branchName: string;
  /** Zona horaria de la sucursal (para mostrar las horas en su hora local). */
  branchTz?: string;
  /** ISO-2 del país de la sucursal (CFDI solo en MX / FN). */
  branchCountryCode?: string;
  currencySymbol: string;
  range: SalesRange;
  onRangeChange: (range: SalesRange) => void;
  onOpenCorte: () => void;
  onOpenMovements: () => void;
  onSelectSale: (saleId: string) => void;
  /** Abre "Facturar" para una venta cobrada sin factura. */
  onInvoiceSale: (saleId: string) => void;
  /** Interruptor "Facturación" de la terminal (heartbeat). */
  invoicingEnabled: boolean;
  /** Si se provee, muestra un botón para plegar el panel. */
  onCollapse?: () => void;
  /** Licencia de ESTA terminal: las ventas cobradas en otra terminal de la
   *  sucursal se marcan con su etiqueta (sucursales con varias cajas). */
  currentLicenseId?: string;
}

const ALL_TERMINALS = '__all__';

function statusBadge(status: PosSaleStatus) {
  switch (status) {
    case PosSaleStatus.COMPLETED:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
          Pagada
        </Badge>
      );
    case PosSaleStatus.PENDING:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
          Pendiente
        </Badge>
      );
    case PosSaleStatus.CANCELLED:
      return (
        <Badge
          variant="destructive"
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
        >
          Cancelada
        </Badge>
      );
    case PosSaleStatus.REFUNDED:
    case PosSaleStatus.PARTIAL_REFUND:
      return (
        <Badge className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
          Reembolso
        </Badge>
      );
    default:
      return null;
  }
}

/**
 * Normaliza un rango: from ≤ to y a lo más SALES_RANGE_MAX_DAYS días. El
 * extremo que NO se movió es el que cede (si cambió "De", se ajusta "Hasta" y
 * viceversa). Devuelve además si hubo que corregir (para avisar).
 */
export function clampSalesRange(
  next: SalesRange,
  changed: 'from' | 'to',
): { range: SalesRange; clamped: boolean } {
  let { from, to } = next;
  let clamped = false;
  if (!from || !to) return { range: next, clamped: false };
  if (daysBetweenIso(from, to) < 0) {
    if (changed === 'from') to = from;
    else from = to;
    clamped = true;
  }
  if (daysBetweenIso(from, to) > SALES_RANGE_MAX_DAYS - 1) {
    if (changed === 'from') to = addDaysIso(from, SALES_RANGE_MAX_DAYS - 1);
    else from = addDaysIso(to, -(SALES_RANGE_MAX_DAYS - 1));
    clamped = true;
  }
  return { range: { from, to }, clamped };
}

export function RecentSales({
  branchId,
  branchName,
  branchTz,
  branchCountryCode,
  currencySymbol,
  range,
  onRangeChange,
  onOpenCorte,
  onOpenMovements,
  onSelectSale,
  onInvoiceSale,
  invoicingEnabled,
  onCollapse,
  currentLicenseId,
}: RecentSalesProps) {
  const {
    data: salesResp,
    isLoading,
    refetch,
    isFetching,
  } = usePosSales(branchId, range.from, range.to);

  const singleDay = range.from === range.to;

  function changeRange(changed: 'from' | 'to', value: string) {
    if (!value) return;
    const { range: fixed, clamped } = clampSalesRange(
      { ...range, [changed]: value },
      changed,
    );
    if (clamped) {
      toast.info(
        `El rango se ajustó: máximo ${SALES_RANGE_MAX_DAYS} días y "De" no puede ser posterior a "Hasta".`,
      );
    }
    onRangeChange(fixed);
  }

  // Filtro por terminal ("caja"): la lista de cajas sale de las ventas
  // cargadas del rango (no hay catálogo de licencias en el POS).
  const [terminal, setTerminal] = useState<string>(ALL_TERMINALS);
  const allSales: Sale[] = salesResp?.data ?? [];
  const terminalRows = useMemo(
    () => aggregateTerminalRows(allSales, 4),
    [allSales],
  );
  const multiTerminal = terminalRows.length >= 2;
  const terminalKeys = new Set(
    terminalRows.map((t) => t.id ?? SIN_TERMINAL_KEY),
  );
  // Si la caja elegida ya no aparece en el rango nuevo, el filtro cae a
  // "todas" (sin dejar la lista vacía por un filtro invisible).
  const effectiveTerminal =
    terminal !== ALL_TERMINALS && !terminalKeys.has(terminal)
      ? ALL_TERMINALS
      : terminal;

  // Buscador local: por nombre de cliente, número de distribuidor o folio.
  // Filtra sobre las ventas ya cargadas (máx. 5000 por rango).
  const [query, setQuery] = useState('');
  const sales: Sale[] = useMemo(() => {
    const byTerminal =
      effectiveTerminal === ALL_TERMINALS
        ? allSales
        : allSales.filter((s) => saleTerminalKey(s) === effectiveTerminal);
    const q = query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!q) return byTerminal;
    return byTerminal.filter((s) => {
      const doc = [s.customerName, s.customerNumber, s.saleNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return doc.includes(q);
    });
  }, [allSales, effectiveTerminal, query]);

  // Filas listas para pintar: elegibilidad de "Facturar" y fecha/hora en el
  // día LOCAL de la sucursal, calculadas una vez por cambio de datos y no en
  // cada render (hasta 5000 filas; cada tecla del buscador re-renderiza).
  // "Hoy" se fija una vez por lote: allSales cambia con cada refetch, así que
  // el cambio de día se recoge con la siguiente carga.
  const today = useMemo(
    () => localDateOf(new Date(), branchTz),
    [branchTz, allSales],
  );
  const rows = useMemo(
    () =>
      sales.map((sale) => ({
        sale,
        invoiceable: canInvoiceSale({
          sale,
          branchCountryCode,
          branchTz,
          invoicingEnabled,
          today,
        }),
        when: singleDay
          ? formatTime(sale.createdAt, branchTz)
          : `${localDateOf(sale.createdAt, branchTz).slice(5)} ${formatTime(sale.createdAt, branchTz)}`,
      })),
    [sales, branchCountryCode, branchTz, invoicingEnabled, today, singleDay],
  );

  // Total del rango (ventas COMPLETADAS de todas las cajas).
  const rangeTotals = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const s of allSales) {
      if (s.status === PosSaleStatus.COMPLETED) {
        count += 1;
        amount += Number(s.total) || 0;
      }
    }
    return { count, amount };
  }, [allSales]);

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const truncated = (salesResp?.total ?? 0) > allSales.length;

  return (
    <div className="flex flex-col h-full bg-card border-r">
      {/* Filtros: rango de fechas, caja y buscador */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Receipt className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Ventas recientes
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
              title="Actualizar"
            >
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
            </Button>
            {onCollapse && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCollapse}
                className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
                title="Plegar panel"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Rango De / Hasta (máx. 31 días) */}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              De
            </span>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => changeRange('from', e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-background text-foreground"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Hasta
            </span>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => changeRange('to', e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-background text-foreground"
            />
          </label>
        </div>

        {/* Filtro por caja: solo tiene sentido con varias terminales */}
        {multiTerminal && (
          <Select value={effectiveTerminal} onValueChange={setTerminal}>
            <SelectTrigger
              size="sm"
              className="w-full text-xs"
              title="Filtrar por caja (terminal que cobró)"
            >
              <Monitor className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder="Todas las cajas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TERMINALS}>Todas las cajas</SelectItem>
              {terminalRows.map((t) => (
                <SelectItem key={t.id ?? SIN_TERMINAL_KEY} value={t.id ?? SIN_TERMINAL_KEY}>
                  {t.id ? t.label : SIN_TERMINAL}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Buscador: cliente, número de distribuidor o folio */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, No. o folio…"
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-background text-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Resumen del rango + por caja */}
      {!isLoading && allSales.length > 0 && (
        <div className="px-4 py-2 border-b bg-muted/30 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {singleDay ? 'Total del día' : 'Total del rango'} ·{' '}
              {rangeTotals.count}{' '}
              {rangeTotals.count === 1 ? 'venta' : 'ventas'}
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {fmt(rangeTotals.amount)}
            </span>
          </div>
          {multiTerminal && (
            <ul className="space-y-0.5">
              {terminalRows.map((t) => (
                <li
                  key={t.id ?? SIN_TERMINAL_KEY}
                  className="flex items-center justify-between gap-2 text-[11px]"
                  title={
                    t.cancelledCount > 0
                      ? `${t.cancelledCount} cancelada${t.cancelledCount === 1 ? '' : 's'}`
                      : undefined
                  }
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    <span
                      className={
                        t.id && currentLicenseId && t.id === currentLicenseId
                          ? 'font-semibold text-foreground'
                          : ''
                      }
                    >
                      {t.label}
                    </span>
                    <span className="ml-1 text-muted-foreground/80">
                      · {t.salesCount}
                      {t.cancelledCount > 0 ? ` (${t.cancelledCount} canc.)` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {fmt(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {truncated && (
            <p className="text-[10px] text-amber-700">
              Mostrando {allSales.length} de {salesResp?.total} ventas: acorta
              el rango para verlas todas.
            </p>
          )}
        </div>
      )}

      {/* Factura global del día (solo con un día seleccionado y en sucursales
          que emiten CFDI: mismo candado que el botón "Facturar") */}
      {singleDay && isCfdiCountry(branchCountryCode) && (
        <div className="px-4 py-2 border-b">
          <GlobalDayCard
            branchId={branchId}
            branchName={branchName}
            day={range.to}
            currencySymbol={currencySymbol}
            invoicingEnabled={invoicingEnabled}
            compact
          />
        </div>
      )}

      {/* Lista de ventas */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Cargando...</div>
        ) : sales.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground italic">
            {query
              ? `Sin ventas que coincidan con “${query}” en estas fechas.`
              : effectiveTerminal !== ALL_TERMINALS
                ? 'Esta caja no tiene ventas en estas fechas.'
                : singleDay
                  ? 'No hay ventas en esta fecha.'
                  : 'No hay ventas en este rango.'}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map(({ sale, invoiceable, when }) => {
              return (
                <li key={sale.id} className="flex items-stretch">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSelectSale(sale.id)}
                    className="block h-auto min-w-0 flex-1 rounded-none px-4 py-2.5 text-left whitespace-normal hover:bg-muted/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs font-mono text-foreground">
                        <span className="truncate">{sale.saleNumber}</span>
                        {/* Capturada con cuenta personal (modo staff / call
                            center), no por la terminal de la sucursal. */}
                        {sale.capturedVia === 'usuario' &&
                          !sale.saleNumber.startsWith('M-') && (
                            <span
                              className="shrink-0 rounded bg-violet-100 px-1 py-px font-sans text-[9px] font-bold text-violet-700"
                              title={`Capturada por ${sale.sellerName} (call center / corporativo)`}
                            >
                              CC
                            </span>
                          )}
                        {/* Cobrada en OTRA terminal de la sucursal: etiqueta de
                            esa caja (sucursales con varias terminales). */}
                        {sale.posLicenseId &&
                          currentLicenseId &&
                          sale.posLicenseId !== currentLicenseId && (
                            <span
                              className="shrink-0 truncate max-w-[7rem] rounded bg-sky-100 px-1 py-px font-sans text-[9px] font-bold text-sky-700"
                              title={`Cobrada en la terminal ${sale.posLicenseLabel ?? sale.posLicenseKey ?? ''}`}
                            >
                              {sale.posLicenseLabel ??
                                `Terminal ${(sale.posLicenseKey ?? '').slice(-4)}`}
                            </span>
                          )}
                        {/* Factura: nominativa (CFDI) o incluida en la global */}
                        {sale.status === PosSaleStatus.COMPLETED &&
                          sale.invoiceUuid && (
                            <span
                              className="shrink-0 rounded bg-emerald-100 px-1 py-px font-sans text-[9px] font-bold text-emerald-700"
                              title={`Factura CFDI ${sale.invoiceUuid}`}
                            >
                              CFDI
                            </span>
                          )}
                        {sale.status === PosSaleStatus.COMPLETED &&
                          sale.globalInvoiceId && (
                            <span
                              className="shrink-0 rounded bg-slate-200 px-1 py-px font-sans text-[9px] font-bold text-slate-700"
                              title="Incluida en la factura global del día"
                            >
                              Global
                            </span>
                          )}
                      </span>
                      {statusBadge(sale.status)}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {when}
                        {sale.customerName ? ` · ${sale.customerName}` : ''}
                        {/* Número de distribuidor SIEMPRE visible: hay homónimos
                            en la red y el número es la única forma de cotejar. */}
                        {sale.customerNumber ? ` #${sale.customerNumber}` : ''}
                      </span>
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {fmt(Number(sale.total))}
                      </span>
                    </div>
                  </Button>
                  {invoiceable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onInvoiceSale(sale.id)}
                      className="h-auto w-9 shrink-0 rounded-none text-primary hover:bg-primary/10 hover:text-primary"
                      title="Facturar esta venta"
                      aria-label={`Facturar la venta ${sale.saleNumber}`}
                    >
                      <FileText className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Acciones de caja */}
      <div className="p-4 border-t space-y-2">
        {SHOW_CASH_MOVEMENTS && (
          <Button
            variant="outline"
            className="w-full"
            onClick={onOpenMovements}
          >
            <Wallet />
            Movimientos de caja
          </Button>
        )}
        <Button
          variant="secondary"
          className="w-full"
          onClick={onOpenCorte}
          data-tour="pos-corte"
          title={`Corte del día ${range.to}`}
        >
          <ClipboardList />
          Corte del dia
        </Button>
      </div>
    </div>
  );
}
