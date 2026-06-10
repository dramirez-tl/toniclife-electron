// PrinterSettingsModal - Configuracion de la impresora termica del terminal.
//
// Soporta dos modos:
//   - Impresora del sistema: la que el SO ya tiene instalada (driver). Para
//     uso casual; el cajon de dinero no se soporta en este modo.
//   - Impresora de red (IP): TCP socket ESC/POS directo. Soporta cajon.
//
// Permite probar la impresion y el cajon antes de guardar.

import { useEffect, useState } from 'react';
import {
  X,
  Printer,
  Wifi,
  Monitor,
  Ban,
  Printer as PrinterIcon,
  Banknote,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import type { PrinterConfig, OsPrinterInfo } from '@/types';

interface PrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchName: string;
}

const DEFAULT_CONFIG: PrinterConfig = {
  connection: 'network',
  host: '',
  port: 9100,
  hasCashDrawer: false,
  paperWidth: 80,
};

export function PrinterSettingsModal({
  isOpen,
  onClose,
  branchName,
}: PrinterSettingsModalProps) {
  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [osPrinters, setOsPrinters] = useState<OsPrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [saving, setSaving] = useState(false);

  // Cargar config + lista de impresoras del SO al abrir.
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const stored = await window.toniclife.printer.loadConfig();
      if (stored) setConfig(stored);
      else setConfig(DEFAULT_CONFIG);

      setLoadingPrinters(true);
      try {
        const list = await window.toniclife.printer.list();
        setOsPrinters(list);
      } catch {
        setOsPrinters([]);
      } finally {
        setLoadingPrinters(false);
      }
    })();
  }, [isOpen]);

  function set<K extends keyof PrinterConfig>(key: K, value: PrinterConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  const networkConfigured =
    !!config.host && !!config.port && config.port > 0 && config.port < 65536;
  const systemConfigured = !!config.deviceName;
  const canTest =
    config.connection === 'network'
      ? networkConfigured
      : config.connection === 'system'
        ? systemConfigured
        : false;
  // "Sin impresora" no requiere configuracion: se puede guardar directo.
  const canSave = config.connection === 'none' || canTest;

  async function handleTestPrint() {
    if (!canTest) {
      toast.error('Completa la configuracion antes de probar.');
      return;
    }
    setTestingPrint(true);
    const r = await window.toniclife.printer.testPrint(config, branchName);
    setTestingPrint(false);
    if (r.ok) {
      toast.success('Pagina de prueba enviada a la impresora.');
    } else {
      toast.error(`Error de impresion: ${r.error}`);
    }
  }

  async function handleTestDrawer() {
    if (!config.hasCashDrawer) return;
    if (config.connection !== 'network') {
      toast.error(
        'El cajon de dinero solo funciona con impresoras de red (ESC/POS directo).',
      );
      return;
    }
    if (!networkConfigured) {
      toast.error('Configura el host y el puerto de la impresora.');
      return;
    }
    setTestingDrawer(true);
    const r = await window.toniclife.printer.openCashDrawer(config);
    setTestingDrawer(false);
    if (r.ok) {
      toast.success('Senal enviada — el cajon deberia abrirse ahora.');
    } else {
      toast.error(`Error abriendo cajon: ${r.error}`);
    }
  }

  async function handleSave() {
    if (!canSave) {
      toast.error('Completa la configuracion antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      await window.toniclife.printer.saveConfig(config);
      toast.success('Configuracion guardada.');
      onClose();
    } catch {
      toast.error('No se pudo guardar la configuracion.');
    } finally {
      setSaving(false);
    }
  }

  const busy = testingPrint || testingDrawer || saving;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
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
            <Printer className="size-5 text-primary" />
            <DialogTitle className="text-lg font-bold text-foreground">
              Impresora termica
            </DialogTitle>
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
          {/* Tipo de conexion */}
          <div>
            <Label className="block mb-2">Tipo de conexion</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => set('connection', 'network')}
                disabled={busy}
                className={cn(
                  'h-auto flex-col items-center gap-1 rounded-lg px-3 py-3 text-sm font-medium',
                  config.connection === 'network' &&
                    'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                <Wifi className="size-4" />
                Impresora de red (IP)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => set('connection', 'system')}
                disabled={busy}
                className={cn(
                  'h-auto flex-col items-center gap-1 rounded-lg px-3 py-3 text-sm font-medium',
                  config.connection === 'system' &&
                    'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                <Monitor className="size-4" />
                Impresora del sistema
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  set('connection', 'none');
                  set('hasCashDrawer', false);
                }}
                disabled={busy}
                className={cn(
                  'h-auto flex-col items-center gap-1 rounded-lg px-3 py-3 text-sm font-medium',
                  config.connection === 'none' &&
                    'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                <Ban className="size-4" />
                Sin impresora
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {config.connection === 'network'
                ? 'ESC/POS directo via TCP. Soporta cajon de dinero.'
                : config.connection === 'system'
                  ? 'Usa el driver instalado en el sistema. No soporta cajon de dinero.'
                  : 'Esta terminal no imprimira tickets ni abrira cajon de dinero.'}
            </p>
          </div>

          {config.connection !== 'none' && (
          <>
          {/* Config segun tipo */}
          {config.connection === 'network' ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="block mb-1">Host / IP</Label>
                <Input
                  value={config.host ?? ''}
                  onChange={(e) => set('host', e.target.value.trim())}
                  placeholder="192.168.1.50"
                  disabled={busy}
                />
              </div>
              <div>
                <Label className="block mb-1">Puerto</Label>
                <Input
                  type="number"
                  value={String(config.port ?? 9100)}
                  onChange={(e) =>
                    set('port', parseInt(e.target.value, 10) || 0)
                  }
                  placeholder="9100"
                  disabled={busy}
                />
              </div>
            </div>
          ) : (
            <div>
              <Label className="block mb-1">
                Impresora del sistema
                {loadingPrinters && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    cargando...
                  </span>
                )}
              </Label>
              {osPrinters.length === 0 && !loadingPrinters ? (
                <p className="text-sm text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
                  No se detectaron impresoras instaladas en el sistema.
                  Instala el driver de tu impresora termica primero.
                </p>
              ) : (
                <Select
                  value={config.deviceName ?? ''}
                  onValueChange={(v) => set('deviceName', v)}
                  disabled={busy || loadingPrinters}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecciona una impresora..." />
                  </SelectTrigger>
                  <SelectContent>
                    {osPrinters.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.displayName}
                        {p.isDefault ? ' (predeterminada)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Ancho de papel */}
          <div>
            <Label className="block mb-2">Ancho del papel</Label>
            <div className="flex gap-2">
              {([58, 80] as const).map((w) => (
                <Button
                  key={w}
                  type="button"
                  variant="outline"
                  onClick={() => set('paperWidth', w)}
                  disabled={busy}
                  className={cn(
                    'flex-1',
                    config.paperWidth === w &&
                      'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
                  )}
                >
                  {w} mm
                </Button>
              ))}
            </div>
          </div>

          {/* Cajon de dinero */}
          <Label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={config.hasCashDrawer}
              onCheckedChange={(c) => set('hasCashDrawer', c === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium text-foreground">
                Esta impresora tiene cajon de dinero conectado
              </div>
              <div className="text-[11px] text-muted-foreground">
                Requiere impresora de red (ESC/POS). Se enviara el pulso al
                cajon al cobrar en efectivo.
              </div>
            </div>
          </Label>

          {/* Acciones de prueba */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Probar
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={handleTestPrint}
                disabled={!canTest || busy}
                size="sm"
              >
                {testingPrint ? (
                  <>Imprimiendo...</>
                ) : (
                  <>
                    <PrinterIcon />
                    Probar impresion
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleTestDrawer}
                disabled={
                  !config.hasCashDrawer ||
                  config.connection !== 'network' ||
                  !networkConfigured ||
                  busy
                }
                size="sm"
              >
                {testingDrawer ? (
                  <>Abriendo...</>
                ) : (
                  <>
                    <Banknote />
                    Probar cajon
                  </>
                )}
              </Button>
            </div>
            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              {canTest ? (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Listo para probar. La pagina de prueba imprime el nombre de
                    la sucursal + fecha.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Completa{' '}
                    {config.connection === 'network'
                      ? 'host y puerto'
                      : 'la impresora del sistema'}{' '}
                    para probar.
                  </span>
                </>
              )}
            </div>
          </div>
          </>
          )}

          {config.connection === 'none' && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground flex items-start gap-2">
              <Ban className="size-4 shrink-0 mt-0.5" />
              <span>
                Esta terminal quedara <strong>sin impresora</strong>: las ventas
                se cobran normal pero no se imprime ticket ni se abre cajon. Lo
                puedes cambiar despues cuando conectes una impresora.
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave || busy}>
            {saving ? 'Guardando...' : 'Guardar configuracion'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
