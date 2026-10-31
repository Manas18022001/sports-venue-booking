import "server-only";
import { getDatabase } from "../database";
import { getServerConfig } from "../config";
import { createCatalogService } from "./catalog";
import { createVenueAdminService } from "./admin";

let catalog: ReturnType<typeof createCatalogService> | undefined;
let admin: ReturnType<typeof createVenueAdminService> | undefined;
export function getCatalogService() { return catalog ??= createCatalogService(getDatabase()); }
export function getVenueAdminService() { return admin ??= createVenueAdminService(getDatabase(), getServerConfig()); }
