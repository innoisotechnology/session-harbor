export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        // Core neutrals - warm slate with slight blue undertone
        surface: {
          50: '#fafbfc',
          100: '#f4f6f8',
          200: '#e8ecf0',
          300: '#d1d9e0',
          400: '#9ba8b4',
          500: '#6b7a88',
          600: '#4a5663',
          700: '#333d47',
          800: '#1e252c',
          900: '#141a1f',
          950: '#0c1015',
        },
        // Accent - terminal green (phosphor-inspired)
        terminal: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Secondary accent - cyan for user messages
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        // Status colors
        success: '#22c55e',
        warning: '#eab308',
        error: '#ef4444',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        glow: '0 0 20px rgba(34, 197, 94, 0.15)',
        'glow-sm': '0 0 10px rgba(34, 197, 94, 0.1)',
        inner: 'inset 0 1px 2px rgba(0, 0, 0, 0.1)',
        card: '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.05)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
