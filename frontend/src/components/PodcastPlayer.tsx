import { AudioLines, Loader2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX, X } from 'lucide-react';
import { PLAYBACK_RATES, usePlayer } from '../store/player';
import { useApp } from '../store/app';
import { useViewport } from '../hooks/useViewport';
import { cn, formatClock } from '../lib/utils';
import type { Entry } from '../lib/types';
import { RemoteImage } from './primitives';
import { PlayerCaption } from './TranscriptPane';

function nextRate(rate: number): number {
  const index = PLAYBACK_RATES.indexOf(rate);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
}

function EpisodeCover({
  entry,
  size = 40,
  imageProxy = '',
  className,
}: {
  entry: Entry;
  size?: number;
  imageProxy?: string;
  className?: string;
}) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-[#A855F7]/35 to-[#0EA5E9]/20',
        className,
      )}
    >
      <span className="absolute inset-0 flex items-center justify-center text-fg/50">
        <AudioLines size={Math.max(14, Math.round(size / 2.4))} />
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
 * Persistent podcast dock. It stays above the feed switcher (and, on phones,
 * above the smart-filter bar), so playback continues while the reader browses
 * or opens show notes (DESIGN.md §7.14).
 */
export function PodcastPlayer() {
  const entry = usePlayer((s) => s.entry);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const muted = usePlayer((s) => s.muted);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const toggle = usePlayer((s) => s.toggle);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const skip = usePlayer((s) => s.skip);
  const seek = usePlayer((s) => s.seek);
  const setRate = usePlayer((s) => s.setRate);
  const stop = usePlayer((s) => s.stop);
  const openEntry = useApp((s) => s.openEntry);
  const imageProxy = useApp((s) => s.imageProxy);
  const { isCompact } = useViewport();

  if (!entry) return null;

  const total = duration > 0 ? duration : entry.audioDuration;
  const max = Math.max(total, 1);
  const percent = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3',
        // Clear the two stacked bars at the bottom of the list column.
        isCompact ? 'bottom-[7.6rem]' : 'bottom-14',
      )}
    >
      <div
        data-player=""
        className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-background/85 shadow-modal backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 px-2.5 pt-2">
          <button
            type="button"
            title="打开节目详情"
            aria-label="打开节目详情"
            onClick={() => void openEntry(entry.id)}
            className="shrink-0 transition-opacity hover:opacity-85"
          >
            <EpisodeCover entry={entry} size={isCompact ? 36 : 40} imageProxy={imageProxy} />
          </button>

          <button
            type="button"
            onClick={() => void openEntry(entry.id)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-headline font-semibold text-fg">{entry.title}</p>
            <p
              className={cn(
                'truncate text-footnote',
                error ? 'text-red-500' : 'text-fg/50',
              )}
            >
              {error ?? entry.feedTitle}
            </p>
          </button>

          <button
            type="button"
            title="后退 15 秒"
            aria-label="后退 15 秒"
            onClick={() => skip(-15)}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg/60 transition-colors hover:bg-item-hover hover:text-fg sm:flex"
          >
            <RotateCcw size={16} />
            <span className="-ml-3 mt-2 text-[8px] font-bold tabular-nums">15</span>
          </button>
          <button
            type="button"
            title={playing ? '暂停' : '播放'}
            aria-label={playing ? '暂停' : '播放'}
            onClick={() => void toggle()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform active:scale-95"
          >
            {buffering && !playing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <button
            type="button"
            title="前进 30 秒"
            aria-label="前进 30 秒"
            onClick={() => skip(30)}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg/60 transition-colors hover:bg-item-hover hover:text-fg sm:flex"
          >
            <RotateCw size={16} />
            <span className="-ml-3 mt-2 text-[8px] font-bold tabular-nums">30</span>
          </button>
          <button
            type="button"
            title={muted ? '取消静音' : '静音'}
            aria-label={muted ? '取消静音' : '静音'}
            onClick={toggleMute}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg/60 transition-colors hover:bg-item-hover hover:text-fg sm:flex"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            type="button"
            title="关闭播放器"
            aria-label="关闭播放器"
            onClick={stop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg/40 transition-colors hover:bg-item-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <PlayerCaption entry={entry} />

        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
          <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-fg/50">
            {formatClock(position)}
          </span>
          <input
            type="range"
            aria-label="播放进度"
            min={0}
            max={max}
            step={0.5}
            value={Math.min(position, max)}
            onChange={(e) => seek(Number(e.target.value))}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-fill"
            style={{
              accentColor: 'hsl(var(--fo-a))',
              background: `linear-gradient(to right, hsl(var(--fo-a)) ${percent}%, hsl(var(--fo-border)) ${percent}%)`,
            }}
          />
          <span className="w-10 shrink-0 text-[10px] tabular-nums text-fg/50">
            {formatClock(total)}
          </span>
          <button
            type="button"
            title={`播放速度 ${rate}×`}
            aria-label={`播放速度 ${rate}×`}
            onClick={() => setRate(nextRate(rate))}
            className="h-6 shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums text-fg/50 transition-colors hover:bg-item-hover hover:text-fg"
          >
            {rate}×
          </button>
        </div>
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
