import { loadServerEnvironment } from "../environment.mjs";
import { getServerConfig } from "../src/server/config/index";
import { createDatabaseClient } from "../src/database/client";
import { registrationSchema } from "../src/server/auth/schemas";
import { hashPassword } from "../src/server/auth/passwords";

loadServerEnvironment();
const input = registrationSchema.safeParse({
  name: process.env.TURFIT_ADMIN_NAME,
  email: process.env.TURFIT_ADMIN_EMAIL,
  password: process.env.TURFIT_ADMIN_PASSWORD,
});
if (!input.success) {
  console.error("Set TURFIT_ADMIN_NAME, TURFIT_ADMIN_EMAIL, and a valid TURFIT_ADMIN_PASSWORD (15-128 characters).");
  process.exitCode = 1;
} else {
  const config = getServerConfig();
  const db = createDatabaseClient(config.database.connectionString, config.database.pool);
  try {
    const passwordHash = await hashPassword(input.data.password);
    await db.user.create({ data: { name: input.data.name, email: input.data.email, passwordHash, role: "ADMIN" } });
    console.log("Admin account created. Existing accounts are never promoted or overwritten by this command.");
  } catch {
    console.error("Admin provisioning failed. Check the database and whether this email already exists.");
    process.exitCode = 1;
  } finally {
    delete process.env.TURFIT_ADMIN_PASSWORD;
    await db.$disconnect();
  }
}
