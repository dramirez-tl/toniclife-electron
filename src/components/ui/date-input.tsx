// date-input.tsx - <input type="date"> a prueba de tecleo.
//
// Chromium dispara onChange con el año a medias mientras se teclea ("0002",
// "0020", "0202"…) y con "" si falta un segmento. Si eso se aplica al
// instante, la lógica de la pantalla (p. ej. "De no puede ser posterior a
// Hasta") mueve la OTRA fecha con cada tecla y el campo queda atrapado en el
// año 0026 (incidente del 15-oct-2026 en "Ventas recientes").
//
// Este campo muestra lo que se va tecleando (borrador) pero SOLO avisa al
// padre (onCommit) cuando la fecha está completa, existe y su año está en
// [minYear, maxYear]. Al salir del campo, un año de 2 dígitos se completa
// (26 → 2026) y cualquier otra cosa a medias regresa al último valor bueno.

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { isSaneIsoDate, normalizeTwoDigitYear } from '@/lib/date';

interface DateInputProps
  extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
  /** Último valor bueno (YYYY-MM-DD o ''). */
  value: string;
  /** Se llama solo con fechas completas y dentro del rango de años. */
  onCommit: (value: string) => void;
  minYear: number;
  maxYear: number;
  /** Año de 2 dígitos al salir del campo: future = 20xx; past = 19xx si 20xx > maxYear. */
  twoDigitYear?: 'future' | 'past';
}

function DateInput({
  value,
  onCommit,
  minYear,
  maxYear,
  twoDigitYear = 'future',
  onBlur,
  ...props
}: DateInputProps) {
  // null = se muestra `value`; string = borrador que aún no es una fecha buena.
  const [draft, setDraft] = React.useState<string | null>(null);

  return (
    <Input
      {...props}
      type="date"
      value={draft ?? value}
      aria-invalid={draft !== null || undefined}
      onChange={(e) => {
        const next = e.target.value;
        if (isSaneIsoDate(next, minYear, maxYear)) {
          setDraft(null);
          if (next !== value) onCommit(next);
        } else {
          setDraft(next);
        }
      }}
      onBlur={(e) => {
        if (draft !== null) {
          const fixed = normalizeTwoDigitYear(draft, twoDigitYear, maxYear);
          if (fixed && isSaneIsoDate(fixed, minYear, maxYear) && fixed !== value) {
            onCommit(fixed);
          }
          setDraft(null);
        }
        onBlur?.(e);
      }}
    />
  );
}

export { DateInput };
