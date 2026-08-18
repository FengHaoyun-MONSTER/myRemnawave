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

const DateSchema = z.iso.datetime().transform((value) => new Date(value));

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
    lastErrorCode: z.string().nullable(),
    lastStatusMessage: z.string().nullable(),
    archivedAt: DateSchema.nullable(),
    createdAt: DateSchema,
    updatedAt: DateSchema,
});

export const MachineEnrollmentTokenSchema = z.object({
    machine: MachineSchema,
    enrollmentToken: z.string(),
    enrollmentExpiresAt: DateSchema,
});

export const MachinePlanCheckSchema = z.object({
    code: z.string().min(1).max(64),
    ok: z.boolean(),
    message: z.string().max(1024),
});

export const MachineProtocolPlanSchema = z.object({
    protocol: z.enum(['VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2']),
    network: z.enum(['tcp', 'udp']),
    status: z.enum(['READY', 'BLOCKED']),
    selectedPort: z.int().min(1).max(65535).nullable(),
    errorCode: z.string().max(64).optional(),
    message: z.string().max(1024).optional(),
    checks: z.array(MachinePlanCheckSchema).max(16),
    portAttempts: z
        .array(
            z.object({
                port: z.int().min(1).max(65535),
                available: z.boolean(),
                message: z.string().max(1024),
            }),
        )
        .max(16),
});

export const MachineProvisioningPlanResultSchema = z.object({
    planId: z.uuid(),
    system: z.unknown(),
    machineChecks: z.array(MachinePlanCheckSchema).max(32),
    dependencies: z
        .array(
            z.object({
                name: z.string().min(1).max(64),
                state: z.string().min(1).max(64),
                action: z.string().min(1).max(64),
                ownership: z.string().min(1).max(64),
                required: z.boolean(),
                message: z.string().max(1024),
            }),
        )
        .max(16),
    protocols: z.array(MachineProtocolPlanSchema).min(1).max(3),
    machineReady: z.boolean(),
    ready: z.boolean(),
});

export const MachineProvisioningPlanSchema = z.object({
    uuid: z.uuid(),
    machineUuid: z.uuid(),
    status: z.enum(['PENDING', 'READY', 'BLOCKED', 'APPLIED', 'EXPIRED', 'FAILED']),
    result: MachineProvisioningPlanResultSchema.nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    expiresAt: DateSchema,
    appliedAt: DateSchema.nullable(),
    createdAt: DateSchema,
    updatedAt: DateSchema,
});
