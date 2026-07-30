import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'Arial Narrow', 'sans-serif'],
        sans: ['"Source Sans 3 Variable"', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        ticket: '5px 5px 0 #241329',
        dock: '0 -3px 0 #241329',
        winner: '9px 9px 0 #241329',
      },
      colors: {
        canvas: '#F1F3EF',
        'canvas-deep': '#E4E7E5',
        ticket: '#FCFDF8',
        ink: '#241329',
        'ink-muted': '#5E5362',
        'ink-faint': '#5E5362',
        signal: '#EF3340',
        'signal-dark': '#C91F31',
        'signal-tint': '#FFE1E4',
        electric: '#2457FF',
        'electric-dark': '#183CC2',
        'electric-tint': '#DDE5FF',
        acid: '#C7F43D',
        'acid-tint': '#ECFFC0',
        rule: '#241329',
        danger: '#C91F31',
        'danger-tint': '#FFE1E4',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 2px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xs: 'calc(var(--radius) - 6px)',
      },
    },
  },
  plugins: [animate],
};
