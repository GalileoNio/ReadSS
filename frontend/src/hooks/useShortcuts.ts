import { useEffect } from 'react';
import { useApp } from '../store/app';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { isMod } from '../lib/utils';
import { exportOpml } from '../components/dialogs';
import { openExternal } from '../lib/feedActions';

/** True when focus is inside something the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

/**
 * Global keyboard handling, mirroring Folo's default keymap.
 *
 * Bare-letter shortcuts are suppressed while a text field or any modal is
 * focused, so typing in the search box never triggers an action.
 */
export function useShortcuts() {
  const ui = useUI;
  const app = useApp;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = app.getState();
      const overlays = ui.getState();
      const typing = isTyping(e.target);

      // The palette owns the keyboard while it is open.
      if (overlays.paletteOpen) return;

      const modalOpen =
        overlays.addFeedOpen || overlays.settingsOpen || overlays.shortcutsOpen;
      if (modalOpen) return;

      // ---- modifier combinations -------------------------------------
      if (isMod(e)) {
        switch (e.key.toLowerCase()) {
          case 'k':
            e.preventDefault();
            overlays.setPaletteOpen(true);
            return;
          case 'n':
            e.preventDefault();
            overlays.setAddFeedOpen(true);
            return;
          case 'a':
            if (e.shiftKey) {
              e.preventDefault();
              void state.markAllRead();
            }
            return;
          case 'c':
            if (e.shiftKey && state.entry?.url) {
              e.preventDefault();
              void navigator.clipboard?.writeText(state.entry.url);
              overlays.pushToast({ message: '已复制链接', tone: 'success' });
            }
            return;
          default:
            return;
        }
      }

      // ---- tab switching (1..n) --------------------------------------
      if (!typing && /^[1-5]$/.test(e.key)) {
        // The five content tabs: articles, social, pictures, videos, audio.
        // 首页 is a smart filter now, reached from its capsule.
        const views = ['articles', 'social', 'pictures', 'videos', 'audio'] as const;
        e.preventDefault();
        void state.selectView(views[Number(e.key) - 1]);
        return;
      }

      if (typing) return;

      // ---- podcast playback ------------------------------------------
      // Space toggles the loaded episode, unless a control has focus (there it
      // is the control's own activation key).
      if (e.key === ' ') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, [role="button"], a, input, select, textarea')) return;
        const player = usePlayer.getState();
        if (!player.entry) return;
        e.preventDefault();
        void player.toggle();
        return;
      }

      // ---- bare keys -------------------------------------------------
      switch (e.key) {
        case '?':
          e.preventDefault();
          overlays.setShortcutsOpen(true);
          return;
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault();
          void state.step(1);
          return;
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault();
          void state.step(-1);
          return;
        case 'l':
        case 'L':
        case 'ArrowRight':
          // In the reader these already scroll; only step when in the list.
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            void state.step(1);
          }
          return;
        case 'h':
        case 'H':
        case 'ArrowLeft':
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            void state.step(-1);
          }
          return;
        case 'm':
        case 'M':
          if (state.entry) {
            e.preventDefault();
            void state.markRead([state.entry.id], !state.entry.read);
          }
          return;
        case 's':
        case 'S':
          if (state.entry) {
            e.preventDefault();
            void state.toggleStar(state.entry.id);
          }
          return;
        case 'b':
        case 'B':
          if (state.entry?.url) {
            e.preventDefault();
            openExternal(state.entry.url);
          }
          return;
        case 'o':
        case 'O':
          if (state.entry?.siteUrl) {
            e.preventDefault();
            openExternal(state.entry.siteUrl);
          }
          return;
        case 'r':
        case 'R':
          e.preventDefault();
          void state.refresh();
          return;
        case 'u':
        case 'U':
          e.preventDefault();
          state.setUnreadOnly(!state.unreadOnly);
          return;
        case 'e':
        case 'E':
          if (e.shiftKey) {
            e.preventDefault();
            void exportOpml();
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ui, app]);
}
