/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Lean, self-contained server bundle for the Docker runtime image
  // (Dockerfile copies .next/standalone instead of the whole node_modules tree).
  output: 'standalone',
}

export default nextConfig
