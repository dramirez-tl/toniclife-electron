// BranchSearchSelect - Selector de sucursal CON BUSCADOR para el modo staff
// (barra morada y paso de sucursal del login). Con 69 sucursales el <select>
// nativo no alcanza: aquí se teclea clave o nombre (sin acentos) y se filtra
// al instante. Sin dependencias nuevas (el ui-kit del POS no trae
// command/popover): input + panel posicionado, teclado ↑/↓/Enter/Esc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StaffBranch } from '@/stores/staff-session.store';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

interface BranchSearchSelectProps {
  branches: StaffBranch[];
  /** id de la sucursal seleccionada. */
  value: string;
  onSelect: (branch: StaffBranch) => void;
  /** Estilo oscuro (barra morada del modo staff). */
  dark?: boolean;
  className?: string;
}

export function BranchSearchSelect({
  branches,
  value,
  onSelect,
  dark = false,
  className,
}: BranchSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = branches.find((b) => b.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return branches;
    return branches.filter((b) =>
      norm(`${b.code} ${b.name} ${b.legacyKey ?? ''}`).includes(q),
    );
  }, [branches, query]);

  // Cerrar con clic fuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Al abrir: limpiar búsqueda y enfocar el input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  // Mantener visible la opción resaltada al navegar con teclado.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pick = (b: StaffBranch) => {
    setOpen(false);
    if (b.id !== value) onSelect(b);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded border px-2 text-xs',
          dark
            ? 'border-white/30 bg-violet-800 text-white hover:bg-violet-900'
            : 'h-9 border-input bg-background text-sm text-foreground hover:bg-muted/50',
        )}
        title="Buscar y elegir sucursal"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected
            ? `${selected.code} — ${selected.name}${selected.isCedea ? ' · CEDEA' : ''}`
            : 'Elegir sucursal…'}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border shadow-lg',
            'border-border bg-popover text-popover-foreground',
          )}
        >
          <div className="flex items-center gap-1.5 border-b px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Busca por clave o nombre…"
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Sin resultados para “{query}”.
              </li>
            )}
            {filtered.map((b, i) => (
              <li key={b.id} data-index={i}>
                <button
                  type="button"
                  onClick={() => pick(b)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm',
                    i === highlight && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">
                    {b.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.isCedea && (
                    <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700">
                      CEDEA
                    </span>
                  )}
                  {b.currencyCode && b.currencyCode !== 'MXN' && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {b.currencyCode}
                    </span>
                  )}
                  {b.id === value && <Check className="size-3.5 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
