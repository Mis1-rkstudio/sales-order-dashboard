import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow these domains for next/image
    domains: ["drive.google.com", "lh3.googleusercontent.com"],

    // Optional: remotePatterns is more flexible (allows query strings, paths, etc.)
    remotePatterns: [
      {
        protocol: "https",
        hostname: "drive.google.com",
        pathname: "/thumbnail*",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
