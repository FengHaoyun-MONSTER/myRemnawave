import { z } from 'zod';

export const MACHINE_STATUS = [
    'DRAFT',
    'ENROLLING',
    'PROVISIONING',
    'CONNECTED',
    'CONFIG_VALIDATED',
    'PUBLISHED',
    'DEGRADED',
    'FAILED',
    'DRAINING',
    'DISABLED',
    'ARCHIVED',
] as const;

export const WARP_STATUS = [
    'DISABLED',
    'INSTALLING',
    'CONNECTING',
    'CONNECTED',
    'DEGRADED',
    'FAILED',
] as const;

const DateSchema = z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]);

export const MachineSchema = z.object({
    uuid: z.uuid(),
    name: z.string(),
    address: z.string(),
    status: z.enum(MACHINE_STATUS),
    countryCode: z.string(),
    tags: z.array(z.string()),
    note: z.string().nullable(),
    agentVersion: z.string().nullable(),
    agentCapabilities: z.array(z.string()),
    agentConnectedAt: DateSchema.nullable(),
    agentLastSeenAt: DateSchema.nullable(),
    systemInfo: z.unknown().nullable(),
    clientCertExpiresAt: DateSchema.nullable(),
    warpStatus: z.enum(WARP_STATUS),
    warpProxyPort: z.int().nullable(),
    warpLastChecked: DateSchema.nullable(),
    archivedAt: DateSchema.nullable(),
    createdAt: DateSchema,
    updatedAt: DateSchema,
});

export const MachineEnrollmentTokenSchema = z.object({
    machine: MachineSchema,
    enrollmentToken: z.string(),
    enrollmentExpiresAt: DateSchema,
});
