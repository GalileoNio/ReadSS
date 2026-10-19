import { create } from 'zustand';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Renders a divider above this item. */
  separatorBefore?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Rect of the card the detail modal grows out of and returns to. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the detail modal comes from: the card itself, the card's picture box
 * (the detail hero is the same picture, scaled up) and enough information to
 * request that picture again for the flight. Articles without a picture use the
 * drawn cover instead, so the same box carries its title and theme colours.
 */
export interface DetailOrigin {
  card: Rect;
  image: Rect | null;
  /** Raw image URL of the card, or '' when the card has no picture. */
  url: string;
  /** Page the picture belongs to, for the proxy's Referer. */
  referer: string;
  /** Drawn-cover content, used when `url` is empty. */
  title: string;
  seed: string;
  color?: string;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  /** Optional inline action, e.g. the undo affordance for mark-all-read. */
  action?: { label: string; onAction: () => void };
  /** Milliseconds before auto-dismiss; 0 keeps the toast until dismissed. */
  duration: number;
}

interface UIState {
  contextMenu: ContextMenuState | null;
  openContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeContextMenu: () => void;


  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  addFeedOpen: boolean;
  setAddFeedOpen: (open: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  /** Whether the comments column on the right is open. */
  commentsVisible: boolean;
  setCommentsVisible: (visible: boolean) => void;
  toggleComments: () => void;

  /** Whether the discover pane replaces the article list. */
  discoverOpen: boolean;
  setDiscoverOpen: (open: boolean) => void;

  /**
   * Rectangle of the card an article was opened from. The detail modal grows
   * out of it and shrinks back into it on close (DESIGN.md §7.11). Null when
   * the article was opened from somewhere without a card (keyboard, palette).
   */
  detailOrigin: DetailOrigin | null;
  setDetailOrigin: (origin: DetailOrigin | null) => void;

  toasts: Toast[];
  pushToast: (
    t: Omit<Toast, 'id' | 'duration' | 'tone'> & { tone?: Toast['tone']; duration?: number },
  ) => number;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUI = create<UIState>((set, get) => ({
  contextMenu: null,
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),


  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  addFeedOpen: false,
  setAddFeedOpen: (open) => set({ addFeedOpen: open }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  commentsVisible: true,
  setCommentsVisible: (visible) => set({ commentsVisible: visible }),
  toggleComments: () => set({ commentsVisible: !get().commentsVisible }),

  discoverOpen: false,
  setDiscoverOpen: (open) => set({ discoverOpen: open }),

  detailOrigin: null,
  setDetailOrigin: (origin) => set({ detailOrigin: origin }),

  toasts: [],

  pushToast(t) {
    const id = ++toastId;
    const toast: Toast = { duration: 4000, ...t, id, tone: t.tone ?? 'info' };
    set({ toasts: [...get().toasts, toast] });
    if (toast.duration > 0) {
      window.setTimeout(() => get().dismissToast(id), toast.duration);
    }
    return id;
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
