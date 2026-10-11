// Builds the web app into dist/web and bundles the server + CLI into dist/cli.js.
import { build as vite } from "vite";
import { build as esbuild } from "esbuild";
import { chmodSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
await vite({ logLevel: "warn" });
await esbuild({
  entryPoints: ["server/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
chmodSync("dist/cli.js", 0o755);
console.log("built dist/web and dist/cli.js");
