// CashMovementModal - Depositos y retiros de la caja registradora.
// Los retiros > $500 quedan en estado "pendiente de aprobacion" (la API lo
// marca automaticamente); el resto se aplica de inmediato.

import { useEffect, useState } from 'react';
import {
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  usePosBalance,
  usePosMovements,
  useCreateMovement,
} from '@/hooks/usePos';
import { posApi } from '@/lib/posApi';
import { formatDateTime } from '@/lib/date';
import { CashMovementType, type CashMovement } from '@/types/pos';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  currencySymbol: string;
}

export function CashMovementModal({
  isOpen,
  onClose,
  sessionId,
  currencySymbol,
}: CashMovementModalProps) {
  const [type, setType] = useState<CashMovementType>(
    CashMovementType.DEPOSIT,
  );
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');

  const { data: balance } = usePosBalance(sessionId ?? undefined, isOpen);
  const { data: movements = [] } = usePosMovements(
    sessionId ?? undefined,
    isOpen,
  );
  const createMovement = useCreateMovement();

  useEffect(() => {
    if (isOpen) {
      setType(CashMovementType.DEPOSIT);
      setAmount('');
      setDescription('');
      setReference('');
    }
  }, [isOpen]);

  const fmt = (n: number) => posApi.formatCurrency(n, currencySymbol);
  const amountNum = parseFloat(amount);
  const canSubmit =
    !!sessionId &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    description.trim().length > 0 &&
    !createMovement.isPending;

  async function handleSubmit() {
    if (!canSubmit || !sessionId) return;
    try {
      const movement = await createMovement.mutateAsync({
        sessionId,
        movementType: type,
        amount: amountNum,
        description: description.trim(),
        reference: reference.trim() || undefined,
      });
      if (movement.requiresApproval) {
        toast.warning(
          'Retiro registrado — requiere aprobacion de un administrador',
        );
      } else {
        toast.success(
          type === CashMovementType.DEPOSIT
            ? 'Deposito registrado'
            : 'Retiro registrado',
        );
      }
      setAmount('');
      setDescription('');
      setReference('');
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(
        e.response?.data?.message || 'Error al registrar el movimiento',
      );
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !createMovement.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (createMovement.isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (createMovement.isPending) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div className="flex items-center gap-2">
            <Wallet className="size-5 text-primary" />
            <DialogTitle className="text-lg font-bold text-foreground">
              Movimientos de caja
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => !createMovement.isPending && onClose()}
            disabled={createMovement.isPending}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        {!sessionId ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No hay una caja abierta. Se abrira automaticamente al cobrar la
            primera venta; despues podras registrar depositos y retiros.
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {/* Balance actual */}
            {balance && (
              <Card className="gap-0 rounded-lg bg-primary/5 py-3 shadow-none">
                <CardContent className="px-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Balance en caja
                    </span>
                    <span className="text-xl font-bold text-primary tabular-nums">
                      {fmt(Number(balance.currentBalance))}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <div>
                      Depositos:{' '}
                      <span className="text-foreground tabular-nums">
                        {fmt(Number(balance.totalDeposits))}
                      </span>
                    </div>
                    <div>
                      Retiros:{' '}
                      <span className="text-foreground tabular-nums">
                        {fmt(Number(balance.totalWithdrawals))}
                      </span>
                    </div>
                    <div>
                      Pendientes:{' '}
                      <span className="text-foreground tabular-nums">
                        {fmt(Number(balance.pendingWithdrawals))}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Formulario */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setType(CashMovementType.DEPOSIT)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium',
                    type === CashMovementType.DEPOSIT &&
                      'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-50',
                  )}
                >
                  <ArrowDownToLine className="size-4" />
                  Deposito
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setType(CashMovementType.WITHDRAWAL)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium',
                    type === CashMovementType.WITHDRAWAL &&
                      'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-50',
                  )}
                >
                  <ArrowUpFromLine className="size-4" />
                  Retiro
                </Button>
              </div>

              <div>
                <Label className="block text-sm font-medium text-foreground mb-1">
                  Monto
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-right tabular-nums"
                />
              </div>

              <div>
                <Label className="block text-sm font-medium text-foreground mb-1">
                  Descripcion
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Retiro para caja chica"
                  maxLength={500}
                />
              </div>

              <div>
                <Label className="block text-sm font-medium text-foreground mb-1">
                  Referencia (opcional)
                </Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ej. REF-001"
                  maxLength={100}
                />
              </div>

              {type === CashMovementType.WITHDRAWAL &&
                Number.isFinite(amountNum) &&
                amountNum > 500 && (
                  <p className="text-xs text-amber-600">
                    Los retiros mayores a {fmt(500)} requieren aprobacion de un
                    administrador antes de aplicarse al balance.
                  </p>
                )}

              <Button
                className="w-full"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {createMovement.isPending
                  ? 'Registrando...'
                  : type === CashMovementType.DEPOSIT
                    ? 'Registrar deposito'
                    : 'Registrar retiro'}
              </Button>
            </div>

            {/* Historial */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Movimientos de esta sesion
              </h3>
              {movements.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Sin movimientos manuales aun.
                </p>
              ) : (
                <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                  {movements.map((m: CashMovement) => (
                    <li
                      key={m.id}
                      className="px-3 py-2 flex items-center justify-between text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {m.description || m.movementType}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                          {formatDateTime(m.createdAt)}
                          {m.requiresApproval && !m.approvedAt && (
                            <span className="flex items-center gap-0.5 text-amber-600">
                              <Clock className="size-3" /> pendiente
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className={[
                          'font-semibold tabular-nums shrink-0',
                          m.direction === 'in'
                            ? 'text-emerald-600'
                            : 'text-amber-600',
                        ].join(' ')}
                      >
                        {m.direction === 'in' ? '+' : '-'}
                        {fmt(Number(m.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30 rounded-b-2xl">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
