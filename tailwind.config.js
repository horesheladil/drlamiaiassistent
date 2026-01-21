
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-yellow': '#F2C230',
        'brand-amber': '#F2921D',
        'brand-orange': '#F24F13',
        'brand-slate': '#8082A6',
        'brand-dark': '#46334F',
        'brand-ivory': '#FDFDFD',
      },
      fontFamily: {
        sans: ['Montserrat', 'sans-serif'],
      },
      transitionProperty: {
        'custom': 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      }
    },
  },
  plugins: [],
}
