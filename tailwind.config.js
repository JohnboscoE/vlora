/** @type {import('tailwindcss').Config} */

// Theme colors are RGB channel triplets in src/index.css (light on :root,
// dark on .dark), so opacity modifiers like bg-surface/80 keep working.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        muted: token('muted'),
        subtle: token('subtle'),
        line: token('line'),
        brand: token('brand'),
        'brand-2': token('brand-2'),
        success: token('success'),
        danger: token('danger'),
        primary: token('primary'),
        'primary-ink': token('primary-ink'),
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
