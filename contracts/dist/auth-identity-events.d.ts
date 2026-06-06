import { z } from "zod";
export declare const AUTH_IDENTITY_EVENT_CONTRACT_VERSION: 1;
export declare const userRegisteredIdentityEventSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.registered">;
}, z.core.$strip>;
export declare const userUpdatedIdentityEventSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.updated">;
}, z.core.$strip>;
export declare const userDeletedIdentityEventSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.deleted">;
}, z.core.$strip>;
export declare const authIdentityEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.registered">;
}, z.core.$strip>, z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.updated">;
}, z.core.$strip>, z.ZodObject<{
    version: z.ZodLiteral<1>;
    userSub: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        worker: "worker";
        client: "client";
    }>;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    clientKind: z.ZodNullable<z.ZodEnum<{
        natural: "natural";
        juridical: "juridical";
    }>>;
    companyName: z.ZodNullable<z.ZodString>;
    profession: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"user.deleted">;
}, z.core.$strip>], "type">;
export type AuthIdentityEvent = z.infer<typeof authIdentityEventSchema>;
export type UserRegisteredIdentityEvent = z.infer<typeof userRegisteredIdentityEventSchema>;
export type UserUpdatedIdentityEvent = z.infer<typeof userUpdatedIdentityEventSchema>;
export type UserDeletedIdentityEvent = z.infer<typeof userDeletedIdentityEventSchema>;
