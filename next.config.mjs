/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: {
    '/api/public-generate': ['./node_modules/geist/dist/fonts/geist-sans/Geist-Black.ttf'],
    '/api/generate/**/*': ['./node_modules/geist/dist/fonts/geist-sans/Geist-Black.ttf'],
    '/dashboard/**/*': ['./node_modules/geist/dist/fonts/geist-sans/Geist-Black.ttf'],
  },
};

export default nextConfig;
