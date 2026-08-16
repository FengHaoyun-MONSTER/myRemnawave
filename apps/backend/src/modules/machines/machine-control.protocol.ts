import { z } from 'zod';

export const MACHINE_CONTROL_PROTOCOL_VERSION = 1;
export const MACHINE_CONTROL_MAX_MESSAGE_BYTES = 4 << 20;

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);

export const helloSchema = z
    .object({
        machineId: z.uuid(),
        agentVersion: z.string().min(1).max(64),
        capabilities: z.array(identifierSchema).max(64),
    })
    .strict();

export const heartbeatSchema = z
    .object({
        machineId: z.uuid(),
        time: z.iso.datetime(),
    })
    .strict();

export const commandResultSchema = z
    .object({
        commandId: z.uuid(),
        idempotencyKey: identifierSchema,
        status: z.enum(['succeeded', 'failed', 'unsupported']),
        errorCode: identifierSchema.optional(),
        message: z.string().max(16_385).optional(),
        payload: z.unknown().optional(),
        completedAt: z.iso.datetime(),
    })
    .strict();

export const agentEnvelopeSchema = z
    .object({
        version: z.literal(MACHINE_CONTROL_PROTOCOL_VERSION),
        id: identifierSchema,
        type: z.enum(['hello', 'heartbeat', 'command_result']),
        sentAt: z.iso.datetime(),
        payload: z.unknown(),
    })
    .strict();

export interface MachineCommandMessage {
    uuid: string;
    kind: string;
    idempotencyKey: string;
    deadlineAt: Date;
    payload: unknown;
}

export function commandEnvelope(command: MachineCommandMessage) {
    return {
        version: MACHINE_CONTROL_PROTOCOL_VERSION,
        id: `command-${command.uuid}`,
        type: 'command',
        sentAt: new Date().toISOString(),
        payload: {
            id: command.uuid,
            kind: command.kind,
            idempotencyKey: command.idempotencyKey,
            deadline: command.deadlineAt.toISOString(),
            payload: command.payload,
        },
    };
}
