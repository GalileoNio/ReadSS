import { useCallback, useEffect, useRef, useState } from 'react';

/** Distance the content must be pulled before a refresh is triggered. */
const THRESHOLD = 64;
/** Hard cap for the visual pull distance. */
const MAX_PULL = 96;
/** A drag longer than this is treated as a gesture, not a click. */
const CLICK_SLOP = 8;

/**
 * Pull-to-refresh for a scrollable element.
 *
 * Works with touch, pen and mouse: the mouse path exists so the gesture can be
 * tried in the desktop app without a touchscreen. The element must handle the
 * gesture itself because the native scroll container cannot be told to reveal
 * an overscroll area. A drag past `CLICK_SLOP` suppresses the click that would
 * otherwise fire on the row underneath, so pulling never opens an article.
 */
export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  targetRef?: React.RefObject<HTMLDivElement>,
) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = targetRef ?? ownRef;
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef({ startY: 0, active: false, pulled: 0, suppressClick: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reset = () => {
      gesture.current.active = false;
      gesture.current.pulled = 0;
      setPull(0);
    };

    const onDown = (e: PointerEvent) => {
      if (refreshing) return;
      if (e.button !== 0) return;
      if (el.scrollTop > 0) return;
      gesture.current.startY = e.clientY;
      gesture.current.active = true;
      gesture.current.pulled = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (!gesture.current.active) return;
      const dy = e.clientY - gesture.current.startY;
      if (dy <= 0 || el.scrollTop > 0) {
        gesture.current.pulled = 0;
        setPull(0);
        return;
      }
      if (dy > CLICK_SLOP) gesture.current.suppressClick = true;
      // Rubber-band: the first pixels move freely, the rest is damped.
      const eased = Math.min(MAX_PULL, dy * 0.45);
      gesture.current.pulled = eased;
      setPull(eased);
    };

    const finish = () => {
      if (!gesture.current.active) return;
      const pulled = gesture.current.pulled;
      gesture.current.active = false;
      gesture.current.pulled = 0;
      setPull(0);
      if (pulled < THRESHOLD) return;
      setRefreshing(true);
      Promise.resolve()
        .then(onRefresh)
        .catch(() => undefined)
        .finally(() => setRefreshing(false));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reset();
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey);
    };
  }, [onRefresh, refreshing]);

  /** Attach to the scroll container's onClickCapture. */
  const guardClick = useCallback((e: React.MouseEvent) => {
    if (!gesture.current.suppressClick) return;
    gesture.current.suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return { ref, pull, refreshing, threshold: THRESHOLD, guardClick };
}
