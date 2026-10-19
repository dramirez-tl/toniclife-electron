// StaffAvatar — Foto de quien opera en modo staff (miniatura del expediente de
// RRHH que manda el login) con iniciales de respaldo, y visor en grande (solo
// ver). Si la URL firmada falla se queda con las iniciales.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

interface StaffAvatarProps {
  photoUrl?: string | null;
  name: string;
  /** Lado en px. */
  size?: number;
  onClick?: () => void;
  title?: string;
}

export function StaffAvatar({ photoUrl, name, size = 28, onClick, title }: StaffAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!photoUrl && failedUrl !== photoUrl;
  const style = { width: size, height: size };
  const body = showPhoto ? (
    <img
      src={photoUrl}
      alt={`Foto de ${name}`}
      style={style}
      className="rounded-full object-cover ring-2 ring-white/60"
      onError={() => setFailedUrl(photoUrl)}
      draggable={false}
    />
  ) : (
    <span
      style={style}
      className="flex items-center justify-center rounded-full bg-white/20 text-[11px] font-bold text-white ring-2 ring-white/40"
    >
      {initialsOf(name)}
    </span>
  );
  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="shrink-0 rounded-full transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {body}
    </button>
  );
}

interface StaffPhotoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  subtitle?: string;
  /** Foto original; si no hay, la miniatura. */
  photoUrl?: string | null;
  avatarUrl?: string | null;
}

export function StaffPhotoDialog({
  isOpen,
  onClose,
  name,
  subtitle,
  photoUrl,
  avatarUrl,
}: StaffPhotoDialogProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const candidates = [photoUrl, avatarUrl].filter((u): u is string => !!u);
  const src = candidates.find((u) => u !== failedUrl) ?? null;
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {subtitle ? `${subtitle} · ` : ''}Foto del expediente de RRHH (solo lectura).
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center">
          {src ? (
            <img
              src={src}
              alt={`Foto de ${name}`}
              className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain shadow"
              onError={() => setFailedUrl(src)}
              draggable={false}
            />
          ) : (
            <p className="py-10 text-sm text-muted-foreground">No hay foto en el expediente.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
