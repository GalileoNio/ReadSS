import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import { useUI } from '../store/ui';
import { cn } from '../lib/utils';

/* ------------------------------------------------------------ ContextMenu */

const MENU_WIDTH = 208;

/** Right-click menu, positioned so it never leaves the viewport. */
export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu);
  const close = useUI((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const height = ref.current.offsetHeight;
    const { innerWidth, innerHeight } = window;
    setPos({
      x: Math.min(menu.x, innerWidth - MENU_WIDTH - 8),
      y: Math.min(menu.y, innerHeight - height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Defer so the click that opened the menu does not immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener('click', dismiss);
      window.addEventListener('contextmenu', dismiss);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
      className="fixed z-[60] animate-scale-in rounded-lg border border-border bg-background p-1 shadow-pop"
      onClick={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            disabled={item.disabled}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-headline',
              'disabled:pointer-events-none disabled:opacity-40',
              item.danger
                ? 'text-red-500 hover:bg-red-500 hover:text-white'
                : 'text-fg/85 hover:bg-accent hover:text-white',
            )}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.checked && <Check size={13} className="shrink-0" />}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Toasts */

const TOAST_ICON = {
  info: Info,
  success: Check,
  warning: AlertTriangle,
  error: XCircle,
};

/** Bottom-right toast stack, styled with the app's material colours. */
export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.tone];
        const toneColor =
          toast.tone === 'success'
            ? 'text-emerald-500'
            : toast.tone === 'warning'
              ? 'text-amber-500'
              : toast.tone === 'error'
                ? 'text-red-500'
                : 'text-accent';
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto animate-slide-up rounded-lg border border-border px-3 py-2.5',
              'bg-background/95 shadow-pop backdrop-blur-md',
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon size={15} className={cn('mt-0.5 shrink-0', toneColor)} />
              <p className="flex-1 text-headline leading-snug text-fg/85">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-headline font-medium text-accent hover:bg-accent/10"
                  onClick={() => {
                    dismiss(toast.id);
                    toast.action!.onAction();
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="关闭提示"
                className="-mr-0.5 shrink-0 rounded p-0.5 text-fg/25 hover:bg-item-hover hover:text-fg/85"
                onClick={() => dismiss(toast.id)}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- countdown toast */

/**
 * Folo's mark-all-as-read confirmation: a warning toast with a live countdown
 * and an undo action that cancels the operation if used in time.
 */
export function useCountdownToast() {
  const pushToast = useUI((s) => s.pushToast);

  return (seconds: number, onConfirm: () => void, undoLabel = '撤销') => {
    let remaining = seconds;
    let done = false;

    const id = pushToast({
      message: `${seconds} 秒后将全部标记为已读…`,
      tone: 'warning',
      duration: 0,
      action: {
        label: undoLabel,
        onAction: () => {
          done = true;
        },
      },
    });

    const timer = window.setInterval(() => {
      remaining -= 1;
      if (done) {
        window.clearInterval(timer);
        return;
      }
      if (remaining <= 0) {
        window.clearInterval(timer);
        useUI.getState().dismissToast(id);
        onConfirm();
      } else {
        useUI.setState((s) => ({
          toasts: s.toasts.map((t) =>
            t.id === id
              ? { ...t, message: `${remaining} 秒后将全部标记为已读…` }
              : t,
          ),
        }));
      }
    }, 1000);
  };
}
