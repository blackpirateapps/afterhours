import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};
export default config;
