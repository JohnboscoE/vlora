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
      // The one step Tailwind's scale is missing. Nothing in the app goes below
      // this: 10px text was legible on the machine it was written on and nowhere
      // else. Meta and hint text is text-xs; this is for uppercase pills only.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem' }],
      },
      // Three radii with a job each, instead of five picked by feel. A control is
      // something you press or type in, a card is a surface that holds controls,
      // and card-sm is a card nested inside another one.
      borderRadius: {
        control: '0.75rem',
        'card-sm': '1rem',
        card: '1.25rem',
        pill: '9999px',
      },
    },
  },
  plugins: [],
}
