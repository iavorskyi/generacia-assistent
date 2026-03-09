/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "firebase-admin", "googleapis", "xlsx"],
  },
};

export default nextConfig;
