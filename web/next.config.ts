import type { NextConfig } from "next";

// OPEN_EXPORT=1 builds the UI as static files for Cloudflare (npm run build:cf). The API then runs in the
// Worker (worker/index.ts), so route handlers (.ts) are left out and only pages and layouts (.tsx) are built.
const exporting = process.env.OPEN_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(exporting ? { output: "export", pageExtensions: ["tsx"], images: { unoptimized: true } } : { cacheComponents: true, partialPrefetching: true }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
