/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "firebase-admin", "googleapis"],
  },
};

export default nextConfig;
