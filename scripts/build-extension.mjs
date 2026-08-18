import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/background.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116"
  })
]);
