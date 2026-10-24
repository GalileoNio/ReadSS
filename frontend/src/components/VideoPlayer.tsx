import { ExternalLink } from 'lucide-react';
import { openExternal } from '../lib/feedActions';
import { videoEmbed } from '../lib/video';
import { cn } from '../lib/utils';

/**
 * The platform's own web player, embedded in the reader.
 *
 * A video entry's body is only a thumbnail and a description, so the article
 * view is the wrong surface for it: opening the item should play it. The iframe
 * keeps the original player's controls and quality menu, and the footer offers
 * the watch page for the few videos the platform refuses to embed.
 */
export function VideoPlayer({
  url,
  title,
  className,
}: {
  url: string | null | undefined;
  title: string;
  className?: string;
}) {
  const embed = videoEmbed(url);
  if (!embed) return null;

  return (
    <div className={cn('overflow-hidden bg-black', className)}>
      <iframe
        src={embed.src}
        title={title}
        className="aspect-video w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-footnote text-white/60">
        <span className="truncate">{embed.label}</span>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 hover:text-white/90"
          onClick={() => openExternal(embed.watchUrl)}
        >
          在浏览器中打开
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}
