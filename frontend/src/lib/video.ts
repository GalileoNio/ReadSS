export interface VideoEmbed {
  platform: 'bilibili' | 'youtube';
  /** The platform's own embeddable player. */
  src: string;
  /** The original watch page, used as the fallback. */
  watchUrl: string;
  label: string;
}

/**
 * Recognises a video watch page and returns the platform's embed URL.
 *
 * The player is the platform's own: Bilibili's `player.bilibili.com` iframe is
 * the same one third-party sites use, and YouTube's embed is its standard
 * watch surface. Anything else returns null and keeps the normal article view.
 */
export function videoEmbed(raw: string | null | undefined): VideoEmbed | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
    const match = u.pathname.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
    if (!match) return null;
    const id = match[1];
    const params = new URLSearchParams({
      page: '1',
      high_quality: '1',
      danmaku: '1',
      autoplay: '0',
    });
    if (/^bv/i.test(id)) params.set('bvid', id);
    else params.set('aid', id.slice(2));
    return {
      platform: 'bilibili',
      src: `https://player.bilibili.com/player.html?${params.toString()}`,
      watchUrl: `https://www.bilibili.com/video/${id}`,
      label: '哔哩哔哩播放器',
    };
  }

  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    let id = '';
    if (host === 'youtu.be') {
      id = u.pathname.split('/').filter(Boolean)[0] ?? '';
    } else if (u.searchParams.get('v')) {
      id = u.searchParams.get('v') ?? '';
    } else {
      id = u.pathname.match(/\/(?:embed|shorts|live|v)\/([0-9A-Za-z_-]+)/)?.[1] ?? '';
    }
    if (!/^[0-9A-Za-z_-]{11}$/.test(id)) return null;
    return {
      platform: 'youtube',
      src: `https://www.youtube.com/embed/${id}?rel=0&playsinline=1`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
      label: 'YouTube 播放器',
    };
  }

  return null;
}
