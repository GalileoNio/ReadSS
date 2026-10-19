import { openExternal } from './feedActions';

/**
 * Routes remote images in article HTML through the app's loopback proxy.
 *
 * Article and comment images are loaded by the WebView, which cannot send the
 * Referer some CDNs require (img.ithome.com answers 403 for the app's own
 * origin), so they would render broken. Data URIs are left alone.
 */
export function proxyRemoteImages(html: string, proxy: string, referer: string): string {
  if (!proxy || !html) return html;
  const suffix = referer ? `&amp;r=${encodeURIComponent(referer)}` : '';
  return html.replace(
    /(src|poster)="(https?:\/\/[^"]+)"/g,
    (_match, attr: string, url: string) =>
      `${attr}="${proxy}/i?u=${encodeURIComponent(url)}${suffix}"`,
  );
}

/** Link clicks inside feed/comment content are handed to the system browser. */
export function handleContentLinkClick(e: React.MouseEvent): void {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') ?? '';
  e.preventDefault();
  if (href.startsWith('#') || href === '') return;
  openExternal(anchor.href);
}
