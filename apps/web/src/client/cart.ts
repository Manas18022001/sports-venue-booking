import { z } from "zod";

const cartSchema = z.object({
  venue: z.object({
    id: z.uuid(),
    name: z.string().max(160),
    timezone: z
      .string()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        courtId: z.uuid(),
        courtName: z.string().max(120),
        sport: z.string().max(60),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        priceMinor: z.number().int().nonnegative().max(2_147_483_647),
        version: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(500),
  key: z.uuid(),
  pendingUserId: z.uuid().nullable(),
});
export type Cart = z.infer<typeof cartSchema>;
export function readCart(value: string | null): Cart | null {
  if (!value || value.length > 250_000) return null;
  try {
    const parsed = cartSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function cartTotal(cart: Cart | null) {
  return cart?.items.reduce((sum, item) => sum + item.priceMinor, 0) ?? 0;
}
