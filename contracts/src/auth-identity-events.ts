import { z } from "zod";

export const AUTH_IDENTITY_EVENT_CONTRACT_VERSION = 1 as const;

const nullableText = z.string().nullable();
const clientKindSchema = z.enum(["natural", "juridical"]).nullable();
const roleSchema = z.enum(["admin", "worker", "client"]);

const authIdentityEventBaseSchema = z.object({
  version: z.literal(AUTH_IDENTITY_EVENT_CONTRACT_VERSION),
  userSub: z.string().uuid(),
  email: z.string().email(),
  role: roleSchema,
  firstName: nullableText,
  lastName: nullableText,
  clientKind: clientKindSchema,
  companyName: nullableText,
  profession: nullableText,
  timestamp: z.string().datetime({ offset: true }),
});

export const userRegisteredIdentityEventSchema = authIdentityEventBaseSchema.extend({
  type: z.literal("user.registered"),
});

export const userUpdatedIdentityEventSchema = authIdentityEventBaseSchema.extend({
  type: z.literal("user.updated"),
});

export const userDeletedIdentityEventSchema = authIdentityEventBaseSchema.extend({
  type: z.literal("user.deleted"),
});

export const authIdentityEventSchema = z.discriminatedUnion("type", [
  userRegisteredIdentityEventSchema,
  userUpdatedIdentityEventSchema,
  userDeletedIdentityEventSchema,
]);

export type AuthIdentityEvent = z.infer<typeof authIdentityEventSchema>;
export type UserRegisteredIdentityEvent = z.infer<typeof userRegisteredIdentityEventSchema>;
export type UserUpdatedIdentityEvent = z.infer<typeof userUpdatedIdentityEventSchema>;
export type UserDeletedIdentityEvent = z.infer<typeof userDeletedIdentityEventSchema>;
