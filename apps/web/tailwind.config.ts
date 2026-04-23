import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // CSS variables are the source of truth (see src/index.css).
      // Map semantic tokens here so utility classes like `bg-bg`, `text-text`, etc. work.
      colors: {
        bg: 'var(--bg)',
        'bg-subtle': 'var(--bg-subtle)',
        'bg-muted': 'var(--bg-muted)',
        'bg-dock': 'var(--bg-dock)',
        'bg-panel': 'var(--bg-panel)',
        'paper-bg': 'var(--paper-bg)',
        'input-bg': 'var(--input-bg)',
        'page-bg': 'var(--page-bg)',
        text: 'var(--text)',
        'text-strong': 'var(--text-strong)',
        'text-muted': 'var(--text-muted)',
        'text-subtle': 'var(--text-subtle)',
        'text-faint': 'var(--text-faint)',
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        accent: 'var(--accent)',
      },
    },
  },
  plugins: [],
} satisfies Config;
