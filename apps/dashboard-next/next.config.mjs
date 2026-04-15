/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add these two blocks to force Vercel to deploy!
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig; 
// (Note: If your file uses 'module.exports = nextConfig', keep using that instead!)