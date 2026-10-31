import "server-only";
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const policy = Object.freeze({ algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });

export function hashPassword(password: string): Promise<string> {
  return hash(password, policy);
}

let dummyHash: Promise<string> | undefined;

export async function verifyPassword(password: string, encodedHash: string | undefined): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  const dummy = await dummyHash;
  const target = encodedHash ?? dummy;
  try {
    const valid = await verify(target, password);
    return encodedHash !== undefined && valid;
  } catch {
    // Invalid stored hashes still do ordinary verification work before failure.
    await verify(await dummyHash, password);
    return false;
  }
}
