// printraw.ts - Envio de bytes ESC/POS crudos a una impresora de Windows
// usando el Spooler (winspool.drv) via PowerShell + Add-Type C#.
//
// Esto bypasea el driver de paper size / margenes / fuentes. La impresora
// recibe los bytes literales y los interpreta como ESC/POS, igual que como
// si los mandaramos por TCP en modo network. Resuelve el problema de
// "margen blanco enorme arriba" que ocurre cuando el driver Windows tiene
// un paper size > al alto real del ticket.

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Script PowerShell embebido. Define una clase C# que P/Invoca winspool.drv
 * (OpenPrinter, StartDocPrinter con datatype="RAW", WritePrinter, etc.) y
 * envia el contenido binario de un archivo a la cola de impresion como RAW.
 *
 * Argumentos: -PrinterName "<nombre>" -FilePath "<ruta-bin>"
 */
const RAW_PRINTER_PS1 = `param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
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
'@ -Language CSharp

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

let cachedScriptPath: string | null = null;

/** Escribe el script PS1 a userData/print-tmp/ una sola vez y lo reusa. */
function ensureScriptPath(): string {
  if (cachedScriptPath && fs.existsSync(cachedScriptPath)) return cachedScriptPath;
  const dir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'printraw.ps1');
  fs.writeFileSync(p, RAW_PRINTER_PS1, 'utf-8');
  cachedScriptPath = p;
  return p;
}

/**
 * Envia bytes ESC/POS crudos a una impresora Windows via Print Spooler RAW.
 * Requiere que la impresora exista en el SO. NO requiere driver "Generic /
 * Text Only" — el spooler envia los bytes literales aunque el driver sea
 * el de POS-80C u otro.
 */
export async function sendRawToWindowsPrinter(
  printerName: string,
  data: Buffer,
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(
      'Impresion RAW solo soportada en Windows. En Mac/Linux usar modo network.',
    );
  }

  const dir = path.join(app.getPath('userData'), 'print-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const binFile = path.join(dir, `raw-${Date.now()}.bin`);
  fs.writeFileSync(binFile, data);

  const ps1 = ensureScriptPath();

  try {
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

    const out = stdout.trim();
    const errOut = stderr.trim();
    console.log(`[printer] raw: ${out || '(sin stdout)'}`);
    if (errOut) console.warn(`[printer] raw stderr: ${errOut}`);

    if (!out.startsWith('OK')) {
      throw new Error(
        `PowerShell no confirmo envio. stdout="${out}" stderr="${errOut}"`,
      );
    }
  } finally {
    try {
      fs.unlinkSync(binFile);
    } catch {
      // ignore
    }
  }
}
