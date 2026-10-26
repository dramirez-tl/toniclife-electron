// preload.ts - Puente seguro renderer <-> main.
//
// Por seguridad, el renderer (React) corre con contextIsolation=true y
// nodeIntegration=false. La unica forma de acceder a APIs del SO o a la
// persistencia es a traves de window.toniclife.* expuesto aqui via contextBridge.

import { contextBridge, ipcRenderer } from 'electron';
import type { HardwareFingerprint } from './hardware';
import type { StoredSession } from './storage';
import type { PrinterConfig, OsPrinterInfo } from './printer';
import type {
  CorteReceiptInput,
  SaleReceiptInput,
  TransferReceiptInput,
} from './receipts';

type PrinterOpResult = { ok: true } | { ok: false; error: string };

const api = {
  hardware: {
    get: (): Promise<HardwareFingerprint> => ipcRenderer.invoke('hw:get'),
  },
  session: {
    load: (): Promise<StoredSession | null> => ipcRenderer.invoke('session:load'),
    save: (session: StoredSession): Promise<void> => ipcRenderer.invoke('session:save', session),
    clear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
  },
  // Cola local de ventas guardadas sin conexión (sales-outbox.json, atómico).
  outbox: {
    load: (): Promise<unknown[]> => ipcRenderer.invoke('outbox:load'),
    save: (records: unknown[]): Promise<void> => ipcRenderer.invoke('outbox:save', records),
  },
  window: {
    setTitle: (title: string): Promise<void> => ipcRenderer.invoke('window:setTitle', title),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },
  app: {
    getUserDataPath: (): Promise<string> =>
      ipcRenderer.invoke('app:getUserDataPath'),
  },
  updater: {
    /** Suscribe al aviso "actualización descargada". Devuelve un unsubscribe. */
    onUpdateDownloaded: (
      cb: (info: { version: string }) => void,
    ): (() => void) => {
      const listener = (_evt: unknown, info: { version: string }) => cb(info);
      ipcRenderer.on('updater:downloaded', listener);
      return () => ipcRenderer.removeListener('updater:downloaded', listener);
    },
    /** Reinicia la app e instala la actualización descargada. */
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    /** Verificación manual de actualizaciones (botón ⟳ del header). */
    check: (): Promise<{
      status: 'dev' | 'up-to-date' | 'update-available' | 'error';
      currentVersion: string;
      latestVersion?: string | null;
      message?: string;
    }> => ipcRenderer.invoke('updater:check'),
  },
  printer: {
    list: (): Promise<OsPrinterInfo[]> => ipcRenderer.invoke('printer:list'),
    loadConfig: (): Promise<PrinterConfig | null> =>
      ipcRenderer.invoke('printer:loadConfig'),
    saveConfig: (config: PrinterConfig): Promise<void> =>
      ipcRenderer.invoke('printer:saveConfig', config),
    testPrint: (
      config: PrinterConfig,
      branchName: string,
    ): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('printer:testPrint', config, branchName),
    openCashDrawer: (config: PrinterConfig): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('printer:openCashDrawer', config),
    printCorte: (
      corte: Omit<CorteReceiptInput, 'paperWidth'>,
    ): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('printer:printCorte', corte),
    printSale: (
      sale: Omit<SaleReceiptInput, 'paperWidth'>,
      openDrawer: boolean,
    ): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('printer:printSale', sale, openDrawer),
    /** Ticket digital: el mismo ticket en PDF (Documentos\Tonic Life\Tickets),
     *  sin importar el modo de impresora; se abre con el visor del SO. */
    saveSalePdf: (
      sale: Omit<SaleReceiptInput, 'paperWidth'>,
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('printer:saveSalePdf', sale),
    /** Lista de entrada de un traspaso (casillas para palomear al contar). */
    printTransfer: (
      transfer: Omit<TransferReceiptInput, 'paperWidth'>,
    ): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('printer:printTransfer', transfer),
    /** La misma lista en PDF (histórico), sin importar el modo de impresora. */
    saveTransferPdf: (
      transfer: Omit<TransferReceiptInput, 'paperWidth'>,
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('printer:saveTransferPdf', transfer),
  },
  invoice: {
    /** Guarda el PDF de la factura en la carpeta temporal y lo abre con el
     *  visor del SO (desde ahí el cajero lo imprime o lo guarda). */
    openPdf: (filename: string, bytes: Uint8Array): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('invoice:openPdf', { filename, bytes }),
  },
  shell: {
    /** Abre un enlace en el navegador del SO; el main solo admite WhatsApp y
     *  páginas de toniclife.com (boleto digital de un evento). */
    openExternal: (url: string): Promise<PrinterOpResult> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
};

contextBridge.exposeInMainWorld('toniclife', api);

export type ToniclifeAPI = typeof api;
