import { loadServerEnvironment } from "../environment.mjs";
import { parseServerConfig, ServerConfigurationError } from "../src/server/config/schema.ts";

// Node.js 24 runs this small TypeScript preflight directly. It needs no generated
// Prisma client, database connection, tsx, or Next.js server to validate settings.
Object.assign(process.env, { NODE_ENV: process.argv[2] ?? "development" });
loadServerEnvironment();

try {
  parseServerConfig(process.env);
} catch (error) {
  if (!(error instanceof ServerConfigurationError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
