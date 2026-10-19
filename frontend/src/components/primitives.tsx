import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { avatarGradient, cn, initialOf } from '../lib/utils';

/* --------------------------------------------------------------- FeedIcon */

/** Avatar radius follows Folo's size ladder. */
function radiusFor(size: number): string {
  if (size <= 24) return 'rounded-sm';
  if (size <= 32) return 'rounded-md';
  if (size <= 48) return 'rounded-lg';
  return 'rounded-xl';
}

interface FeedIconProps {
  title: string;
  iconUrl?: string;
  size?: number;
  className?: string;
}

/**
 * Feed favicon with a deterministic gradient fallback, so an unloadable or
 * missing icon still produces a stable, recognisable avatar.
 */
export function FeedIcon({ title, iconUrl, size = 16, className }: FeedIconProps) {
  const radius = radiusFor(size);
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size / 2)) };

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        draggable={false}
        style={style}
        className={cn('shrink-0 select-none object-cover', radius, className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      style={{ ...style, background: avatarGradient(title || '?') }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-semibold text-white',
        radius,
        className,
      )}
    >
      {initialOf(title)}
    </span>
  );
}

/* ------------------------------------------------------------ RemoteImage */

interface RemoteImageProps {
  /** Absolute image URL, or a data URI (returned untouched). */
  src: string;
  alt?: string;
  className?: string;
  /** Loopback proxy origin, or '' to load directly. */
  proxy?: string;
  /** Page the image belongs to; the proxy sends it upstream as the Referer. */
  referer?: string;
}

/**
 * An <img> for images hosted by someone else.
 *
 * Several CDNs — img.ithome.com is one — answer 403 when the Referer is not the
 * publishing site, and a WebView cannot supply that header for an <img>.
 * Routing the request through the app's loopback proxy fixes those, and a
 * failure hides the image rather than leaving a broken-image glyph.
 */
export function RemoteImage({ src, alt = '', className, proxy, referer }: RemoteImageProps) {
  const [failed, setFailed] = useState(false);

  // Already inlined, or no proxy available: load it as-is.
  const url =
    !proxy || src.startsWith('data:') || src.startsWith(proxy)
      ? src
      : `${proxy}/i?u=${encodeURIComponent(src)}${referer ? `&r=${encodeURIComponent(referer)}` : ''}`;

  if (failed) return null;

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('select-none object-cover', className)}
    />
  );
}

/* ------------------------------------------------------------------- Kbd */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] px-1',
        'bg-fill font-sans text-[10px] font-medium text-fg/50',
      )}
    >
      {children}
    </kbd>
  );
}

/* --------------------------------------------------------------- Spinner */

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 8) }}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent',
        className,
      )}
      role="status"
      aria-label="加载中"
    />
  );
}

/* ------------------------------------------------------------ IconButton */

interface IconButtonProps {
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function IconButton({
  onClick,
  title,
  active,
  disabled,
  className,
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn('icon-btn', active && 'bg-item-active text-fg/85', className)}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Modal */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  children: ReactNode;
}

/** Centred dialog with Esc-to-close and an overlay click target. */
export function Modal({ open, onClose, title, width = 520, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[12vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        // Never wider than the viewport, so dialogs fit on a phone.
        style={{ width: `min(${width}px, 94vw)`, maxHeight: '88vh' }}
        className={cn(
          'relative z-10 flex animate-scale-in flex-col overflow-hidden rounded-xl',
          'border border-border bg-background shadow-modal',
        )}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-title3 font-semibold text-fg">{title}</h2>
            <IconButton title="关闭" onClick={onClose}>
              <X size={15} />
            </IconButton>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

/** Small labelled section used across the dialogs.
 *
 * Deliberately label-only: the app carries no explanatory subtitles under its
 * labels (DESIGN.md §8). */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-headline font-medium text-fg/85">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = cn(
  'w-full rounded-md border border-border bg-fill/40 px-2.5 py-2 text-headline text-fg',
  'placeholder:text-fg/25 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25',
);
