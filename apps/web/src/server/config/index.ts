import "server-only";
import { parseServerConfig } from "./schema";
import type { ServerConfig } from "./schema";

let configuration: ServerConfig | undefined;

// Environment settings are a validated, immutable snapshot for this server
// instance. Restart the application after changing deployment configuration.
export function getServerConfig(): ServerConfig {
  configuration ??= parseServerConfig(process.env);
  return configuration;
}
