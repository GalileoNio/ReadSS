import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useApp } from './store/app';
import { useUI } from './store/ui';
import { useBackendEvents, useTheme } from './hooks/useAppEffects';
import { useShortcuts } from './hooks/useShortcuts';
import { useViewport } from './hooks/useViewport';
import { ArticleModal } from './components/ArticleModal';
import { DiscoverPane } from './components/DiscoverPane';
import { EntryList } from './components/EntryList';
import { ContextMenu, Toasts } from './components/overlays';
import { AddFeedDialog, SettingsDialog, ShortcutsDialog } from './components/dialogs';
import { CommandPalette } from './components/CommandPalette';
import { Spinner } from './components/primitives';
import { reportViewport } from './lib/api';

export default function App() {
  const ready = useApp((s) => s.ready);
  const error = useApp((s) => s.error);
  const selectedEntryId = useApp((s) => s.selectedEntryId);
  const discoverOpen = useUI((s) => s.discoverOpen);
  const clearError = () => useApp.setState({ error: null });

  const { isMobile } = useViewport();
  useTheme();
  useBackendEvents();
  useShortcuts();

  useEffect(() => {
    void useApp.getState().init();
  }, []);

  /* Report the layout viewport once, so layout issues are diagnosable from
     the log file (a packaged WebView has no accessible console). */
  useEffect(() => {
    void reportViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  }, []);

  return (
    <div className="relative z-0 flex h-screen w-screen overflow-hidden bg-background">
      {/* Skeleton shown until the first Bootstrap call resolves. */}
      {!ready && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <img
              src="/appicon.svg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 select-none"
              draggable={false}
            />
            <Spinner size={16} className="text-fg/25" />
          </div>
        </div>
      )}

      {/* The list/discover page owns the whole window; the article opens as a
          modal, so there is no persistent reader column any more. */}
      {ready && (
        <main className="flex min-w-0 flex-1">
          {discoverOpen ? (
            <DiscoverPane mobileFullWidth={isMobile} />
          ) : (
            <EntryList mobileFullWidth={isMobile} />
          )}
        </main>
      )}

      {ready && selectedEntryId && <ArticleModal />}

      {/* Error banner ------------------------------------------------ */}
      {error && (
        <div className="absolute bottom-4 left-1/2 z-[65] flex max-w-[520px] -translate-x-1/2 items-start gap-2 rounded-lg border border-red-500/30 bg-background/95 px-3 py-2.5 shadow-pop backdrop-blur">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
          <p className="min-w-0 flex-1 text-headline text-fg/85">{error}</p>
          <button
            type="button"
            aria-label="关闭"
            className="shrink-0 rounded p-0.5 text-fg/25 hover:text-fg/85"
            onClick={clearError}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Overlays ---------------------------------------------------- */}
      <ContextMenu />
      <Toasts />
      <CommandPalette />
      <AddFeedDialog />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
