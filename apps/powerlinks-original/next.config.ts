import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    // Required for static export — Next.js Image Optimisation API is server-side only.
    unoptimized: true,
  },
};

export default nextConfig;
