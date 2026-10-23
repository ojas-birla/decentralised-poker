/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@poker/shared"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;