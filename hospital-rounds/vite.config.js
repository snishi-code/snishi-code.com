import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// base パス:
//   - dev (vite serve):       "/"
//   - test (vite build --mode test): "/"   ← hospital-rounds.snishi-code.com ルート配信
//   - prod (vite build):      "/hospital-rounds/" ← snishi-code.com/hospital-rounds/ 配下
export default defineConfig(({ command, mode }) => ({
  base: command === "serve" || mode === "test" ? "/" : "/hospital-rounds/",
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
}));
