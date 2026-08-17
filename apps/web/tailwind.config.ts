import type { Config } from 'tailwindcss'

// Палітра й шрифти приходять з експорту M0 (задача переносу); до того — нейтральний
// мінімум, щоб оболонка збиралась.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      ground: '#F6F6F4',
      ink: '#161616',
      muted: '#6B6B6B',
      rule: '#C9C9C4',
      transparent: 'transparent',
      inherit: 'inherit',
    },
    fontFamily: {
      sans: ['system-ui', 'sans-serif'],
      mono: ['ui-monospace', '"Cascadia Mono"', 'Consolas', 'Menlo', 'monospace'],
    },
  },
  plugins: [],
} satisfies Config
