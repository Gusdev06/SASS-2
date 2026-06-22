/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // Image uploads to the Imagem → Prompt server action exceed the 1MB default.
    serverActions: { bodySizeLimit: '25mb' },
  },
  images: {
    // Desativa a Otimização de Imagem da Vercel (que tem cota mensal no plano free).
    // As imagens passam a ser servidas direto da origem, sem contar no limite.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'replicate.delivery' },
      { protocol: 'https', hostname: '*.replicate.delivery' },
      // Supabase Storage (bucket `files`) — permanent home for all generations.
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
};

export default nextConfig;
