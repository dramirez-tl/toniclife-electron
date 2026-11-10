// quote.ts - COTIZACIÓN del carrito como imagen o PDF (10-nov-2026).
//
// El renderer manda el contenido ya armado (QuotePayload, lib/quote.ts); aquí
// se pinta la hoja (lib/quoteHtml.ts) en una ventana fuera de pantalla:
//   - imagen PNG de la hoja COMPLETA (aunque no quepa en la pantalla) para la
//     vista previa, para copiarla al portapapeles (pegar en el correo) o
//     guardarla;
//   - PDF tamaño carta.
// Los archivos quedan en Documentos\Tonic Life\Cotizaciones. No toca la API ni
// guarda nada del carrito.

import { BrowserWindow, app, clipboard, shell, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  QUOTE_WIDTH_PX,
  buildQuoteHtml,
  quoteFileBase,
  type QuotePayload,
} from '../src/lib/quoteHtml';
import { loadTrimmedLogoDataUrl } from './logo';

/** Tope de alto de la imagen (px): más allá, la hoja sigue en el PDF. */
const MAX_IMAGE_HEIGHT_PX = 12_000;

function quotesDir(): string {
  const dir = path.join(app.getPath('documents'), 'Tonic Life', 'Cotizaciones');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function quoteHtml(payload: QuotePayload): string {
  // Logo de texto oscuro (la hoja es blanca), recortado a lo que se ve: el
  // PNG trae mucho margen transparente y sin recortar salía diminuto.
  return buildQuoteHtml(payload, { logoDataUrl: loadTrimmedLogoDataUrl('logo-text-dark.png') });
}

/** Escribe el HTML en un temporal, lo carga en `win` y devuelve la ruta. */
async function loadHtml(win: BrowserWindow, html: string): Promise<string> {
  const tmpDir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `cotizacion-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');
  await new Promise<void>((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve());
    win.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`No se pudo cargar la cotización: ${code} ${desc}`)),
    );
    win.loadFile(tmpFile).catch(reject);
  });
  return tmpFile;
}

function dispose(win: BrowserWindow, tmpFile: string | null): void {
  try {
    win.destroy();
  } catch {
    // ignore
  }
  if (tmpFile) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

/** La hoja completa como imagen (ventana fuera de pantalla del alto del contenido). */
export async function renderQuoteImage(payload: QuotePayload): Promise<NativeImage> {
  const win = new BrowserWindow({
    show: false,
    width: QUOTE_WIDTH_PX,
    height: 600,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true },
  });
  let tmpFile: string | null = null;
  try {
    tmpFile = await loadHtml(win, quoteHtml(payload));
    const contentHeight = Number(
      await win.webContents.executeJavaScript(
        'Math.ceil(document.documentElement.getBoundingClientRect().height)',
      ),
    );
    const height = Math.min(
      Math.max(Number.isFinite(contentHeight) ? contentHeight : 600, 200),
      MAX_IMAGE_HEIGHT_PX,
    );
    win.setContentSize(QUOTE_WIDTH_PX, height);
    // Deja que el motor repinte con el alto nuevo antes de capturar.
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: QUOTE_WIDTH_PX,
      height,
    });
    if (image.isEmpty()) throw new Error('No se pudo generar la imagen de la cotización.');
    return image;
  } finally {
    dispose(win, tmpFile);
  }
}

/** Vista previa: la imagen como data URL (lo que se ve es lo que se copia). */
export async function previewQuote(
  payload: QuotePayload,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await renderQuoteImage(payload);
  const { width, height } = image.getSize();
  return { dataUrl: image.toDataURL(), width, height };
}

/** Copia la imagen al portapapeles: se pega en el correo con Ctrl+V. */
export async function copyQuoteImage(payload: QuotePayload): Promise<void> {
  clipboard.writeImage(await renderQuoteImage(payload));
}

/** Guarda la imagen PNG y la muestra en su carpeta. Devuelve la ruta. */
export async function saveQuoteImage(payload: QuotePayload): Promise<string> {
  const image = await renderQuoteImage(payload);
  const outFile = path.join(quotesDir(), `${quoteFileBase(payload)}.png`);
  fs.writeFileSync(outFile, image.toPNG());
  shell.showItemInFolder(outFile);
  return outFile;
}

/** Guarda la cotización en PDF (carta) y la abre con el visor del sistema. */
export async function saveQuotePdf(payload: QuotePayload): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    width: QUOTE_WIDTH_PX,
    height: 1000,
    webPreferences: { sandbox: true },
  });
  let tmpFile: string | null = null;
  const outFile = path.join(quotesDir(), `${quoteFileBase(payload)}.pdf`);
  try {
    tmpFile = await loadHtml(win, quoteHtml(payload));
    await new Promise((r) => setTimeout(r, 200));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.3, bottom: 0.3, left: 0.2, right: 0.2 },
    });
    fs.writeFileSync(outFile, pdf);
  } finally {
    dispose(win, tmpFile);
  }
  const openError = await shell.openPath(outFile);
  if (openError) {
    throw new Error(`El PDF se guardó en ${outFile} pero no se pudo abrir: ${openError}`);
  }
  return outFile;
}
