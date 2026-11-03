// openXlsx.ts - Abre con Excel un .xlsx que arma el API: lo baja (bytes +
// nombre), lo guarda en temporales por IPC (invoice:openPdf sirve para
// cualquier binario) y avisa con un toast. Un solo camino para los tres Excel
// del corte (por producto, formato anterior, tickets por producto).
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/apiError';

export async function openFileFromApi(
  fetchFile: () => Promise<{ bytes: ArrayBuffer; filename: string }>,
  successMessage: string,
  options: { noun?: string; saveTo?: 'downloads' } = {},
): Promise<boolean> {
  const noun = options.noun ?? 'Excel';
  try {
    const { bytes, filename } = await fetchFile();
    const r = await window.toniclife.invoice.openPdf(
      filename,
      new Uint8Array(bytes),
      options.saveTo ? { saveTo: options.saveTo } : undefined,
    );
    if (r.ok) {
      toast.success(successMessage);
      return true;
    }
    toast.error(`No se pudo abrir el ${noun}`, { description: r.error });
    return false;
  } catch (err) {
    toast.error(getApiErrorMessage(err, `No se pudo generar el ${noun}`));
    return false;
  }
}

export function openXlsxFromApi(
  fetchFile: () => Promise<{ bytes: ArrayBuffer; filename: string }>,
  successMessage: string,
): Promise<boolean> {
  return openFileFromApi(fetchFile, successMessage);
}
