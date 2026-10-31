import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations need a direct connection; application traffic can use a pooler.
  // Local development keeps using DATABASE_URL when DIRECT_URL is unset.
  datasource: { url: process.env.DIRECT_URL?.trim() || env("DATABASE_URL") },
});
