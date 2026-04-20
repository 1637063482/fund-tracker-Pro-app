import tailwindcssAnimate from 'tailwindcss-animate';
// ... plugins: [tailwindcssAnimate]

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", 
  ],
  theme: {
    extend: {},
  },
  plugins: [
    tailwindcssAnimate
  ],
}