import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Gauge,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { PLAYBACK_RATES, usePlayer } from '../store/player';
import { useApp } from '../store/app';
import { useViewport } from '../hooks/useViewport';
import { cn, formatClock } from '../lib/utils';
import type { Entry } from '../lib/types';
import { RemoteImage } from './primitives';

/** How much room the floating strip takes at the bottom of the window. */
export const PLAYER_DOCK_SPACE = {
  desktop: 'calc(3.5rem + 58px)',
  compact: 'calc(7.6rem + 50px)',
} as const;

function nextRate(rate: number): number {
  const index = PLAYBACK_RATES.indexOf(rate);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
}

function EpisodeCover({
  entry,
  size = 40,
  fill = false,
  imageProxy = '',
  className,
}: {
  entry: Entry;
  size?: number;
  /** Fill a square cell at the parent's height instead of a fixed size. */
  fill?: boolean;
  imageProxy?: string;
  className?: string;
}) {
  return (
    <div
      style={fill ? undefined : { width: size, height: size }}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-[#A855F7]/35 to-[#0EA5E9]/20',
        fill && 'aspect-square h-full',
        className,
      )}
    >
      <span className="absolute inset-0 flex items-center justify-center text-fg/50">
        <AudioLines size={fill ? 16 : Math.max(14, Math.round(size / 2.4))} />
      </span>
      {entry.imageUrl && (
        <RemoteImage
          src={entry.imageUrl}
          proxy={imageProxy}
          referer={entry.url}
          className="relative h-full w-full"
        />
      )}
    </div>
  );
}

/**
 * The player's controls. Every control fills its cell edge to edge with no
 * border, so the strip reads as one segmented bar: cover, play, speed, the
 * remaining-width progress track, close, mute and a skip pair.
 */
export function PlayerStrip() {
  const entry = usePlayer((s) => s.entry);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const muted = usePlayer((s) => s.muted);
  const buffering = usePlayer((s) => s.buffering);
  const toggle = usePlayer((s) => s.toggle);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const seek = usePlayer((s) => s.seek);
  const setRate = usePlayer((s) => s.setRate);
  const stop = usePlayer((s) => s.stop);
  const skip = usePlayer((s) => s.skip);
  const openEntry = useApp((s) => s.openEntry);
  const imageProxy = useApp((s) => s.imageProxy);
  const [flashedRate, setFlashedRate] = useState<number | null>(null);
  const rateTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rateTimer.current) window.clearTimeout(rateTimer.current);
    },
    [],
  );

  if (!entry) return null;

  const total = duration > 0 ? duration : entry.audioDuration;
  const max = Math.max(total, 1);
  const percent = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  const cycleRate = () => {
    const next = nextRate(rate);
    setRate(next);
    setFlashedRate(next);
    if (rateTimer.current) window.clearTimeout(rateTimer.current);
    rateTimer.current = window.setTimeout(() => setFlashedRate(null), 1200);
  };

  return (
    <div
      data-player=""
      className="flex h-full w-full shrink-0 items-stretch overflow-hidden bg-background"
    >
      <button
        type="button"
        title="打开节目详情"
        aria-label="打开节目详情"
        onClick={() => void openEntry(entry.id)}
        className="h-full shrink-0 transition-opacity hover:opacity-90"
      >
        <EpisodeCover
          entry={entry}
          fill
          imageProxy={imageProxy}
          className="!rounded-none"
        />
      </button>

      <button
        type="button"
        title={playing ? '暂停' : '播放'}
        aria-label={playing ? '暂停' : '播放'}
        onClick={() => void toggle()}
        className="flex h-full w-12 shrink-0 items-center justify-center bg-accent text-white transition-colors hover:bg-accent/90 sm:w-14"
      >
        {buffering && !playing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : playing ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <button
        type="button"
        title={`播放速度 ${rate}×，点击切换`}
        aria-label={`播放速度 ${rate}×`}
        onClick={cycleRate}
        className="relative flex h-full w-12 shrink-0 items-center justify-center text-fg/55 transition-colors hover:bg-fill/70 hover:text-fg sm:w-14"
      >
        <Gauge size={17} />
        {flashedRate !== null && (
          <span className="pointer-events-none absolute inset-0 flex animate-fade-in items-center justify-center bg-background text-[11px] font-bold tabular-nums text-accent">
            {flashedRate}×
          </span>
        )}
      </button>

      <div className="relative h-full min-w-0 flex-1 overflow-hidden bg-fill/40">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-accent"
          style={{ width: `${percent}%` }}
        />
        {percent > 0 && percent < 100 && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/75"
            style={{ left: `calc(${percent}% - 1px)` }}
          />
        )}
        <input
          type="range"
          aria-label="播放进度"
          aria-valuetext={`${formatClock(position)} / ${formatClock(total)}`}
          title={`${formatClock(position)} / ${formatClock(total)}`}
          min={0}
          max={max}
          step={0.5}
          value={Math.min(position, max)}
          onChange={(e) => seek(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-0 [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:h-0 [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:appearance-none"
        />
      </div>

      <button
        type="button"
        title="关闭播放器"
        aria-label="关闭播放器"
        onClick={stop}
        className="flex h-full w-11 shrink-0 items-center justify-center text-fg/40 transition-colors hover:bg-fill/70 hover:text-fg sm:w-12"
      >
        <X size={16} />
      </button>

      <button
        type="button"
        title={muted ? '取消静音' : '静音'}
        aria-label={muted ? '取消静音' : '静音'}
        onClick={toggleMute}
        className="flex h-full w-11 shrink-0 items-center justify-center text-fg/55 transition-colors hover:bg-fill/70 hover:text-fg sm:w-12"
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>

      <div className="flex h-full w-24 shrink-0 items-stretch sm:w-28">
        <button
          type="button"
          title="后退 15 秒"
          aria-label="后退 15 秒"
          onClick={() => skip(-15)}
          className="flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-fg/55 transition-colors hover:bg-fill/70 hover:text-fg"
        >
          <RotateCcw size={16} />
          <span className="text-[9px] font-semibold tabular-nums">15</span>
        </button>
        <button
          type="button"
          title="前进 30 秒"
          aria-label="前进 30 秒"
          onClick={() => skip(30)}
          className="flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-fg/55 transition-colors hover:bg-fill/70 hover:text-fg"
        >
          <RotateCw size={16} />
          <span className="text-[9px] font-semibold tabular-nums">30</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Persistent podcast dock. It stays above the feed switcher (and, on phones,
 * above the smart-filter bar), so playback continues while the reader browses
 * or opens show notes (DESIGN.md §7.14). The strip is exactly as wide as the
 * article modal; when the modal opens it ends flush on the dock's top edge, so
 * the two read as one panel.
 */
export function PodcastPlayer() {
  const entry = usePlayer((s) => s.entry);
  const selectedEntryId = useApp((s) => s.selectedEntryId);
  const { isCompact } = useViewport();

  if (!entry) return null;

  // While the detail modal is open, the dock keeps its place and the modal
  // ends exactly on its top edge, so the two read as one split panel.
  const joined = selectedEntryId !== null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] flex justify-center',
        // Clear the two stacked bars at the bottom of the list column.
        isCompact ? 'bottom-[7.6rem]' : 'bottom-14',
      )}
    >
      <div
        className={cn(
          'pointer-events-auto overflow-hidden border border-border',
          joined ? 'bg-background' : 'bg-background/90 shadow-modal backdrop-blur-xl',
          // The width must match the modal's, and only one width utility may
          // be present: Tailwind emits w-full after arbitrary widths, so
          // combining them would silently force the dock to the full viewport.
          isCompact
            ? 'h-[50px] w-full'
            : 'h-[58px] w-[min(1200px,calc(100vw-144px))]',
        )}
        style={{ borderRadius: joined ? '0 0 12px 12px' : 12 }}
      >
        <PlayerStrip />
      </div>
    </div>
  );
}

/**
 * Playback card shown in the article pane for an episode's show notes. It
 * exposes the same state as the dock: listen, pause, seek, speed, and whether
 * the episode was already heard.
 */
export function EpisodePlayBar({ entry }: { entry: Entry }) {
  const current = usePlayer((s) => s.entry?.id === entry.id);
  const playing = usePlayer((s) => s.playing);
  const livePosition = usePlayer((s) => s.position);
  const liveDuration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const buffering = usePlayer((s) => s.buffering);
  const playEntry = usePlayer((s) => s.playEntry);
  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);
  const setRate = usePlayer((s) => s.setRate);
  const imageProxy = useApp((s) => s.imageProxy);

  const position = current ? livePosition : entry.audioPosition / 1000;
  const total = current && liveDuration > 0 ? liveDuration : entry.audioDuration;
  const percent = total > 0 ? Math.min(100, (position / total) * 100) : 0;
  const heard = entry.audioPlayed || (total > 0 && position >= total - 2);

  const label = playing && current ? '暂停' : heard ? '重新收听' : position > 2 ? '继续收听' : '播放这一期';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-fill/30 p-3">
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => (current ? void toggle() : void playEntry(entry))}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-transform active:scale-95"
      >
        {buffering && current && !playing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : playing && current ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-headline font-semibold text-fg">
            {label}
            <span className="ml-2 font-normal text-fg/50">
              {total > 0 ? formatClock(total) : '播客单集'}
            </span>
          </p>
          <button
            type="button"
            title={`播放速度 ${rate}×`}
            aria-label={`播放速度 ${rate}×`}
            onClick={() => setRate(nextRate(rate))}
            className="shrink-0 rounded-full px-1.5 py-0.5 text-footnote font-bold tabular-nums text-fg/50 transition-colors hover:bg-item-hover hover:text-fg"
          >
            {rate}×
          </button>
        </div>

        {current ? (
          <input
            type="range"
            aria-label="播放进度"
            min={0}
            max={Math.max(total, 1)}
            step={0.5}
            value={Math.min(position, Math.max(total, 1))}
            onChange={(e) => seek(Number(e.target.value))}
            className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-fill"
            style={{
              accentColor: 'hsl(var(--fo-a))',
              background: `linear-gradient(to right, hsl(var(--fo-a)) ${percent}%, hsl(var(--fo-border)) ${percent}%)`,
            }}
          />
        ) : (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-fill">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}

        <p className="mt-1 text-footnote text-fg/50">
          {heard
            ? '已听完'
            : position > 2
              ? `已听 ${formatClock(position)}${total > 0 ? ` / ${formatClock(total)}` : ''}`
              : entry.feedTitle}
        </p>
      </div>

      <EpisodeCover entry={entry} size={44} imageProxy={imageProxy} className="hidden sm:block" />
    </div>
  );
}
