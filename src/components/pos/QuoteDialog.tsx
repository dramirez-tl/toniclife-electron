// QuoteDialog - COTIZACIÓN del carrito (10-nov-2026, pedido de Call Center).
//
// Las cotizaciones se mandan por correo y antes se recortaba una captura del
// carrito, que corta los nombres y solo muestra lo que cabe. Aquí se ve la
// hoja COMPLETA (todos los productos, promociones, totales y puntos) tal como
// va a salir, y se puede:
//   - Copiar imagen: queda en el portapapeles para pegarla en el correo;
//   - Guardar PDF o Guardar imagen (Documentos\Tonic Life\Cotizaciones).
// La vista previa ES la imagen que pinta el proceso principal
// (electron/quote.ts): lo que se ve es lo que se copia. No guarda la
// cotización ni aparta existencias; el carrito queda como estaba.

import { useEffect, useMemo, useState } from 'react';
import { Copy, FileDown, FileText, ImageDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { buildQuotePayload, type QuoteContext } from '@/lib/quote';
import { usePosCartStore } from '@/stores/pos-cart.store';

interface QuoteDialogProps {
  open: boolean;
  onClose: () => void;
  /** Sucursal, quien atiende y moneda (sin la fecha: se fija al abrir). */
  context: Omit<QuoteContext, 'createdAt'>;
}

type Busy = 'copy' | 'pdf' | 'image' | null;

export function QuoteDialog({ open, onClose, context }: QuoteDialogProps) {
  const cart = usePosCartStore((s) => s.cart);
  // La fecha de la cotización es la del momento en que se abre.
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (open) setCreatedAt(new Date().toISOString());
  }, [open]);

  const { timezone, branchName, attendedBy, currencySymbol, currencyCode } = context;
  const payload = useMemo(
    () =>
      buildQuotePayload(cart, {
        createdAt,
        timezone,
        branchName,
        attendedBy,
        currencySymbol,
        currencyCode,
      }),
    [cart, createdAt, timezone, branchName, attendedBy, currencySymbol, currencyCode],
  );

  const [preview, setPreview] = useState<{ dataUrl: string; width: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  // Vista previa: se vuelve a pintar si el carrito cambia con la ventana abierta.
  useEffect(() => {
    if (!open || payload.items.length === 0) return;
    let alive = true;
    setPreview(null);
    setError(null);
    void window.toniclife.quote.preview(payload).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview({ dataUrl: r.dataUrl, width: r.width });
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [open, payload]);

  async function run(kind: Exclude<Busy, null>) {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'copy') {
        const r = await window.toniclife.quote.copyImage(payload);
        if (r.ok) toast.success('Cotización copiada. Pégala en el correo con Ctrl + V.');
        else toast.error(r.error);
      } else {
        const r =
          kind === 'pdf'
            ? await window.toniclife.quote.savePdf(payload)
            : await window.toniclife.quote.saveImage(payload);
        if (r.ok) toast.success(`Cotización guardada en ${r.path}`);
        else toast.error(r.error);
      }
    } finally {
      setBusy(null);
    }
  }

  const ready = !!preview && !busy;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[94vh] w-[900px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[900px]"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b px-5 py-3 text-left">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">Cotización</DialogTitle>
              <DialogDescription className="text-xs">
                Así se verá. Cópiala como imagen para pegarla en el correo o guárdala en PDF. El
                carrito no cambia.
              </DialogDescription>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
            <X className="size-5" />
          </Button>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-4">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              No se pudo armar la cotización: {error}
            </p>
          ) : preview ? (
            <img
              src={preview.dataUrl}
              alt="Vista previa de la cotización"
              className="mx-auto block max-w-full rounded-md border bg-white shadow-sm"
              style={{ width: preview.width }}
            />
          ) : (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Armando la cotización…
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void run('image')}
            disabled={!ready}
            className="gap-2"
            title="Guarda la imagen PNG en Documentos › Tonic Life › Cotizaciones"
          >
            {busy === 'image' ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
            Guardar imagen
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void run('pdf')}
            disabled={!ready}
            className="gap-2"
            title="Guarda el PDF en Documentos › Tonic Life › Cotizaciones y lo abre"
          >
            {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            Guardar PDF
          </Button>
          <Button
            type="button"
            onClick={() => void run('copy')}
            disabled={!ready}
            className="gap-2"
            title="Copia la imagen: pégala en el correo con Ctrl + V"
          >
            {busy === 'copy' ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
            Copiar imagen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
