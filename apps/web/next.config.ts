import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // near-api-js works in Node on the server; keep it external so Next does not
  // try to bundle its Node-only entry points into client chunks.
  serverExternalPackages: ["near-api-js"],
};

export default nextConfig;
