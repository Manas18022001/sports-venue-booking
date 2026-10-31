import { z } from "zod";

export const normalizedEmail = z.string().trim().toLowerCase().max(254).email();
const blockedPasswords = new Set(["123456789012345", "passwordpassword", "qwertyqwertyqwerty", "letmeinletmeinletmein"]);

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: normalizedEmail,
  password: z.string().max(512)
    .refine((value) => Array.from(value).length >= 15 && Array.from(value).length <= 128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 512)
    .refine((value) => !blockedPasswords.has(value.toLowerCase())),
}).strict();

export const loginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1).max(512),
}).strict();

export const emptyBodySchema = z.object({}).strict();
export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
