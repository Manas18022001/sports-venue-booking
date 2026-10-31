import { loadServerEnvironment, repositoryRoot } from "./environment.mjs";

// CLI tools and Next.js use the same root environment files in this workspace.
loadServerEnvironment();

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
};

export default nextConfig;
