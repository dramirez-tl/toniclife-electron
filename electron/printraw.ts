// printraw.ts - Envio de bytes ESC/POS crudos a una impresora de Windows
// usando el Spooler (winspool.drv) via PowerShell + Add-Type C#.
//
// Esto bypasea el driver de paper size / margenes / fuentes. La impresora
// recibe los bytes literales y los interpreta como ESC/POS, igual que como
// si los mandaramos por TCP en modo network. Resuelve el problema de
// "margen blanco enorme arriba" que ocurre cuando el driver Windows tiene
// un paper size > al alto real del ticket.
//
// RENDIMIENTO (fix jul-2026 "tarda en imprimir"): antes CADA ticket
// arrancaba un powershell.exe nuevo y compilaba el C# con Add-Type en cada
// impresion (~2-5 s por ticket). Ahora hay un WORKER PERSISTENTE: un solo
// powershell.exe vivo con el C# ya compilado que recibe trabajos por stdin
// (una linea base64(JSON) por ticket) y responde por stdout — ~50-150 ms
// por ticket. Se precalienta al abrir el POS (warmUpRawPrinter) para que el
// PRIMER ticket tampoco pague la compilacion. Si el worker muere o no
// responde, el envio cae al metodo one-shot original como respaldo.

import { app } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Clase C# compartida por el script one-shot y el worker: P/Invoke a
 * winspool.drv (OpenPrinter, StartDocPrinter datatype="RAW", WritePrinter…).
 */
const RAW_PRINTER_CSHARP = `using System;
using System.Runtime.InteropServices;

public class TonicRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, EntryPoint="OpenPrinterW", ExactSpelling=true, SetLastError=true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", ExactSpelling=true, SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, EntryPoint="StartDocPrinterW", ExactSpelling=true, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOCINFOW di);
    [DllImport("winspool.drv", ExactSpelling=true, SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
`;

/** Cuerpo PowerShell que imprime un archivo (usa la clase ya cargada). */
const RAW_PRINT_ONE_PS = `
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $h = [IntPtr]::Zero

    if (-not [TonicRawPrinter]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "OpenPrinter fallo (codigo $err) para '$PrinterName'"
    }

    try {
        $di = New-Object TonicRawPrinter+DOCINFOW
        $di.pDocName = "Tonic Life POS"
        $di.pDataType = "RAW"

        if (-not [TonicRawPrinter]::StartDocPrinter($h, 1, [ref]$di)) {
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "StartDocPrinter fallo (codigo $err)"
        }
        try {
            if (-not [TonicRawPrinter]::StartPagePrinter($h)) {
                throw "StartPagePrinter fallo"
            }
            try {
                $written = 0
                if (-not [TonicRawPrinter]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) {
                    throw "WritePrinter fallo"
                }
                Write-Output "OK $written bytes enviados"
            } finally {
                [TonicRawPrinter]::EndPagePrinter($h) | Out-Null
            }
        } finally {
            [TonicRawPrinter]::EndDocPrinter($h) | Out-Null
        }
    } finally {
        [TonicRawPrinter]::ClosePrinter($h) | Out-Null
    }
`;

/**
 * Script one-shot (RESPALDO): compila el C# y manda UN archivo. Es el camino
 * original — lento (~2-5 s) porque paga arranque + Add-Type cada vez, pero no
 * depende de estado; se usa solo si el worker persistente no esta disponible.
 */
const RAW_PRINTER_PS1 = `param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
${RAW_PRINTER_CSHARP}
'@ -Language CSharp
${RAW_PRINT_ONE_PS}
`;

/**
 * Script del WORKER persistente: compila el C# UNA vez, avisa READY y luego
 * procesa trabajos por stdin. Protocolo por lineas:
 *   entrada : base64(UTF8(JSON {"printer": "...", "file": "..."}))
 *   salida  : "OK <n> bytes enviados"  |  "ERR <mensaje en una linea>"
 */
const RAW_WORKER_PS1 = `$ErrorActionPreference = 'Stop'
# stdout va por pipe a Node (que decodifica UTF-8); sin esto, PowerShell 5.1
# responde en codepage OEM y los acentos de los mensajes llegan rotos.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
${RAW_PRINTER_CSHARP}
'@ -Language CSharp

[Console]::Out.WriteLine('READY')

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    try {
        $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
        $job = $json | ConvertFrom-Json
        $PrinterName = [string]$job.printer
        $FilePath = [string]$job.file
${RAW_PRINT_ONE_PS}
    } catch {
        $msg = ($_.Exception.Message -replace '[\\r\\n]+', ' ')
        [Console]::Out.WriteLine("ERR $msg")
    }
}
`;

function tmpDirPath(): string {
  const dir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Escribe un script PS1 (si cambio o no existe) y regresa su ruta. */
function ensureScript(filename: string, content: string): string {
  const p = path.join(tmpDirPath(), filename);
  try {
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf-8') === content) return p;
  } catch {
    // reescribir abajo
  }
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

// ============================================================================
// WORKER PERSISTENTE
// ============================================================================

/** Error de transporte del worker (proceso muerto/no responde) — SE puede
 *  reintentar por el camino one-shot. Un "ERR ..." de impresora NO (fallaria
 *  igual y tardaria mas). */
class WorkerTransportError extends Error {}

let worker: ChildProcessWithoutNullStreams | null = null;
let workerReady: Promise<void> | null = null;
let pendingJob: {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
} | null = null;

function killWorker(): void {
  const w = worker;
  worker = null;
  workerReady = null;
  if (pendingJob) {
    pendingJob.reject(new WorkerTransportError('Worker de impresion termino'));
    pendingJob = null;
  }
  if (w) {
    try {
      w.kill();
    } catch {
      // ignore
    }
  }
}

function spawnWorker(): Promise<void> {
  const ps1 = ensureScript('printworker.ps1', RAW_WORKER_PS1);
  const w = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  worker = w;

  let stdoutBuf = '';
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // El primer arranque compila el C# (~1-3 s); margen amplio por antivirus.
  const readyTimer = setTimeout(() => {
    readyReject?.(new WorkerTransportError('Worker de impresion no arranco a tiempo'));
    if (worker === w) killWorker();
  }, 20_000);

  w.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).replace(/\r$/, '').trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      if (line === 'READY') {
        clearTimeout(readyTimer);
        readyResolve?.();
        continue;
      }
      if (pendingJob) {
        const job = pendingJob;
        pendingJob = null;
        job.resolve(line);
      } else {
        console.warn(`[printer] worker (sin trabajo pendiente): ${line}`);
      }
    }
  });
  w.stderr.on('data', (chunk: Buffer) => {
    const txt = chunk.toString('utf-8').trim();
    if (txt) console.warn(`[printer] worker stderr: ${txt}`);
  });
  const onGone = () => {
    clearTimeout(readyTimer);
    readyReject?.(new WorkerTransportError('Worker de impresion termino'));
    if (worker === w) killWorker();
  };
  w.once('exit', onGone);
  w.once('error', onGone);

  // Evitar unhandled rejection si nadie espera el ready todavia.
  ready.catch(() => undefined);
  return ready;
}

function ensureWorker(): Promise<void> {
  if (worker && workerReady) return workerReady;
  workerReady = spawnWorker();
  return workerReady;
}

/**
 * Precalienta el worker (arranque + compilacion del C#) para que el PRIMER
 * ticket del dia ya salga rapido. Llamar al abrir la app si la impresora
 * configurada es de sistema. Inofensivo si se llama de mas.
 */
export function warmUpRawPrinter(): void {
  if (process.platform !== 'win32') return;
  ensureWorker().catch((err) => {
    console.warn(
      `[printer] warm-up del worker fallo (se usara one-shot): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

/** Termina el worker al cerrar la app. */
export function disposeRawPrinterWorker(): void {
  killWorker();
}

function sendViaWorker(printerName: string, binFile: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const w = worker;
    if (!w || !w.stdin.writable) {
      reject(new WorkerTransportError('Worker de impresion no disponible'));
      return;
    }
    // El spooler acepta el RAW casi instantaneo (la impresion fisica es
    // asincrona); 15 s es margen de sobra.
    const timer = setTimeout(() => {
      if (pendingJob) pendingJob = null;
      // Un timeout deja al worker en estado desconocido: reciclarlo.
      killWorker();
      reject(new WorkerTransportError('Worker de impresion no respondio a tiempo'));
    }, 15_000);
    pendingJob = {
      resolve: (line) => {
        clearTimeout(timer);
        resolve(line);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    };
    const payload = Buffer.from(
      JSON.stringify({ printer: printerName, file: binFile }),
      'utf-8',
    ).toString('base64');
    w.stdin.write(payload + '\n', (err) => {
      if (err && pendingJob) {
        const job = pendingJob;
        pendingJob = null;
        clearTimeout(timer);
        job.reject(new WorkerTransportError(`stdin del worker fallo: ${err.message}`));
      }
    });
  });
}

async function sendViaOneShot(printerName: string, binFile: string): Promise<string> {
  const ps1 = ensureScript('printraw.ps1', RAW_PRINTER_PS1);
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-PrinterName',
      printerName,
      '-FilePath',
      binFile,
    ],
    {
      // El primer Add-Type compila el C# (~1-2s). Damos margen.
      timeout: 15_000,
      windowsHide: true,
    },
  );
  const errOut = stderr.trim();
  if (errOut) console.warn(`[printer] raw stderr: ${errOut}`);
  return stdout.trim();
}

// Un trabajo a la vez: el protocolo del worker es una respuesta por linea y
// las termicas de todos modos imprimen en serie.
let jobChain: Promise<unknown> = Promise.resolve();

/**
 * Envia bytes ESC/POS crudos a una impresora Windows via Print Spooler RAW.
 * Requiere que la impresora exista en el SO. NO requiere driver "Generic /
 * Text Only" — el spooler envia los bytes literales aunque el driver sea
 * el de POS-80C u otro.
 */
export function sendRawToWindowsPrinter(
  printerName: string,
  data: Buffer,
): Promise<void> {
  if (process.platform !== 'win32') {
    return Promise.reject(
      new Error(
        'Impresion RAW solo soportada en Windows. En Mac/Linux usar modo network.',
      ),
    );
  }
  const run = jobChain.then(() => doSendRaw(printerName, data));
  jobChain = run.catch(() => undefined);
  return run;
}

async function doSendRaw(printerName: string, data: Buffer): Promise<void> {
  const binFile = path.join(tmpDirPath(), `raw-${Date.now()}-${Math.floor(Math.random() * 1e6)}.bin`);
  fs.writeFileSync(binFile, data);
  const t0 = Date.now();

  try {
    let out: string;
    let via = 'worker';
    try {
      await ensureWorker();
      out = await sendViaWorker(printerName, binFile);
    } catch (err) {
      // Solo caemos al one-shot en fallas de TRANSPORTE del worker; un
      // "ERR ..." de la impresora se procesa abajo (fallaria igual en ambos).
      if (!(err instanceof WorkerTransportError)) throw err;
      console.warn(`[printer] worker no disponible (${err.message}); usando one-shot`);
      via = 'one-shot';
      out = await sendViaOneShot(printerName, binFile);
    }

    console.log(`[printer] raw(${via}, ${Date.now() - t0}ms): ${out || '(sin stdout)'}`);
    if (out.startsWith('ERR')) {
      throw new Error(out.slice(4) || 'La impresora rechazo el trabajo');
    }
    if (!out.startsWith('OK')) {
      throw new Error(`PowerShell no confirmo envio. stdout="${out}"`);
    }
  } finally {
    try {
      fs.unlinkSync(binFile);
    } catch {
      // ignore
    }
  }
}
