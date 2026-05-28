import type { Config } from "tailwindcss";

/**
 * v55.51 panel CSS değişkenlerinden birebir port edildi.
 * Renkler değiştirilmemeli — UI tutarlılığı + alışılmış görsel kimlik.
 * Kaynak: panel_v55_51.html satır 622-642.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0A0A0A",
          card: "#141414",
          card2: "#1C1C1C",
        },
        border: {
          DEFAULT: "#2A2A2A",
          strong: "#3A3A3A",
        },
        text: {
          t1: "#F5F5F5", // primary
          t2: "#B8B8B8", // secondary
          t3: "#707070", // muted
          t4: "#4A4A4A", // disabled
        },
        // Marka turuncu — Uğur Panel kimliği (OKX yeşili DEĞİL)
        brand: {
          DEFAULT: "#FF6B1A",
          light: "#FF8C42",
        },
        signal: {
          green: "#22C55E",
          red: "#EF4444",
          amber: "#F59E0B",
          blue: "#3B82F6",
        },
        soft: {
          green: "rgba(34,197,94,0.08)",
          red: "rgba(239,68,68,0.08)",
          amber: "rgba(245,158,11,0.08)",
          blue: "rgba(59,130,246,0.08)",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        base: ["14px", "1.5"],
        xs: ["11px", "1.4"],
        "2xs": ["9px", "1.3"],
      },
      letterSpacing: {
        wider: "0.05em",
        widest: "0.08em",
      },
    },
  },
  plugins: [],
};

export default config;
