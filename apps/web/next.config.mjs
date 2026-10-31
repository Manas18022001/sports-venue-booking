import { loadServerEnvironment, repositoryRoot } from "./environment.mjs";
import { getSecurityHeaders } from "./security-headers.mjs";

// CLI tools and Next.js use the same root environment files in this workspace.
loadServerEnvironment();

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "pino"],
  async headers() {
    return [{ source: "/:path*", headers: getSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
};

export default nextConfig;
