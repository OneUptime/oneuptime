/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4338ca",
        secondary: "#0f172a",
        accent: "#22d3ee",
        success: "#22c55e",
        warning: "#f97316",
        danger: "#ef4444"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        display: ["Sora", "ui-sans-serif", "system-ui"]
      }
    }
  },
  plugins: []
};
