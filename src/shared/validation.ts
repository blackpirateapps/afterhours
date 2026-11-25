import { IANAZone } from "luxon";
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
export const connectionInput = z.strictObject({
  username: usernameSchema,
  confirmOwnership: z.literal(true),
});
export const preferencesInput = z.strictObject({
  timeZone: z
    .string()
    .max(100)
    .refine((value) => IANAZone.isValidZone(value)),
  reduceMotion: z.boolean(),
});
export const rangeInput = z.enum(["7d", "30d", "90d"]);
export type Range = z.infer<typeof rangeInput>;
export const searchInput = z
  .string()
  .trim()
  .refine((value) => [...value].length <= 100);
