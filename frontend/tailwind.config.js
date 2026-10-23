/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Folo's brand accent: hsl(21.6 100% 50%) === #FF5C00
        accent: 'hsl(var(--fo-a) / <alpha-value>)',

        background: 'hsl(var(--fo-background) / <alpha-value>)',
        sidebar: 'hsl(var(--fo-sidebar) / <alpha-value>)',
        'sidebar-active': 'hsl(var(--fo-sidebar-active) / <alpha-value>)',
        'theme-item': 'hsl(var(--fo-item) / <alpha-value>)',
        fill: 'hsl(var(--fo-fill) / <alpha-value>)',
        border: 'hsl(var(--fo-border) / <alpha-value>)',

        // macOS-style text ramp: use text-fg/85, /50, /25
        fg: 'hsl(var(--fo-fg) / <alpha-value>)',

        // Already-translucent state colours, referenced directly.
        'item-hover': 'var(--fo-item-hover)',
        'item-active': 'var(--fo-item-active)',
      },
      // Radius by role (DESIGN-REVIEW §3.1): control 8 / card 10 / panel 12.
      borderRadius: {
        DEFAULT: 'var(--r-control)',
        lg: 'var(--r-card)',
        xl: 'var(--r-panel)',
        control: 'var(--r-control)',
        card: 'var(--r-card)',
        panel: 'var(--r-panel)',
      },
      fontFamily: {
        sans: [
          'SN Pro',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      // Folo's custom type scale (size / line-height in px)
      fontSize: {
        largeTitle: ['26px', '32px'],
        title1: ['22px', '26px'],
        title2: ['17px', '22px'],
        title3: ['15px', '20px'],
        headline: ['13px', '16px'],
        body: ['13px', '16px'],
        callout: ['12px', '15px'],
        subheadline: ['11px', '14px'],
        footnote: ['10px', '13px'],
        read: ['15px', '1.75'],
      },
      spacing: {
        feedcol: 'var(--fo-feed-col-w)',
        entrycol: 'var(--fo-entry-col-w)',
        header: 'var(--h-header)',
        rail: 'var(--w-rail)',
        col: 'var(--w-col)',
        dialog: 'var(--w-dialog)',
        modal: 'var(--modal-w)',
        'modal-h': 'var(--modal-h)',
      },
      transitionTimingFunction: {
        folo: 'cubic-bezier(.16,1,.3,1)',
      },
      boxShadow: {
        pop: '0 10px 38px -10px rgba(0,0,0,.35), 0 10px 20px -15px rgba(0,0,0,.2)',
        modal: '0 24px 64px -12px rgba(0,0,0,.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .16s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.16,1,.3,1)',
        'scale-in': 'scale-in .14s cubic-bezier(.16,1,.3,1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
