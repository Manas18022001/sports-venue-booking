import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = new URL("../.env", import.meta.url);
let contents = readFileSync(existsSync(envPath) ? envPath : new URL("../.env.example", import.meta.url), "utf8");
const current = parse(contents);

for (const [key, databases] of [["DATABASE_URL", ["turfit"]], ["TEST_DATABASE_URL", ["turfit", "turfit_test"]]]) {
  if (!current[key]) continue;
  let url;
  try { url = new URL(current[key]); }
  catch { throw new Error(`Cannot parse ${key}. Correct that connection URL before configuring the local database.`); }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !databases.includes(decodeURIComponent(url.pathname.slice(1)))) {
    throw new Error(`Refusing to replace ${key}: it is not Turfit's default local database. Configure it manually instead.`);
  }
}
const username = current.POSTGRES_USER || "turfit";
const password = current.POSTGRES_PASSWORD || randomBytes(32).toString("hex");
const port = current.POSTGRES_PORT || "5432";
if (!/^[a-z_][a-z0-9_]{0,30}$/.test(username) || !/^\d{4,5}$/.test(port) || Number(port) > 65535 || Number(port) < 1024) throw new Error("Check POSTGRES_USER and POSTGRES_PORT.");
// This helper's generated hexadecimal password needs no Compose interpolation.
if (!/^[a-f0-9]{64}$/i.test(password)) throw new Error("The local helper expects a 64-character hexadecimal POSTGRES_PASSWORD. Configure other passwords manually.");

function set(key, value) {
  const expression = new RegExp(`^(?:export\\s+)?${key}=.*$`, "gm");
  const line = `${key}=${JSON.stringify(value)}`;
  if (expression.test(contents)) contents = contents.replace(expression, () => line);
  else contents += `${contents.endsWith("\n") ? "" : "\n"}${line}\n`;
}
set("POSTGRES_USER", username); set("POSTGRES_PASSWORD", password); set("POSTGRES_PORT", port);
set("DATABASE_URL", `postgresql://${username}:${password}@127.0.0.1:${port}/turfit?schema=public`);
set("TEST_DATABASE_URL", `postgresql://${username}:${password}@127.0.0.1:${port}/turfit?schema=public`);
if (!current.AUTH_SECRET) set("AUTH_SECRET", randomBytes(32).toString("hex"));
writeFileSync(envPath, contents, { mode: 0o600 });
console.log(`Local database settings saved in ${root}.env. PostgreSQL will listen on 127.0.0.1:${port}.`);
