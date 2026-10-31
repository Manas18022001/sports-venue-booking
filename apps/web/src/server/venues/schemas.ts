import { z } from "zod";
import { isLocalDate, isTimeZone } from "./time";

export const idSchema = z.uuid().transform(value => value.toLowerCase());
export const localDateSchema = z.string().refine(isLocalDate);
const limit = (defaultValue: number, maximum: number) => z.string().regex(/^\d{1,3}$/)
  .transform(Number).pipe(z.number().int().min(1).max(maximum)).optional().transform(value => value ?? defaultValue);
const pagination = { cursor: idSchema.optional(), limit: limit(20, 50) };
export const venueQuerySchema = z.object({ ...pagination, city: z.string().trim().min(1).max(100).optional(), sport: z.string().trim().min(1).max(60).optional() }).strict();
export const courtQuerySchema = z.object(pagination).strict();
export const slotQuerySchema = z.object({ date: localDateSchema, courtId: idSchema.optional(), cursor: idSchema.optional(), limit: limit(100, 500) }).strict();

const venueFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000),
  address: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
  timezone: z.string().max(64).refine(isTimeZone, { params: { messageCode: "timezone" } }),
  currency: z.literal("INR"),
  imageUrl: z.url({ protocol: /^https$/ }).max(2048).nullable(),
  isActive: z.boolean(),
};
export const venueCreateSchema = z.object({ ...venueFields,
  description: venueFields.description.default(""), timezone: venueFields.timezone.default("Asia/Kolkata"),
  currency: venueFields.currency.default("INR"), imageUrl: venueFields.imageUrl.default(null), isActive: venueFields.isActive.default(true),
}).strict();
export const venueUpdateSchema = z.object(venueFields).partial().strict().refine(value => Object.keys(value).length > 0);
const courtFields = { name: z.string().trim().min(1).max(120), sport: z.string().trim().min(1).max(60), isActive: z.boolean() };
export const courtCreateSchema = z.object({ ...courtFields, isActive: courtFields.isActive.default(true) }).strict();
export const courtUpdateSchema = z.object(courtFields).partial().strict().refine(value => Object.keys(value).length > 0);

// Offset-bearing instants make overnight windows and repeated DST hours explicit.
const minuteInstant = z.iso.datetime({ offset: true, precision: 0 })
  .refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) % 60_000 === 0, { params: { messageCode: "minuteAligned" } });
export const generationSchema = z.object({
  courtIds: z.array(idSchema).min(1).max(20).refine(value => new Set(value).size === value.length, { params: { messageCode: "distinctCourts" } }),
  startsAt: minuteInstant,
  endsAt: minuteInstant,
  durationMinutes: z.number().int().min(5).max(1440).default(60),
  priceMinor: z.number().int().min(0).max(2_147_483_647),
}).strict().superRefine((value, context) => {
  const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60_000;
  if (!(minutes > 0)) context.addIssue({ code: "custom", path: ["endsAt"], params: { messageCode: "windowOrder" } });
  else if (minutes > 26 * 60) context.addIssue({ code: "custom", path: ["endsAt"], params: { messageCode: "windowLength" } });
  const count = Math.floor(minutes / value.durationMinutes);
  if (minutes > 0 && count < 1) context.addIssue({ code: "custom", path: ["durationMinutes"], params: { messageCode: "batchMinimum" } });
  if (count * value.courtIds.length > 500) context.addIssue({ code: "custom", path: ["durationMinutes"], params: { messageCode: "batchMaximum" } });
});
export const generationConfirmSchema = generationSchema.safeExtend({
  previewToken: z.string().min(1).max(4096),
  acknowledgeUnusedPeriod: z.boolean().default(false),
});
export const slotUpdateSchema = z.object({
  version: z.number().int().positive(),
  startsAt: minuteInstant.optional(), endsAt: minuteInstant.optional(),
  priceMinor: z.number().int().min(0).max(2_147_483_647).optional(),
  isBlocked: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "version"));

export type VenueQuery = z.infer<typeof venueQuerySchema>;
export type CourtQuery = z.infer<typeof courtQuerySchema>;
export type SlotQuery = z.infer<typeof slotQuerySchema>;
export type GenerationInput = z.infer<typeof generationSchema>;
