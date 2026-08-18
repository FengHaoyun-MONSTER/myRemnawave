import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '@common/database/prisma.service';

import { MachinesRepository } from './machines.repository';

const MACHINE_UUID = '123e4567-e89b-42d3-a456-426614174000';
const NODE_UUID = '123e4567-e89b-42d3-a456-426614174001';
const COMMAND_UUID = '123e4567-e89b-42d3-a456-426614174002';

describe('MachinesRepository command completion', () => {
    it('does not claim a newer desired revision when an older apply succeeds', async () => {
        const nodeUpdate = vi.fn();
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'apply_config',
                    payload: { instanceId: NODE_UUID, revision: 1 },
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            nodes: {
                findFirst: vi.fn().mockResolvedValue({
                    desiredRevision: 2,
                    isPublished: false,
                    certificateMode: null,
                    certificateStatus: 'NOT_REQUIRED',
                    certificateExpiresAt: null,
                    certificateBlockedAt: null,
                }),
                update: nodeUpdate.mockResolvedValue({}),
                count: vi.fn().mockResolvedValue(1),
            },
            hosts: { updateMany: vi.fn() },
            machines: { update: vi.fn() },
        };
        const repository = repositoryWithTransaction(transaction);

        await repository.completeCommand({
            machineUuid: MACHINE_UUID,
            commandUuid: COMMAND_UUID,
            idempotencyKey: `apply_config:${COMMAND_UUID}`,
            status: 'succeeded',
            result: { instanceId: NODE_UUID, applied: true },
            completedAt: new Date('2026-08-17T00:00:00.000Z'),
        });

        expect(nodeUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    appliedRevision: 1,
                    lifecycleState: 'PROVISIONING',
                    isConnecting: true,
                }),
            }),
        );
    });

    it('disables access and queues a stop when an authorization apply fails', async () => {
        const stopCreate = vi.fn().mockResolvedValue({});
        const hostUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'apply_config',
                    payload: {
                        instanceId: NODE_UUID,
                        revision: 2,
                        failClosedOnError: true,
                    },
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                create: stopCreate,
            },
            nodes: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                count: vi.fn().mockResolvedValue(0),
            },
            hosts: { updateMany: hostUpdate },
            machines: { update: vi.fn().mockResolvedValue({}) },
        };
        const repository = repositoryWithTransaction(transaction);

        await repository.completeCommand({
            machineUuid: MACHINE_UUID,
            commandUuid: COMMAND_UUID,
            idempotencyKey: `apply_config:${COMMAND_UUID}`,
            status: 'failed',
            errorCode: 'CONFIG_APPLY_FAILED_ROLLED_BACK',
            result: null,
            completedAt: new Date('2026-08-17T00:00:00.000Z'),
        });

        expect(hostUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: { isDisabled: true } }),
        );
        expect(stopCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'stop_instance',
                    payload: { instanceId: NODE_UUID },
                }),
            }),
        );
    });

    it('persists safe command diagnostics and propagates them to the failed node', async () => {
        const commandUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const nodeUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const machineUpdate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'reconcile_instance',
                    payload: { instanceId: NODE_UUID },
                }),
                updateMany: commandUpdate,
            },
            nodes: {
                updateMany: nodeUpdate,
                count: vi.fn().mockResolvedValue(0),
            },
            machines: { update: machineUpdate },
        };
        const repository = repositoryWithTransaction(transaction);

        await repository.completeCommand({
            machineUuid: MACHINE_UUID,
            commandUuid: COMMAND_UUID,
            idempotencyKey: `reconcile_instance:${COMMAND_UUID}`,
            status: 'failed',
            errorCode: 'CONTAINER_RUN_FAILED',
            errorMessage: 'selected TCP port is already owned by another process',
            completedAt: new Date('2026-08-18T00:00:00.000Z'),
        });

        expect(commandUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    errorMessage: 'selected TCP port is already owned by another process',
                }),
            }),
        );
        expect(nodeUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    lastErrorCode: 'CONTAINER_RUN_FAILED',
                    lastStatusMessage: 'selected TCP port is already owned by another process',
                }),
            }),
        );
        expect(machineUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    lastErrorCode: 'CONTAINER_RUN_FAILED',
                    lastStatusMessage: 'selected TCP port is already owned by another process',
                }),
            }),
        );
    });
});

function repositoryWithTransaction(transaction: object): MachinesRepository {
    const prisma = {
        $transaction: async (callback: (value: object) => unknown) => callback(transaction),
    } as unknown as PrismaService;
    return new MachinesRepository(prisma);
}
