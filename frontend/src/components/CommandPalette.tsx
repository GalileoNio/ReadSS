import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CornerDownLeft, Search } from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import * as api from '../lib/api';
import type { Entry } from '../lib/types';
import { cn, relativeTime } from '../lib/utils';
import { FeedIcon, Kbd } from './primitives';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void | Promise<void>;
  icon?: React.ReactNode;
}

/**
 * Ctrl+K palette: searches subscriptions and articles, and exposes the app's
 * common actions, mirroring Folo's command menu.
 */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const setAddFeedOpen = useUI((s) => s.setAddFeedOpen);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const setShortcutsOpen = useUI((s) => s.setShortcutsOpen);
  const { feeds, selectFeed, selectSmart, refresh, openEntry } = useApp();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  /* Debounced article search backed by the Go query engine. */
  useEffect(() => {
    if (!open || query.trim().length < 2 || query.startsWith('>')) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void api
        .listEntries({ scope: 'all', search: query.trim(), limit: 8 })
        .then((page) => setResults(page.entries))
        .catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      {
        id: 'refresh',
        label: '刷新全部订阅源',
        group: '操作',
        hint: 'R',
        run: () => void refresh(),
      },
      {
        id: 'add',
        label: '添加订阅…',
        group: '操作',
        hint: 'Ctrl N',
        run: () => setAddFeedOpen(true),
      },
      {
        id: 'settings',
        label: '打开设置',
        group: '操作',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'shortcuts',
        label: '查看键盘快捷键',
        group: '操作',
        hint: '?',
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'unread',
        label: '切换到未读',
        group: '浏览',
        run: () => void selectSmart('unread'),
      },
      {
        id: 'starred',
        label: '切换到星标',
        group: '浏览',
        run: () => void selectSmart('starred'),
      },
      {
        id: 'readLater',
        label: '切换到稍后读',
        group: '浏览',
        run: () => void selectSmart('readLater'),
      },
      {
        id: 'today',
        label: '切换到今天',
        group: '浏览',
        run: () => void selectSmart('today'),
      },
    ];

    const feedCommands: Command[] = feeds.map((feed) => ({
      id: `feed-${feed.id}`,
      label: feed.title,
      group: '订阅源',
      hint: feed.unread > 0 ? `${feed.unread} 未读` : undefined,
      icon: <FeedIcon title={feed.title} iconUrl={feed.iconUrl} size={16} />,
      run: () => void selectFeed(feed.id),
    }));

    const needle = query.trim().toLowerCase();
    const pool = [...actions, ...feedCommands];
    if (!needle || needle.startsWith('>')) {
      return needle.startsWith('>')
        ? actions.filter((a) => a.label.toLowerCase().includes(needle.slice(1)))
        : pool.slice(0, 12);
    }
    return pool.filter((c) => c.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [feeds, query, refresh, selectFeed, selectSmart, setAddFeedOpen, setSettingsOpen, setShortcutsOpen]);

  const items: Command[] = useMemo(
    () => [
      ...commands,
      ...results.map<Command>((entry) => ({
        id: `entry-${entry.id}`,
        label: entry.title,
        hint: `${entry.feedTitle} · ${relativeTime(entry.publishedAt)}`,
        group: '文章',
        icon: <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={16} />,
        run: () => void openEntry(entry.id),
      })),
    ],
    [commands, results, openEntry],
  );

  /* Keep the highlighted row scrolled into view. */
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runActive = () => {
    const item = items[active];
    if (!item) return;
    setOpen(false);
    void item.run();
  };

  const grouped = items.reduce<Record<string, Command[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:pt-[14vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-black/45 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-[min(560px,94vw)] animate-scale-in overflow-hidden rounded-xl border border-border bg-background shadow-modal">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search size={15} className="shrink-0 text-fg/25" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runActive();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="搜索文章、订阅源或执行命令…"
            className="min-w-0 flex-1 bg-transparent text-title3 text-fg placeholder:text-fg/25 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} className="scrollbar-thin max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-headline text-fg/50">没有匹配的结果</p>
          )}

          {Object.entries(grouped).map(([group, groupItems]) => (
            <div key={group} className="mb-1">
              <p className="px-2.5 py-1 text-footnote font-bold uppercase tracking-wide text-fg/25">
                {group}
              </p>
              {groupItems.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => {
                      setOpen(false);
                      void item.run();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                      index === active ? 'bg-item-active' : 'hover:bg-item-hover',
                    )}
                  >
                    {item.icon ?? <Command size={15} className="shrink-0 text-fg/50" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-headline text-fg/85">{item.label}</span>
                      {item.hint && (
                        <span className="block truncate text-footnote text-fg/50">{item.hint}</span>
                      )}
                    </span>
                    {index === active && (
                      <CornerDownLeft size={13} className="shrink-0 text-fg/25" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-footnote text-fg/50">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> 选择
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> 打开
          </span>
          <span className="flex items-center gap-1">
            <Kbd>&gt;</Kbd> 仅搜索命令
          </span>
        </footer>
      </div>
    </div>
  );
}
