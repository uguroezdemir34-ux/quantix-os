import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // OKX secret asla browser'a sızmamalı; sadece server-side env'den okunur.
  env: {
    APP_VERSION: "2.0.0",
  },
};

// Bundle analyzer — ANALYZE=true ile koşulur, normal build'de no-op.
//   npm run analyze
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: true,
});

export default withBundleAnalyzer(nextConfig);
