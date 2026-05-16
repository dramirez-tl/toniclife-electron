// DeactivateConfirmDialog - Confirmacion destructiva para cerrar sesion en
// la terminal. Requiere que el cajero escriba la clave de licencia para
// confirmar, evitando clicks accidentales en operacion de caja.

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DeactivateConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  licenseKey: string;
}

export function DeactivateConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  licenseKey,
}: DeactivateConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset al cerrar / abrir.
  useEffect(() => {
    if (!isOpen) {
      setTyped('');
      setSubmitting(false);
    }
  }, [isOpen]);

  // Cerrar con Esc.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const isMatch = typed.trim().toUpperCase() === licenseKey.toUpperCase();
  const canConfirm = isMatch && !submitting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      // El parent decide si cerrar o no; aqui solo apagamos el spinner local.
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => !submitting && onClose()}
      />
      <div className="relative bg-background border rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-destructive/10 border border-destructive/20 p-2 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                Desactivar terminal
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Esta accion es permanente y libera la licencia.
              </p>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-1 hover:bg-muted rounded-md transition-colors"
            disabled={submitting}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              <div className="font-semibold mb-1">
                Despues de desactivar esta terminal:
              </div>
              <ul className="list-disc pl-4 space-y-1 text-sm">
                <li>
                  Esta terminal <strong>NO podra volver a iniciar sesion</strong>{' '}
                  con la misma licencia.
                </li>
                <li>
                  Para volver a operar el POS en este equipo, debes solicitar
                  una <strong>nueva clave de licencia</strong> al departamento
                  de Sistemas de Tonic Life.
                </li>
                <li>
                  La licencia liberada quedara disponible para activarse en
                  otro equipo.
                </li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label className="text-sm">
              Para confirmar, escribe la clave de licencia exactamente como
              aparece abajo:
            </Label>
            <div className="bg-muted border rounded-md px-3 py-2 font-mono text-sm text-center tracking-wider select-all">
              {licenseKey}
            </div>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm) handleConfirm();
              }}
              placeholder="TONC-XXXX-XXXX-XXXX"
              className="font-mono text-center tracking-wider"
              autoFocus
              spellCheck={false}
            />
            {typed.length > 0 && !isMatch && (
              <p className="text-xs text-destructive">
                La clave no coincide. Verifica que la estas escribiendo
                exactamente igual.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {submitting ? 'Desactivando...' : 'Si, desactivar terminal'}
          </Button>
        </div>
      </div>
    </div>
  );
}
