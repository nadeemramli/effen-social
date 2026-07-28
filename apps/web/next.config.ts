import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@effen/core"],
  experimental: {
    // Keep dynamic pages in the client router cache briefly so repeat tab
    // visits are instant; server actions' revalidatePath still busts it.
    staleTimes: { dynamic: 30 },
  },
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
