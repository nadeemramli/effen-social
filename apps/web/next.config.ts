import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@effen/core"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
    ],
  },
};

export default nextConfig;
