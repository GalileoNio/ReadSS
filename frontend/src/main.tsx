import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root')!;

/**
 * Renders a readable panel instead of leaving a blank window when the app
 * fails to boot. A WebView has no console the user can inspect, so a silent
 * white/dark screen is the worst possible failure mode.
 */
function showBootError(title: string, detail: string) {
  root.innerHTML = `
    <div style="height:100%;display:flex;align-items:center;justify-content:center;padding:32px;
                font-family:system-ui,-apple-system,'Segoe UI','PingFang SC',sans-serif">
      <div style="max-width:640px">
        <div style="font-size:15px;font-weight:600;color:#FF5C00;margin-bottom:8px">${title}</div>
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;
                    color:rgba(255,255,255,.5);margin:0">${detail}</pre>
      </div>
    </div>`;
}

window.addEventListener('error', (event) => {
  showBootError('ReadS 启动失败', String(event.error?.stack ?? event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  showBootError('ReadS 启动失败（异步）', String((event.reason as Error)?.stack ?? event.reason));
});

/** Catches render-time crashes in the React tree. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-[720px]">
            <p className="mb-2 text-title3 font-semibold text-accent">界面渲染出错</p>
            <pre className="selectable whitespace-pre-wrap break-words text-callout text-fg/50">
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// The desktop shell has no meaningful browser context menu.
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
  if (!el.closest('[data-allow-contextmenu]')) e.preventDefault();
});

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
