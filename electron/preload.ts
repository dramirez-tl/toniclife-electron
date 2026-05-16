// preload.ts - Puente seguro renderer <-> main.
//
// Por seguridad, el renderer (React) corre con contextIsolation=true y
// nodeIntegration=false. La unica forma de acceder a APIs del SO o a la
// persistencia es a traves de window.toniclife.* expuesto aqui via contextBridge.

import { contextBridge, ipcRenderer } from 'electron';
import type { HardwareFingerprint } from './hardware';
import type { StoredSession } from './storage';
import type { PrinterConfig, OsPrinterInfo } from './printer';
import type { CorteReceiptInput } from './receipts';

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
  window: {
    setTitle: (title: string): Promise<void> => ipcRenderer.invoke('window:setTitle', title),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },
  app: {
    getUserDataPath: (): Promise<string> =>
      ipcRenderer.invoke('app:getUserDataPath'),
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
  },
};

contextBridge.exposeInMainWorld('toniclife', api);

export type ToniclifeAPI = typeof api;
