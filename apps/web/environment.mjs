import { fileURLToPath } from "node:url";
import nextEnvironment from "@next/env";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const { loadEnvConfig } = nextEnvironment;

export function loadServerEnvironment() {
  // Next.js may already have cached a scan of apps/web. Force the canonical
  // root directory to be scanned while retaining host-environment precedence.
  loadEnvConfig(repositoryRoot, process.env.NODE_ENV !== "production", undefined, true);
}
