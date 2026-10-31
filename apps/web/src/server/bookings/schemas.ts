import { z } from "zod";

export const bookingIdSchema = z.uuid().transform(value => value.toLowerCase());
export const idempotencyKeySchema = bookingIdSchema;
const distinctIds = (values: string[]) => new Set(values).size === values.length;

export const checkoutSchema = z.object({
  venueId: bookingIdSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(z.object({
    slotId: bookingIdSchema,
    version: z.number().int().positive(),
    priceMinor: z.number().int().min(0).max(2_147_483_647),
  }).strict()).min(1).max(500).refine(items => distinctIds(items.map(item => item.slotId))),
}).strict();
const cancellationFields = { itemIds: z.array(bookingIdSchema).min(1).max(500).refine(distinctIds) };
export const cancellationSchema = z.object(cancellationFields).strict();
export const adminCancellationSchema = z.object({ ...cancellationFields, reason: z.string().trim().min(1).max(1000) }).strict();
const pagination = {
  cursor: bookingIdSchema.optional(),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(50))
    .optional().transform(value => value ?? 20),
};
export const bookingQuerySchema = z.object(pagination).strict();
export const adminBookingQuerySchema = z.object({ ...pagination, venueId: bookingIdSchema.optional() }).strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export function canonicalCheckout(input: CheckoutInput) {
  return { venueId: input.venueId, currency: input.currency,
    items: [...input.items].sort((a, b) => a.slotId.localeCompare(b.slotId)).map(item => ({ slotId: item.slotId, version: item.version, priceMinor: item.priceMinor })) };
}
