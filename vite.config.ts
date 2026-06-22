// Plain, vendor-neutral Vite config for TanStack Start on Cloudflare Workers
// (replaces the former @lovable.dev/vite-tanstack-config wrapper).
//
// Uses Nitro (nitro/vite) with the "cloudflare_module" preset, which is the
// same deployment path the app was already using under Lovable (its config
// comment said: "nitro build-only using cloudflare as a default target").
// Nitro builds a .output/ folder; wrangler deploy reads it via wrangler.jsonc.
//
// The SSR entry point is src/server.ts, which re-exports TanStack Start's
// default server-entry wrapped with our own SSR error-normalization logic —
// unchanged from before.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Use src/server.ts (our SSR error wrapper) instead of TanStack
      // Start's bundled default entry.
      server: { entry: "./src/server.ts" },
    }),
    nitro({ preset: "cloudflare_module" }),
    viteReact(),
  ],
  resolve: {
    // Avoid duplicate React/TanStack instances if a dependency bundles its
    // own copy — prevents "invalid hook call" / context-mismatch errors.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
});
