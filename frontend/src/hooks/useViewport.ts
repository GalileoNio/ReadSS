import { useEffect, useState } from 'react';

/** Subscribes to a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export interface Viewport {
  /** Phone-sized: list and reader one at a time. */
  isMobile: boolean;
  /** Tablet-sized: list and reader side by side, list flexes. */
  isTablet: boolean;
  /** Narrow enough that the list column flexes instead of docking. */
  isCompact: boolean;
  /**
   * Wide enough for three columns (list + reader + comments). Below this the
   * comments column covers the reader as a sheet instead of docking.
   */
  isWide: boolean;
}

/**
 * Layout breakpoints.
 *
 * Three columns need list + reader + comments: with the default 450px list and
 * a 380px comment column the reader needs roughly 400px, so the third column
 * only docks from 1200px up. Below that the comments sheet overlays the reader.
 */
export function useViewport(): Viewport {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const isWide = useMediaQuery('(min-width: 1200px)');
  return { isMobile, isTablet, isCompact: isMobile || isTablet, isWide };
}
