import type { NextConfig } from "next";

// Hostnames the admin UI is opened from (e.g. the LAN IP). Without this, `next dev` blocks its
// JS bundles for non-localhost hosts and the admin pages never hydrate.
const devHosts = (process.env.ADMIN_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((o) => {
    try {
      return new URL(o.trim()).hostname;
    } catch {
      return "";
    }
  })
  .filter(Boolean);

const nextConfig: NextConfig = {
  // gzip would buffer the SSE stream from /v1/messages.
  compress: false,
  allowedDevOrigins: devHosts,
};

export default nextConfig;
