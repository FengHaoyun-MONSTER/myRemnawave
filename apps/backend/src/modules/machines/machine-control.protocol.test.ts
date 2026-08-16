import { describe, expect, it } from 'vitest';

import {
    agentEnvelopeSchema,
    commandEnvelope,
    MACHINE_CONTROL_PROTOCOL_VERSION,
} from './machine-control.protocol';

describe('Machine control protocol', () => {
    it('rejects version drift and unknown fields', () => {
        const valid = {
            version: MACHINE_CONTROL_PROTOCOL_VERSION,
            id: 'hello-machine',
            type: 'hello',
            sentAt: '2026-08-16T00:00:00.000Z',
            payload: {},
        };
        expect(agentEnvelopeSchema.safeParse(valid).success).toBe(true);
        expect(agentEnvelopeSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
        expect(agentEnvelopeSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
    });

    it('serializes durable commands with the Agent v1 field names', () => {
        const envelope = commandEnvelope({
            uuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            kind: 'inventory',
            idempotencyKey: 'inventory:10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            deadlineAt: new Date('2026-08-16T00:02:00.000Z'),
            payload: {},
        });

        expect(envelope.type).toBe('command');
        expect(envelope.payload).toEqual({
            id: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            kind: 'inventory',
            idempotencyKey: 'inventory:10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            deadline: '2026-08-16T00:02:00.000Z',
            payload: {},
        });
    });
});
