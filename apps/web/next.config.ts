import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@socal/backend", "@socal/ui"],
};

export default nextConfig;
