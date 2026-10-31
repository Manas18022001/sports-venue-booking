import "server-only";
import { getDatabase } from "../database";
import { createBookingService } from "./service";

let service: ReturnType<typeof createBookingService> | undefined;
export function getBookingService() { return service ??= createBookingService(getDatabase()); }
