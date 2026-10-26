// printer.ts - Servicio de impresora termica del proceso main.
//
// Soporta dos modos de conexion:
//   1. 'network': impresora con IP (Epson TM-T20, Star TSP100, POS-80C IP, etc.).
//      Hablamos ESC/POS crudo via TCP socket (puerto 9100 estandar).
//      Permite abrir cajon de dinero.
//   2. 'system': impresora instalada en el SO (driver instalado).
//      Imprimimos via Electron webContents.print() — render de HTML <pre>
//      monoespaciado que replica byte-a-byte el layout de ESC/POS.
//      No permite abrir cajon (los drivers no propagan el kick raw).
//
// La configuracion se persiste en userData/printer.json. Los layouts de
// tickets viven en `./receipts.ts`; los comandos ESC/POS de bajo nivel
// en `./escpos.ts`.

import { app, BrowserWindow, shell } from 'electron';
import { Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { Escpos } from './escpos';
import {
  buildTestReceiptBytes,
  buildTestReceiptHtml,
  buildCorteReceiptBytes,
  buildCorteReceiptHtml,
  buildSaleReceiptBytes,
  buildSaleReceiptHtml,
  buildTransferReceiptBytes,
  buildTransferReceiptHtml,
  type CorteReceiptInput,
  type SaleReceiptInput,
  type TransferReceiptInput,
} from './receipts';
import { sendRawToWindowsPrinter } from './printraw';

// ============================================================================
// TYPES + STORAGE
// ============================================================================

export interface PrinterConfig {
  /** 'pdf' = impresora normal / sin térmica: el ticket se genera en PDF y se
   *  abre en el visor del sistema para imprimirlo o guardarlo. */
  connection: 'network' | 'system' | 'pdf' | 'none';
  /** Solo para 'network'. */
  host?: string;
  port?: number;
  /** Solo para 'system' — nombre de la impresora en el SO. */
  deviceName?: string;
  hasCashDrawer: boolean;
  /** Ancho del papel (afecta layout en modo system). */
  paperWidth: 58 | 80;
  /** Impresora de MATRIZ DE PUNTO: no soporta el raster ESC/POS (imprime
   *  basura); los tickets salen solo texto con "TONICLIFE" como logo. */
  dotMatrix?: boolean;
}

export interface OsPrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
}

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'printer.json');
}

export function loadPrinterConfig(): PrinterConfig | null {
  try {
    const p = configFilePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as PrinterConfig;
    if (
      parsed.connection !== 'network' &&
      parsed.connection !== 'system' &&
      parsed.connection !== 'pdf' &&
      parsed.connection !== 'none'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePrinterConfig(config: PrinterConfig): void {
  fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
}

// ============================================================================
// COMANDO INDEPENDIENTE: kick del cajon de dinero (modo network)
// ============================================================================

/** Pulso al cajon (pin 2, 50ms on / 250ms off). */
function buildKickDrawer(): Buffer {
  return new Escpos().init().drawerPulse(0, 50, 250).bytes();
}

// ============================================================================
// NETWORK TRANSPORT (TCP socket)
// ============================================================================

async function sendNetwork(
  host: string,
  port: number,
  data: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(5000);
    socket.once('error', (err) => finish(err));
    socket.once('timeout', () =>
      finish(new Error('Timeout conectando a la impresora')),
    );
    socket.connect(port, host, () => {
      socket.write(data, (err) => {
        if (err) {
          finish(err);
          return;
        }
        // Damos un breve respiro para que la impresora reciba antes de cerrar.
        setTimeout(() => finish(), 250);
      });
    });
  });
}

// ============================================================================
// SYSTEM PRINTER TRANSPORT (Electron webContents.print)
// ============================================================================

// Conversion px -> mm asumiendo 96 DPI (default de Chromium para impresion).
const PX_PER_MM = 96 / 25.4; // ~3.78

/**
 * Imprime HTML en la impresora del SO. Estrategia:
 *   1) Escribimos el HTML a un archivo temp y lo cargamos via file:// — los
 *      data URLs a veces no se imprimen bien en Chromium.
 *   2) Esperamos a `did-finish-load` + 250ms extra para que las fuentes
 *      monospace se asienten antes de medir.
 *   3) Medimos scrollHeight real del DOM para ajustar pageSize.height y
 *      evitar margen vacio enorme arriba/abajo.
 *
 * IMPORTANTE: el driver Windows del POS-80C debe estar configurado con
 * "Document Size" = "Receipt" (continuo) o el ancho exacto del rollo. Si
 * esta en Letter o A4, el SO seguira alimentando papel demas a pesar de
 * nuestro pageSize — eso es config del driver, no del codigo.
 */
async function printSystem(
  deviceName: string,
  html: string,
  paperWidthMm: number,
): Promise<void> {
  // Archivo temp en userData (no en /tmp del sistema; algunas politicas
  // de Windows impiden cargar file:// desde rutas system).
  const tmpDir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `ticket-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');

  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 600,
    webPreferences: {
      // offscreen: true rompe el pipeline de print en Windows — el DOM
      // no pinta hasta que se hace visible. Lo dejamos en off.
      offscreen: false,
      sandbox: false,
    },
  });

  try {
    // Esperar a que el HTML cargue completamente (DOM listo).
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, desc) =>
        reject(new Error(`Carga de ticket fallo: ${code} ${desc}`)),
      );
      win.loadFile(tmpFile).catch(reject);
    });

    // Pintar al menos un frame + dar tiempo a fuentes (monospace de Windows
    // a veces se cae a fallback con delay).
    await new Promise((r) => setTimeout(r, 300));

    // Medir alto y ancho reales del contenido. scrollWidth nos dice si el
    // HTML excede el ancho del papel (las lineas se cortan a la derecha si
    // scrollWidth > pageWidth_px).
    const dim = (await win.webContents.executeJavaScript(`(() => ({
      h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 0),
      w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, 0),
    }))()`)) as { h: number; w: number };
    const heightPx = Number(dim?.h ?? 0);
    const widthPx = Number(dim?.w ?? 0);
    const contentMm = Math.ceil(heightPx / PX_PER_MM);
    const contentWMm = Math.ceil(widthPx / PX_PER_MM);
    // Fallback: si la medicion fallo (0 o muy chica), usamos 120mm que
    // alcanza para el ticket de prueba completo. +6mm de cola para que el
    // cortador no atraviese la ultima linea.
    const pageHeightMm = contentMm > 20 ? contentMm + 6 : 120;

    console.log(
      `[printer] systemPrint: device="${deviceName}" paper=${paperWidthMm}mm ` +
        `scroll=${widthPx}x${heightPx}px content=${contentWMm}x${contentMm}mm ` +
        `pageHeight=${pageHeightMm}mm tmp=${tmpFile}`,
    );
    if (contentWMm > paperWidthMm) {
      console.warn(
        `[printer] WARNING: contenido (${contentWMm}mm) excede ancho de papel ` +
          `(${paperWidthMm}mm). Las lineas se cortaran a la derecha.`,
      );
    }

    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          deviceName,
          // pageSize en MICRONES (Electron exige numeros enteros).
          pageSize: {
            width: Math.round(paperWidthMm * 1000),
            height: Math.round(pageHeightMm * 1000),
          },
          margins: { marginType: 'none' },
          // Color: la mayoria de termicas son monocromas; mandar color
          // a veces hace que el driver imprima en gris muy claro.
          color: false,
          // No imprimir headers/footers del navegador.
          printBackground: true,
        },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'Fallo de impresion'));
        },
      );
    });
  } finally {
    try {
      win.close();
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// MODO PDF (impresora normal / sin termica)
// ============================================================================

/** Carpeta donde quedan los tickets: Documentos\Tonic Life\Tickets. */
function pdfOutputDir(): string {
  const dir = path.join(app.getPath('documents'), 'Tonic Life', 'Tickets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'ticket';
}

/**
 * Renderiza `html` a PDF (hoja carta, el ticket centrado), lo guarda en
 * Documentos\Tonic Life\Tickets\<fileName> y lo abre con el visor del
 * sistema, desde donde la sucursal lo imprime en su impresora normal o lo
 * guarda. Devuelve la ruta del archivo.
 */
async function renderPdf(html: string, fileName: string): Promise<string> {
  const tmpDir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `pdf-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');
  const outFile = path.join(pdfOutputDir(), safeFileName(fileName));

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1000,
    webPreferences: { offscreen: false, sandbox: false },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, desc) =>
        reject(new Error(`Carga de ticket fallo: ${code} ${desc}`)),
      );
      win.loadFile(tmpFile).catch(reject);
    });
    await new Promise((r) => setTimeout(r, 200));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    fs.writeFileSync(outFile, pdf);
  } finally {
    try {
      win.close();
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
  console.log(`[printer] pdf: ${outFile}`);
  const openError = await shell.openPath(outFile);
  if (openError) {
    throw new Error(
      `El PDF se guardo en ${outFile} pero no se pudo abrir: ${openError}`,
    );
  }
  return outFile;
}

// ============================================================================
// PUBLIC API (usado por los handlers IPC en main.ts)
// ============================================================================

/** Imprime la pagina de prueba con la configuracion dada. */
export async function testPrint(
  config: PrinterConfig,
  branchName: string,
): Promise<void> {
  if (config.connection === 'network') {
    if (!config.host || !config.port) {
      throw new Error('Faltan host y puerto de la impresora de red.');
    }
    const label = `${config.host}:${config.port}`;
    const bytes = buildTestReceiptBytes({
      branchName,
      printerLabel: label,
      paperWidth: config.paperWidth,
      textLogo: config.dotMatrix ?? false,
    });
    await sendNetwork(config.host, config.port, bytes);
    return;
  }
  if (config.connection === 'pdf') {
    await renderPdf(
      buildTestReceiptHtml({
        branchName,
        printerLabel: 'PDF (impresora normal)',
        paperWidth: config.paperWidth,
      }),
      'prueba-de-impresion.pdf',
    );
    return;
  }

  // system
  if (!config.deviceName) {
    throw new Error('Selecciona una impresora del sistema.');
  }

  // En Windows preferimos enviar ESC/POS crudo al spooler — bypasea el
  // driver y elimina problemas de paper size / margenes que sufren los
  // drivers POS-80C genericos. Si falla (excepcion de PowerShell, driver
  // incompatible, etc.), cae al render HTML como fallback.
  if (process.platform === 'win32') {
    try {
      const bytes = buildTestReceiptBytes({
        branchName,
        printerLabel: config.deviceName,
        paperWidth: config.paperWidth,
        textLogo: config.dotMatrix ?? false,
      });
      await sendRawToWindowsPrinter(config.deviceName, bytes);
      return;
    } catch (err) {
      console.warn(
        `[printer] envio RAW fallo, intentando HTML fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const html = buildTestReceiptHtml({
    branchName,
    printerLabel: config.deviceName,
    paperWidth: config.paperWidth,
  });
  await printSystem(config.deviceName, html, config.paperWidth);
}

/**
 * Imprime el ticket del corte del dia. Reutiliza la config persistida
 * (loadPrinterConfig). Sin RAW en Windows fallback HTML como en testPrint.
 */
export async function printCorte(
  corte: Omit<CorteReceiptInput, 'paperWidth'>,
): Promise<void> {
  const config = loadPrinterConfig();
  if (!config) {
    throw new Error(
      'No hay impresora configurada. Abre Configuracion de impresora primero.',
    );
  }

  const bytes = buildCorteReceiptBytes({
    ...corte,
    paperWidth: config.paperWidth,
    textLogo: config.dotMatrix ?? false,
  });

  if (config.connection === 'network') {
    if (!config.host || !config.port) {
      throw new Error('Faltan host y puerto de la impresora de red.');
    }
    await sendNetwork(config.host, config.port, bytes);
    return;
  }

  if (config.connection === 'pdf') {
    const html = buildCorteReceiptHtml({
      ...corte,
      paperWidth: config.paperWidth,
    });
    const rango =
      corte.dateTo && corte.dateTo !== corte.date
        ? `${corte.date}_al_${corte.dateTo}`
        : corte.date;
    await renderPdf(html, `corte-${rango}.pdf`);
    return;
  }

  // system
  if (!config.deviceName) {
    throw new Error('Selecciona una impresora del sistema.');
  }
  if (process.platform === 'win32') {
    try {
      await sendRawToWindowsPrinter(config.deviceName, bytes);
      return;
    } catch (err) {
      console.warn(
        `[printer] corte RAW fallo: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
  throw new Error(
    'Impresion sistema solo soportada en Windows. Configura impresora de red.',
  );
}

/**
 * Imprime el ticket de una venta cobrada. Mismo pipeline que printCorte
 * (network ESC/POS; en Windows RAW al spooler). Si `openDrawer` es true y la
 * impresora es de red con cajon configurado, el kick va APPENDED a los bytes
 * del ticket (un solo viaje TCP, el cajon abre junto con la impresion).
 */
export async function printSale(
  sale: Omit<SaleReceiptInput, 'paperWidth'>,
  openDrawer: boolean,
): Promise<void> {
  const config = loadPrinterConfig();
  if (!config) {
    throw new Error(
      'No hay impresora configurada. Abre Configuracion de impresora primero.',
    );
  }

  let bytes = buildSaleReceiptBytes({
    ...sale,
    paperWidth: config.paperWidth,
    textLogo: config.dotMatrix ?? false,
  });

  if (config.connection === 'network') {
    if (!config.host || !config.port) {
      throw new Error('Faltan host y puerto de la impresora de red.');
    }
    if (openDrawer && config.hasCashDrawer) {
      bytes = Buffer.concat([bytes, buildKickDrawer()]);
    }
    await sendNetwork(config.host, config.port, bytes);
    return;
  }

  if (config.connection === 'pdf') {
    const html = buildSaleReceiptHtml({
      ...sale,
      paperWidth: config.paperWidth,
    });
    await renderPdf(html, `ticket-${sale.saleNumber}.pdf`);
    return;
  }

  // system (el cajon no es posible: los drivers no propagan el kick raw)
  if (!config.deviceName) {
    throw new Error('Selecciona una impresora del sistema.');
  }
  if (process.platform === 'win32') {
    await sendRawToWindowsPrinter(config.deviceName, bytes);
    return;
  }
  throw new Error(
    'Impresion sistema solo soportada en Windows. Configura impresora de red.',
  );
}

/**
 * Ticket digital: el mismo ticket de venta en PDF SIN importar el modo de
 * impresora (CEDEAS, 21-oct-2026: mandarlo por WhatsApp o guardarlo para
 * reclamaciones). Queda en Documentos\Tonic Life\Tickets y se abre con el
 * visor del SO. Devuelve la ruta del archivo.
 */
export async function saveSalePdf(
  sale: Omit<SaleReceiptInput, 'paperWidth'>,
): Promise<string> {
  const config = loadPrinterConfig();
  const html = buildSaleReceiptHtml({
    ...sale,
    paperWidth: config?.paperWidth ?? 80,
  });
  return renderPdf(html, `ticket-${sale.saleNumber}.pdf`);
}

/**
 * Imprime la lista de entrada de un traspaso (casillas para palomear al
 * contar; ya recibido, enviado/recibido). Mismo pipeline que printSale, sin
 * cajón.
 */
export async function printTransfer(
  transfer: Omit<TransferReceiptInput, 'paperWidth'>,
): Promise<void> {
  const config = loadPrinterConfig();
  if (!config) {
    throw new Error(
      'No hay impresora configurada. Abre Configuracion de impresora primero.',
    );
  }

  const bytes = buildTransferReceiptBytes({
    ...transfer,
    paperWidth: config.paperWidth,
    textLogo: config.dotMatrix ?? false,
  });

  if (config.connection === 'network') {
    if (!config.host || !config.port) {
      throw new Error('Faltan host y puerto de la impresora de red.');
    }
    await sendNetwork(config.host, config.port, bytes);
    return;
  }

  if (config.connection === 'pdf') {
    const html = buildTransferReceiptHtml({
      ...transfer,
      paperWidth: config.paperWidth,
    });
    await renderPdf(html, `traspaso-${transfer.movementNumber}.pdf`);
    return;
  }

  if (!config.deviceName) {
    throw new Error('Selecciona una impresora del sistema.');
  }
  if (process.platform === 'win32') {
    await sendRawToWindowsPrinter(config.deviceName, bytes);
    return;
  }
  throw new Error(
    'Impresion sistema solo soportada en Windows. Configura impresora de red.',
  );
}

/**
 * La misma lista del traspaso en PDF sin importar el modo de impresora (para
 * el histórico de la sucursal). Queda en Documentos\Tonic Life\Tickets y se
 * abre con el visor del SO. Devuelve la ruta.
 */
export async function saveTransferPdf(
  transfer: Omit<TransferReceiptInput, 'paperWidth'>,
): Promise<string> {
  const config = loadPrinterConfig();
  const html = buildTransferReceiptHtml({
    ...transfer,
    paperWidth: config?.paperWidth ?? 80,
  });
  return renderPdf(html, `traspaso-${transfer.movementNumber}.pdf`);
}

/** Envia el kick del cajon de dinero. Solo soportado en modo network. */
export async function openCashDrawer(config: PrinterConfig): Promise<void> {
  if (!config.hasCashDrawer) {
    throw new Error('Esta impresora no esta configurada con cajon de dinero.');
  }
  if (config.connection !== 'network') {
    throw new Error(
      'El cajon de dinero solo se puede abrir con impresoras de red (ESC/POS directo).',
    );
  }
  if (!config.host || !config.port) {
    throw new Error('Faltan host y puerto de la impresora de red.');
  }
  await sendNetwork(config.host, config.port, buildKickDrawer());
}

/** Lista las impresoras visibles en el SO (via Electron webContents). */
export async function listOsPrinters(
  win: BrowserWindow | null,
): Promise<OsPrinterInfo[]> {
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    description: p.description || '',
    status: p.status,
    isDefault: p.isDefault,
  }));
}
