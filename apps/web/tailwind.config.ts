import type { Config } from 'tailwindcss'

// Палітра й шрифти — з брифу M0 (`docs/m0-noah-prompt.md`): креслення на синьо-сірому
// папері. Колір несе один сенс — відмова до підпису (`refused`); решта — чорнило на папері.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      ground: '#5C6B7A',
      ink: '#F2F4F1',
      sec: '#B9C2CB',
      hair: '#8A97A5',
      fill: '#DCE3E8',
      refused: '#E5533D',
      transparent: 'transparent',
      inherit: 'inherit',
      current: 'currentColor',
    },
    fontFamily: {
      mono: [
        '"IBM Plex Mono"',
        '"JetBrains Mono"',
        'ui-monospace',
        '"Cascadia Mono"',
        'Consolas',
        'Menlo',
        'monospace',
      ],
      cond: ['"Roboto Condensed"', '"Arial Narrow"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
    },
    extend: {
      fontSize: {
        lbl: ['11px', { lineHeight: '1.55', letterSpacing: '0.08em' }],
      },
    },
  },
  plugins: [],
} satisfies Config
