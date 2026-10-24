import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      // Table theme. The fonts come from next/font in app/layout.tsx.
      fontFamily: {
        grotesk: ["var(--font-grotesk)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        tmono: ["var(--font-mono-table)", "ui-monospace", "monospace"],
      },
      colors: {
        gold: { DEFAULT: "#f5c542", deep: "#d9a928" },
        panel: "#141420",
        line: "#2a2a3d",
        hot: "#ff2d87",
      },
    },
  },
  plugins: [],
};
export default config;
