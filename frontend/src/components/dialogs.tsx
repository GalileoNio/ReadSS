import { useEffect, useState } from 'react';
import { Download, Link2, Rss, Upload } from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import * as api from '../lib/api';
import { ACCENTS, type DiscoveredFeed, type Settings } from '../lib/types';
import { cn } from '../lib/utils';
import { FeedIcon, Field, Kbd, Modal, Spinner, inputClass } from './primitives';

/* ------------------------------------------------------------ AddFeed */

/** Subscribe to a URL: detect the feed, confirm, then fetch it. */
export function AddFeedDialog() {
  const open = useUI((s) => s.addFeedOpen);
  const setOpen = useUI((s) => s.setAddFeedOpen);
  const pushToast = useUI((s) => s.pushToast);
  const { categories, reloadSubscriptions, selectFeed, refresh } = useApp();

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveredFeed[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [categoryId, setCategoryId] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setUrl('');
      setCandidates(null);
      setChosen(0);
      setError('');
      setBusy(false);
    }
  }, [open]);

  const detect = async () => {
    setBusy(true);
    setError('');
    try {
      const found = await api.discover(url.trim());
      setCandidates(found);
      setChosen(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async () => {
    const target = candidates?.[chosen]?.url ?? url.trim();
    setBusy(true);
    setError('');
    try {
      const feed = await api.addFeedByUrl(target, categoryId, '');
      await reloadSubscriptions();
      setOpen(false);
      pushToast({ message: `已订阅 ${feed.title}`, tone: 'success' });
      await selectFeed(feed.id);
      void refresh([feed.id]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="添加订阅" width={560}>
      <div className="space-y-4 p-4">
        <Field label="网站或订阅源地址">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/25"
              />
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && url.trim() && !busy) void detect();
                }}
                placeholder="https://example.com"
                className={cn(inputClass, 'pl-8')}
              />
            </div>
            <button
              type="button"
              className="btn btn-accent shrink-0"
              disabled={busy || !url.trim()}
              onClick={() => void detect()}
            >
              {busy ? <Spinner size={13} /> : <Rss size={14} />}
              检测
            </button>
          </div>
        </Field>

        <Field label="放入分组">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(Number(e.target.value))}
            className={inputClass}
          >
            <option value={0}>未分组</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        {candidates && candidates.length > 0 && (
          <div>
            <p className="mb-1.5 text-headline font-medium text-fg/85">
              找到 {candidates.length} 个订阅源
            </p>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {candidates.map((c, i) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => setChosen(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                    i === chosen ? 'bg-accent/10 ring-1 ring-accent/40' : 'hover:bg-item-hover',
                  )}
                >
                  <FeedIcon title={c.title} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-headline text-fg/85">{c.title}</span>
                    <span className="block truncate text-footnote text-fg/50">{c.url}</span>
                  </span>
                  <span className="shrink-0 rounded bg-fill px-1.5 py-0.5 text-footnote text-fg/50">
                    {c.type.includes('atom') ? 'Atom' : c.type.includes('json') ? 'JSON' : 'RSS'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-callout text-red-500">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border px-4 py-3">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen(false);
            void importOpml();
          }}
        >
          <Upload size={14} />
          从 OPML 导入
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={busy || (!url.trim() && !candidates)}
            onClick={() => void subscribe()}
          >
            {busy ? '处理中…' : '订阅'}
          </button>
        </div>
      </footer>
    </Modal>
  );
}

/* ------------------------------------------------------------ Settings */

const THEMES: { key: Settings['theme']; label: string }[] = [
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
  { key: 'system', label: '跟随系统' },
];

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const pushToast = useUI((s) => s.pushToast);
  const { settings, updateSettings, reloadSubscriptions, loadEntries, counts } = useApp();
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void api.getAppInfo().then(setInfo).catch(() => setInfo(null));
  }, [open]);

  const toggle = (key: keyof Settings) => (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(settings[key])}
      onClick={() => void updateSettings({ [key]: !settings[key] } as Partial<Settings>)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        settings[key] ? 'bg-accent' : 'bg-fill',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          settings[key] ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );

  // Label, an optional live value, and the control. No explanatory sentences:
  // the app has no subtitles under its labels (DESIGN.md §8).
  const row = (label: string, value: string | null, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-headline font-medium text-fg/85">{label}</p>
        {value && <p className="text-callout tabular-nums text-fg/50">{value}</p>}
      </div>
      {control}
    </div>
  );

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="设置" width={620}>
      <div className="scrollbar-thin max-h-[65vh] overflow-y-auto px-4 py-2">
        {/* Appearance */}
        <h3 className="mt-2 text-callout font-bold uppercase tracking-wide text-fg/25">外观</h3>

        {row(
          '主题',
          null,
          <div className="flex shrink-0 gap-1 rounded-md bg-fill p-0.5">
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => void updateSettings({ theme: t.key })}
                className={cn(
                  'rounded px-2.5 py-1 text-callout font-medium transition-colors',
                  settings.theme === t.key
                    ? 'bg-background text-fg shadow-sm'
                    : 'text-fg/50 hover:text-fg/85',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>,
        )}

        {row(
          '强调色',
          null,
          <div className="flex shrink-0 gap-1.5">
            {Object.entries(ACCENTS).map(([key, accent]) => (
              <button
                key={key}
                type="button"
                title={accent.label}
                aria-label={accent.label}
                onClick={() => void updateSettings({ accentColor: key })}
                style={{ background: accent.dark }}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform hover:scale-110',
                  settings.accentColor === key && 'ring-2 ring-fg/50 ring-offset-2 ring-offset-background',
                )}
              />
            ))}
          </div>,
        )}

        {row(
          '正文字号',
          `${settings.contentFontSize}px`,
          <input
            type="range"
            min={14}
            max={22}
            step={1}
            value={settings.contentFontSize}
            onChange={(e) => void updateSettings({ contentFontSize: Number(e.target.value) })}
            className="w-40 shrink-0 accent-accent"
          />,
        )}

        {/* Reading */}
        <h3 className="mt-5 text-callout font-bold uppercase tracking-wide text-fg/25">阅读</h3>
        {row('打开即标记已读', null, toggle('markReadOnScroll'))}
        {row('淡化已读文章', null, toggle('dimRead'))}
        {row('按日期分组', null, toggle('groupByDate'))}
        {row('显示未读数量', null, toggle('sidebarShowUnreadCount'))}

        {/* Refresh */}
        <h3 className="mt-5 text-callout font-bold uppercase tracking-wide text-fg/25">
          自动刷新
        </h3>
        {row('启用后台刷新', null, toggle('autoRefresh'))}
        {row(
          '刷新间隔',
          `每 ${settings.refreshIntervalMinutes} 分钟`,
          <input
            type="range"
            min={5}
            max={180}
            step={5}
            value={settings.refreshIntervalMinutes}
            onChange={(e) =>
              void updateSettings({ refreshIntervalMinutes: Number(e.target.value) })
            }
            className="w-40 shrink-0 accent-accent"
          />,
        )}

        {/* Data */}
        <h3 className="mt-5 text-callout font-bold uppercase tracking-wide text-fg/25">
          订阅数据
        </h3>
        <div className="flex flex-wrap gap-2 py-2.5">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void importOpml()}
          >
            <Upload size={14} />
            导入 OPML
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void exportOpml()}
          >
            <Download size={14} />
            导出 OPML
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                await reloadSubscriptions();
                await loadEntries(true);
                setBusy(false);
                pushToast({ message: '已重新载入订阅数据', tone: 'success' });
              })();
            }}
          >
            重新载入
          </button>
        </div>

        <div className="mt-2 rounded-md border border-border bg-fill/30 p-3 text-callout text-fg/50">
          <p>
            共 <strong className="text-fg/85">{counts.all}</strong> 篇文章，
            <strong className="text-fg/85">{counts.unread}</strong> 篇未读
          </p>
          {info && (
            <>
              <p className="mt-1">版本 {info.version}</p>
              <p className="mt-1 break-all">数据目录：{info.dataDir}</p>
            </>
          )}
        </div>
      </div>

      <footer className="flex justify-end border-t border-border px-4 py-3">
        <button type="button" className="btn btn-accent" onClick={() => setOpen(false)}>
          完成
        </button>
      </footer>
    </Modal>
  );
}

/* ----------------------------------------------------------- Shortcuts */

const SHORTCUT_GROUPS: { title: string; items: [string, string[]][] }[] = [
  {
    title: '导航',
    items: [
      ['下一篇 / 向下', ['J', '↓']],
      ['上一篇 / 向上', ['K', '↑']],
      ['进入阅读区', ['L', '→']],
      ['返回列表', ['H', '←']],
      ['切换视图标签', ['1', '2', '3', '4', '5']],
    ],
  },
  {
    title: '文章操作',
    items: [
      ['标记已读 / 未读', ['M']],
      ['加星标', ['S']],
      ['在浏览器中打开', ['B']],
      ['复制链接', ['Shift', 'Ctrl', 'C']],
      ['全部标记为已读', ['Shift', 'Ctrl', 'A']],
    ],
  },
  {
    title: '时间线',
    items: [
      ['刷新', ['R']],
      ['仅显示未读', ['U']],
      ['搜索 / 命令面板', ['Ctrl', 'K']],
      ['添加订阅', ['Ctrl', 'N']],
      ['显示快捷键', ['?']],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcutsOpen);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="键盘快捷键" width={640}>
      <div className="scrollbar-thin max-h-[65vh] overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-callout font-bold uppercase tracking-wide text-fg/25">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map(([label, keys]) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-headline text-fg/85">{label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <footer className="flex justify-end border-t border-border px-4 py-3">
        <button type="button" className="btn btn-accent" onClick={() => setOpen(false)}>
          知道了
        </button>
      </footer>
    </Modal>
  );
}

/* ---------------------------------------------------------------- OPML */

/** Imports an OPML file through the native dialog, with a paste fallback. */
export async function importOpml(): Promise<void> {
  const { pushToast } = useUI.getState();
  try {
    const { Dialogs } = await import('@wailsio/runtime');
    const path = await Dialogs.OpenFile({
      Title: '选择 OPML 文件',
      Filters: [{ DisplayName: 'OPML 订阅列表', Pattern: '*.opml;*.xml' }],
    });
    if (!path) return;
    const result = await api.importOpmlFile(path as string);
    pushToast({ message: `已导入订阅源，新增 ${result.new} 篇文章`, tone: 'success' });
    await useApp.getState().reloadSubscriptions();
    return;
  } catch {
    // No native dialog available: accept pasted OPML text instead.
  }
  const pasted = window.prompt('粘贴 OPML 内容：');
  if (!pasted) return;
  try {
    const result = await api.importOpmlContent(pasted);
    pushToast({ message: `已导入订阅源，新增 ${result.new} 篇文章`, tone: 'success' });
    await useApp.getState().reloadSubscriptions();
  } catch (err) {
    pushToast({ message: `导入失败：${(err as Error).message}`, tone: 'error' });
  }
}

/** Exports subscriptions to an OPML file, falling back to the clipboard. */
export async function exportOpml(): Promise<void> {
  const { pushToast } = useUI.getState();
  try {
    const { Dialogs } = await import('@wailsio/runtime');
    const path = await Dialogs.SaveFile({
      Title: '导出订阅列表',
      Filename: 'reads-subscriptions.opml',
      Filters: [{ DisplayName: 'OPML 订阅列表', Pattern: '*.opml' }],
    });
    if (!path) return;
    const n = await api.exportOpmlFile(path as string);
    pushToast({ message: `已导出 ${n} 个订阅源`, tone: 'success' });
    return;
  } catch {
    // Fall through to the clipboard.
  }
  try {
    const content = await api.exportOpmlContent();
    await navigator.clipboard?.writeText(content);
    pushToast({ message: 'OPML 内容已复制到剪贴板', tone: 'success' });
  } catch (err) {
    pushToast({ message: `导出失败：${(err as Error).message}`, tone: 'error' });
  }
}
