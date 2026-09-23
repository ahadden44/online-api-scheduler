import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is bound on 0.0.0.0, so a browser on 127.0.0.1 is treated as
  // another host and its scripts are rejected. The week board never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
