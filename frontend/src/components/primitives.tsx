import { useEffect, useState, type ReactNode } from 'react';
import { Quote, X } from 'lucide-react';
import { avatarGradient, cn, hueOf, initialOf } from '../lib/utils';

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

/**
 * The URL an image should be requested from: through the loopback proxy when
 * one is available, untouched for data URIs and already-proxied sources.
 */
export function proxiedImageURL(src: string, proxy = '', referer?: string): string {
  if (!src) return '';
  if (!proxy || src.startsWith('data:') || src.startsWith(proxy)) return src;
  const suffix = referer ? `&r=${encodeURIComponent(referer)}` : '';
  return `${proxy}/i?u=${encodeURIComponent(src)}${suffix}`;
}

/* -------------------------------------------------------------- CardImage */

export const CARD_IMAGE_RADIUS = 8;

interface CardImageProps {
  /** Absolute image URL, or '' when the entry has no picture. */
  src?: string;
  alt?: string;
  /** Loopback proxy origin, or '' to load directly. */
  proxy?: string;
  /** Page the image belongs to; the proxy sends it upstream as the Referer. */
  referer?: string;
  /**
   * Box ratio, e.g. '4 / 3'. The box is reserved up front, so a card's height
   * never changes while its picture loads — the wall does not reflow.
   */
  ratio?: string;
  /** Seed for the blurred placeholder and for the no-image fallback. */
  seed: string;
  /**
   * The feed icon's dominant colour (#rrggbb). When present it is the feed's
   * theme colour for this box; the hash hue is only the fallback.
   */
  color?: string;
  /** Drawn in the middle when there is no picture at all. */
  fallback?: ReactNode;
  /**
   * Article title. Cards without a picture draw it on the cover itself, over a
   * light tint of the feed's colour plus a quote mark (DESIGN.md §7.7).
   */
  title?: string;
  /**
   * Marks this box as the detail page's hero, so the modal knows where to fly
   * the card image to (`data-hero-image`).
   */
  hero?: boolean;
  /**
   * Show the picture without its blur-to-sharp entrance. The hero uses this: it
   * is revealed by the flying image, and a second fade of its own would make the
   * hand-off flicker.
   */
  instant?: boolean;
  /**
   * Fit the whole picture instead of cropping it to the box. The leftover bands
   * are filled with a blurred, cover-cropped copy of the same picture — the
   * detail hero's material (DESIGN.md §7.10).
   */
  contain?: boolean;
  className?: string;
}

/** A fixed picture box with a pale feed tint while its image loads. */
export function CardImage({
  src,
  alt = '',
  proxy = '',
  referer,
  ratio = '4 / 3',
  seed,
  color,
  fallback,
  title,
  hero = false,
  instant = false,
  contain = false,
  className,
}: CardImageProps) {
  const [loaded, setLoaded] = useState(instant);
  const [failed, setFailed] = useState(false);
  const [pictureShape, setPictureShape] = useState<{ url: string; wide: boolean } | null>(null);

  const url = proxiedImageURL(src || '', proxy, referer);
  const showImage = Boolean(url) && !failed;
  const shaped = pictureShape?.url === url ? pictureShape : null;
  const tint = coverTint(seed, color);

  return (
    <div
      data-card-image={hero ? undefined : ''}
      data-hero-image={hero ? '' : undefined}
      style={{ aspectRatio: ratio, background: tint, borderRadius: CARD_IMAGE_RADIUS }}
      className={cn('relative w-full select-none overflow-hidden bg-cover bg-center', className)}
    >
      {showImage ? (
        <>
          {contain ? (
            <>
              {/* The whole picture is shown (no cropping), so the bands left on
                  either side are filled with the same picture, cover-cropped and
                  blurred — the material the app already uses elsewhere. It is
                  fully opaque and veiled in translucent white, so the bands read
                  as a frosted picture instead of the feed's flat colour. */}
              <img
                src={url}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                draggable={false}
                className={cn(
                  // Scaled well past the box: blur fades the picture's own
                  // edges to transparent, and that fringe must be clipped away
                  // or the tint behind it shows up as a coloured vignette.
                  'absolute inset-0 h-full w-full scale-150 select-none object-cover blur-xl',
                  instant ? '' : 'transition-opacity duration-500',
                  loaded ? 'opacity-100' : 'opacity-0',
                )}
              />
              {/* Same material as the floating capsule bar: the theme surface at
                  70% plus a backdrop blur. It frosts the blurred picture instead
                  of veiling it in plain white. */}
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-background/70 backdrop-blur-xl"
              />
              <img
                src={url}
                alt={alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  const box = img.parentElement!;
                  setPictureShape({
                    url,
                    wide: img.naturalWidth * box.clientHeight >= img.naturalHeight * box.clientWidth,
                  });
                  setLoaded(true);
                }}
                onError={() => setFailed(true)}
                style={{
                  width: shaped && !shaped.wide ? 'auto' : '100%',
                  height: shaped && shaped.wide ? 'auto' : '100%',
                }}
                className={cn(
                  'absolute inset-0 m-auto max-h-full max-w-full select-none rounded-[inherit] object-contain',
                  instant ? '' : 'transition-[opacity,filter,transform] duration-500 ease-out',
                  loaded ? 'scale-100 opacity-100 blur-0' : 'scale-105 opacity-0 blur-lg',
                )}
              />
            </>
          ) : (
            <img
              src={url}
              alt={alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={cn(
                'absolute inset-0 h-full w-full select-none object-cover',
                instant ? '' : 'transition-[opacity,filter,transform] duration-500 ease-out',
                loaded ? 'scale-100 opacity-100 blur-0' : 'scale-105 opacity-0 blur-lg',
              )}
            />
          )}
        </>
      ) : title ? (
        <CoverArt title={title} seed={seed} color={color} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      )}
    </div>
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
/**
 * The drawn cover of an article that has no picture: pale feed tint, a quote
 * mark, the title. It is used by the card, by the detail hero, and by the
 * flying layer during the card → detail transition, so all three look identical
 * at every moment (DESIGN.md §7.7 / §7.11).
 */
export function CoverArt({
  title,
  seed,
  color,
}: {
  title: string;
  seed: string;
  color?: string;
}) {
  const hue = hueOf(seed || '?');
  const markInk = color
    ? `color-mix(in srgb, ${color} 46%, transparent)`
    : `hsl(${hue} 52% 42% / 0.34)`;
  // Typography is relative to the box width (`cqw`), so the same cover reads
  // correctly as a card thumbnail and as the full-bleed hero — and stays
  // consistent while the flying layer grows it (DESIGN.md §7.11). The element
  // carrying `container-type` must not use `cqw` itself, so the padded content
  // sits one level below it.
  return (
    <div className="absolute inset-0 [container-type:inline-size]">
      <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '7cqw' }}>
        <Quote
          className="absolute shrink-0"
          style={{ color: markInk, left: '6cqw', top: '6cqw', width: '11cqw', height: '11cqw' }}
          aria-hidden="true"
        />
        <p
          className="line-clamp-6 break-words text-center font-semibold leading-snug text-fg/90"
          style={{ fontSize: 'clamp(13px, 6.2cqw, 64px)' }}
        >
          {title}
        </p>
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            backgroundColor: markInk,
            right: '6cqw',
            bottom: '6cqw',
            width: '7cqw',
            height: '1.1cqw',
            minHeight: 2,
          }}
        />
      </div>
    </div>
  );
}

/** Background of a drawn cover, shared with its flying layer. */
export function coverTint(seed: string, color?: string): string {
  if (color) return `color-mix(in srgb, ${color} 14%, transparent)`;
  return `hsl(${hueOf(seed || '?')} 58% 50% / 0.14)`;
}