import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM Postgres build; keep it (and pg) out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
