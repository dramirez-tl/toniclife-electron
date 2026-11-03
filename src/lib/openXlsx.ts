// openXlsx.ts - Abre con Excel un .xlsx que arma el API: lo baja (bytes +
// nombre), lo guarda en temporales por IPC (invoice:openPdf sirve para
// cualquier binario) y avisa con un toast. Un solo camino para los tres Excel
// del corte (por producto, formato anterior, tickets por producto).
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/apiError';

export async function openXlsxFromApi(
  fetchFile: () => Promise<{ bytes: ArrayBuffer; filename: string }>,
  successMessage: string,
): Promise<boolean> {
  try {
    const { bytes, filename } = await fetchFile();
    const r = await window.toniclife.invoice.openPdf(
      filename,
      new Uint8Array(bytes),
    );
    if (r.ok) {
      toast.success(successMessage);
      return true;
    }
    toast.error('No se pudo abrir el Excel', { description: r.error });
    return false;
  } catch (err) {
    toast.error(getApiErrorMessage(err, 'No se pudo generar el Excel'));
    return false;
  }
}
