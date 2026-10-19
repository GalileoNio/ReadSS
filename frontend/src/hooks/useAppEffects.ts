import { useEffect } from 'react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { getCounts } from '../lib/api';
import { ACCENTS } from '../lib/types';
import { hexToHslTriplet } from '../lib/utils';

/**
 * Applies the theme and accent colour to the document root.
 *
 * Folo stores the theme on `<html data-theme>` and drives the accent through
 * the `--fo-a` variable, so the rest of the stylesheet needs no knowledge of
 * which preset is active.
 */
export function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  const accentColor = useApp((s) => s.settings.accentColor);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (dark: boolean) => {
      root.classList.toggle('dark', dark);
      root.dataset.theme = dark ? 'dark' : 'light';
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }

    apply(theme === 'dark');
    return undefined;
  }, [theme]);

  useEffect(() => {
    const accent = ACCENTS[accentColor] ?? ACCENTS.orange;
    const isDark = document.documentElement.classList.contains('dark');
    // Re-read the theme on each accent change so the pair stays in sync.
    const resolved = theme === 'system' ? isDark : theme === 'dark';
    document.documentElement.style.setProperty(
      '--fo-a',
      hexToHslTriplet(resolved ? accent.dark : accent.light),
    );
  }, [accentColor, theme]);
}

/**
 * Bridges backend events into the store: refresh progress, token-completion
 * notifications, and data invalidations caused by background refreshes.
 */
export function useBackendEvents() {
  useEffect(() => {
    let disposers: (() => void)[] = [];
    let cancelled = false;

    void (async () => {
      try {
        const { Events } = await import('@wailsio/runtime');
        if (cancelled) return;

        disposers = [
          Events.On('reads:refresh:start', () => {
            useApp.setState({ refreshing: true, progress: null });
          }),
          Events.On('reads:refresh:progress', (event: { data: unknown }) => {
            useApp.setState({ progress: event.data as never });
          }),
          Events.On('reads:refresh:done', () => {
            useApp.setState({ refreshing: false, progress: null });
          }),
          Events.On('reads:data:changed', () => {
            void (async () => {
              const { reloadSubscriptions, loadEntries } = useApp.getState();
              await reloadSubscriptions();
              await loadEntries(true);
              useApp.setState({ counts: await getCounts() });
            })();
          }),
          Events.On('reads:feed:error', (event: { data: unknown }) => {
            const data = event.data as { title?: string; error?: string };
            useUI.getState().pushToast({
              message: `订阅源「${data.title ?? ''}」刷新失败：${data.error ?? ''}`,
              tone: 'error',
            });
          }),
        ];
      } catch {
        // No runtime (browser mock): events are simply unavailable.
      }
    })();

    return () => {
      cancelled = true;
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* already gone */
        }
      }
    };
  }, []);
}
