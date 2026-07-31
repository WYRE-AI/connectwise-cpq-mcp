import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Bundles index.html + quote-card.ts into a single self-contained HTML file
// at dist/index.html, which ../scripts/embed-ui.mjs then embeds as
// ../src/generated/quote-card-html.ts. Single-file is required: the MCP Apps
// host fetches one HTML string via resources/read, so all JS/CSS must be inlined.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    assetsInlineLimit: 100000000,
  },
});
