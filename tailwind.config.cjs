/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/client/**/*.{svelte,ts,html}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fdf2f1',
          100: '#fce4e2',
          200: '#f9ccc8',
          300: '#f4a8a0',
          400: '#ec7469',
          500: '#A62F24',
          600: '#A62F24',
          700: '#731F17',
          800: '#5c1912',
          900: '#4a1610',
        },
        danger: {
          500: '#F24C3D',
          600: '#d93829',
        },
      },
    },
  },
  plugins: [require('flowbite/plugin')],
};
