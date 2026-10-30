import { fileURLToPath } from "node:url";
import nextEnvironment from "@next/env";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const { loadEnvConfig } = nextEnvironment;

// CLI tools and Next.js use the same root environment files in this workspace.
loadEnvConfig(repositoryRoot, process.env.NODE_ENV !== "production");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
};

export default nextConfig;
