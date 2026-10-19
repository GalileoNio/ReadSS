import { useEffect, useState } from 'react';

/** Extra room the reader needs before a third column fits, in CSS pixels. */
const READER_MIN = 420;
/** Hysteresis band: the decision only flips after crossing by this much. */
const SLACK = 48;

/**
 * Decides whether the comments column can dock beside the reader.
 *
 * The decision is geometric rather than a fixed breakpoint: it needs the list
 * column, a readable reader and the comments column. A hysteresis band keeps a
 * window being resized exactly around the threshold from flapping — without it
 * the third column appears and disappears, which reads as the layout jumping.
 */
export function useCommentsDocking(listWidth: number, commentsWidth: number): boolean {
  const need = listWidth + commentsWidth + READER_MIN;
  const [docked, setDocked] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= need + SLACK,
  );

  useEffect(() => {
    const decide = () => {
      const width = window.innerWidth;
      setDocked((was) => (was ? width >= need - SLACK : width >= need + SLACK));
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, [need]);

  return docked;
}
