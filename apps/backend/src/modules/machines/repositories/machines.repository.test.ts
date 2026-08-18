import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '@common/database/prisma.service';

import { MachinesRepository } from './machines.repository';

const MACHINE_UUID = '123e4567-e89b-42d3-a456-426614174000';
const NODE_UUID = '123e4567-e89b-42d3-a456-426614174001';
const COMMAND_UUID = '123e4567-e89b-42d3-a456-426614174002';
const ADMIN_UUID = '123e4567-e89b-42d3-a456-426614174003';

describe('MachinesRepository durable planning', () => {
    it('reuses the unexpired plan for the same normalized request without queuing a duplicate discovery', async () => {
        const reusable = {
            uuid: NODE_UUID,
            machineUuid: MACHINE_UUID,
            status: 'PENDING',
            commandUuid: COMMAND_UUID,
            expiresAt: new Date('2026-08-18T00:10:00.000Z'),
        };
        const transaction = {
            machines: {
                findUnique: vi.fn().mockResolvedValue({
                    uuid: MACHINE_UUID,
                    archivedAt: null,
                    clientCertFingerprint: 'a'.repeat(64),
                    agentLastSeenAt: new Date('2026-08-18T00:00:30.000Z'),
                    agentCapabilities: ['discover_host'],
                    nodes: [],
                    tags: [],
                }),
            },
            machineProvisioningPlans: {
                findFirst: vi.fn().mockResolvedValue(reusable),
                create: vi.fn(),
                updateMany: vi.fn(),
            },
            machineCommands: { create: vi.fn(), updateMany: vi.fn() },
        };
        const repository = repositoryWithTransaction(transaction);

        const result = await repository.createProvisioningPlan({
            machineUuid: MACHINE_UUID,
            request: {
                protocols: [
                    {
                        protocol: 'VLESS_REALITY',
                        externalPort: 443,
                        fallbackPorts: [8443],
                        serverName: 'www.microsoft.com',
                        target: 'www.microsoft.com:443',
                    },
                ],
                enableWarp: false,
            },
            now: new Date('2026-08-18T00:01:00.000Z'),
        });

        expect(result.plan).toBe(reusable);
        expect(result.commandUuid).toBe(COMMAND_UUID);
        expect(transaction.machineProvisioningPlans.create).not.toHaveBeenCalled();
        expect(transaction.machineCommands.create).not.toHaveBeenCalled();
    });
});

describe('MachinesRepository command completion', () => {
    it('turns a successful partial discovery into an applicable plan without mutating protocols', async () => {
        const planUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const machineUpdate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'discover_host',
                    payload: { planId: NODE_UUID, mode: 'PLAN' },
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            machineProvisioningPlans: { updateMany: planUpdate },
            machines: { update: machineUpdate },
        };
        const repository = repositoryWithTransaction(transaction);
        const discovery = {
            planId: NODE_UUID,
            system: { osId: 'debian' },
            machineChecks: [],
            dependencies: [
                {
                    name: 'warp',
                    required: true,
                    state: 'READY',
                    ownership: 'EXTERNAL',
                },
            ],
            protocols: [
                {
                    protocol: 'VLESS_REALITY',
                    network: 'tcp',
                    status: 'BLOCKED',
                    selectedPort: null,
                    checks: [],
                    portAttempts: [],
                },
                {
                    protocol: 'HYSTERIA2',
                    network: 'udp',
                    status: 'READY',
                    selectedPort: 443,
                    checks: [],
                    portAttempts: [{ port: 443, available: true, message: 'available' }],
                },
            ],
            machineReady: true,
            ready: true,
        };

        await repository.completeCommand({
            machineUuid: MACHINE_UUID,
            commandUuid: COMMAND_UUID,
            idempotencyKey: `discover_host:${COMMAND_UUID}`,
            status: 'succeeded',
            result: discovery,
            completedAt: new Date('2026-08-18T00:00:00.000Z'),
        });

        expect(planUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ uuid: NODE_UUID, status: 'PENDING' }),
                data: expect.objectContaining({ status: 'READY', result: discovery }),
            }),
        );
        expect(machineUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'CONNECTED',
                    warpOwnership: 'EXTERNAL',
                }),
            }),
        );
    });

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

    it('settles as degraded when a retried node fails beside a healthy published sibling', async () => {
        const machineUpdate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'reconcile_instance',
                    payload: { instanceId: NODE_UUID },
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            nodes: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
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
            errorMessage: 'bind failed',
            completedAt: new Date('2026-08-18T00:00:00.000Z'),
        });

        expect(machineUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ data: { status: 'DEGRADED' } }),
        );
    });

    it('expires a blocked plan after an audited WARP takeover succeeds', async () => {
        const planUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const machineUpdate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineCommands: {
                findFirst: vi.fn().mockResolvedValue({
                    kind: 'authorize_warp_takeover',
                    payload: { planId: NODE_UUID },
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            machineProvisioningPlans: { updateMany: planUpdate },
            machines: { update: machineUpdate },
        };
        const repository = repositoryWithTransaction(transaction);

        await repository.completeCommand({
            machineUuid: MACHINE_UUID,
            commandUuid: COMMAND_UUID,
            idempotencyKey: `authorize_warp_takeover:${COMMAND_UUID}`,
            status: 'succeeded',
            result: {
                planId: NODE_UUID,
                ownership: 'ADOPTED',
                message: 'ownership recorded',
            },
            completedAt: new Date('2026-08-18T00:00:00.000Z'),
        });

        expect(planUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    uuid: NODE_UUID,
                    commandUuid: COMMAND_UUID,
                    status: 'PENDING',
                }),
                data: expect.objectContaining({
                    status: 'EXPIRED',
                    errorCode: 'WARP_TAKEOVER_APPROVED_REPLAN_REQUIRED',
                }),
            }),
        );
        expect(machineUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    warpOwnership: 'ADOPTED',
                }),
            }),
        );
    });
});

describe('MachinesRepository WARP takeover authorization', () => {
    it('queues only a confirmed takeover for an unexpired blocked external-WARP plan', async () => {
        const commandCreate = vi.fn().mockResolvedValue({});
        const planUpdate = vi.fn().mockResolvedValue({ count: 1 });
        const transaction = {
            machineProvisioningPlans: {
                findFirst: vi.fn().mockResolvedValue({
                    uuid: NODE_UUID,
                    machineUuid: MACHINE_UUID,
                    status: 'BLOCKED',
                    result: {
                        dependencies: [
                            {
                                name: 'warp',
                                state: 'TAKEOVER_REQUIRED',
                                ownership: 'EXTERNAL',
                            },
                        ],
                    },
                    expiresAt: new Date('2026-08-18T00:10:00.000Z'),
                    commandUuid: COMMAND_UUID,
                    errorCode: 'RESOURCE_PLAN_BLOCKED',
                }),
                updateMany: planUpdate,
            },
            machineCommands: {
                create: commandCreate,
                findFirst: vi.fn(),
            },
            machines: {
                findUnique: vi.fn().mockResolvedValue({
                    archivedAt: null,
                    agentLastSeenAt: new Date('2026-08-18T00:00:00.000Z'),
                    agentCapabilities: ['authorize_warp_takeover'],
                    clientCertFingerprint: 'a'.repeat(64),
                }),
            },
        };
        const repository = repositoryWithTransaction(transaction);

        const result = await repository.authorizeWarpTakeover({
            machineUuid: MACHINE_UUID,
            planUuid: NODE_UUID,
            confirmation: 'TAKE_OVER_EXTERNAL_WARP',
            requestedBy: ADMIN_UUID,
            now: new Date('2026-08-18T00:01:00.000Z'),
        });

        expect(result.commandUuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(commandCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'authorize_warp_takeover',
                    requestedBy: ADMIN_UUID,
                    payload: {
                        planId: NODE_UUID,
                        decision: 'TAKE_OVER_EXTERNAL_WARP',
                        attestNo3xuiUse: true,
                    },
                }),
            }),
        );
        expect(planUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'PENDING',
                    errorCode: 'WARP_TAKEOVER_PENDING',
                }),
            }),
        );
    });
});

describe('MachinesRepository retry safety', () => {
    it('rejects retrying a healthy published node through the API', async () => {
        const transaction = retryTransaction({ lifecycleState: 'PUBLISHED', isPublished: true });
        const repository = repositoryWithTransaction(transaction);

        await expect(
            repository.retry({
                machineUuid: MACHINE_UUID,
                nodeUuids: [NODE_UUID],
                nodeSecrets: { VLESS_REALITY: 'A'.repeat(120) },
                now: new Date('2026-08-18T00:01:00.000Z'),
            }),
        ).rejects.toMatchObject({ reason: 'RETRY_NODE_NOT_RETRYABLE' });
        expect(transaction.machineCommands.create).not.toHaveBeenCalled();
    });

    it('never allocates a fallback port while retrying a published failed node', async () => {
        const transaction = retryTransaction({ lifecycleState: 'FAILED', isPublished: true });
        const repository = repositoryWithTransaction(transaction);

        await repository.retry({
            machineUuid: MACHINE_UUID,
            nodeUuids: [NODE_UUID],
            nodeSecrets: { VLESS_REALITY: 'A'.repeat(120) },
            now: new Date('2026-08-18T00:01:00.000Z'),
        });

        expect(transaction.machineCommands.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'reconcile_instance',
                    payload: expect.objectContaining({
                        instanceId: NODE_UUID,
                        externalPort: 443,
                        fallbackPorts: [],
                    }),
                }),
            }),
        );
    });

    it('reuses the stored Machine-specific fallback pool for an unpublished retry', async () => {
        const transaction = retryTransaction({ lifecycleState: 'FAILED', isPublished: false });
        const repository = repositoryWithTransaction(transaction);

        await repository.retry({
            machineUuid: MACHINE_UUID,
            nodeUuids: [NODE_UUID],
            nodeSecrets: { VLESS_REALITY: 'A'.repeat(120) },
            now: new Date('2026-08-18T00:01:00.000Z'),
        });

        expect(transaction.machineCommands.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'reconcile_instance',
                    payload: expect.objectContaining({
                        externalPort: 443,
                        fallbackPorts: [9443],
                    }),
                }),
            }),
        );
    });
});

describe('MachinesRepository WARP reconnect recovery', () => {
    it('forces a WARP reconcile on Agent reconnect even when the last check is fresh', async () => {
        const commandCreate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineCommands: { create: commandCreate },
            machines: { update: vi.fn().mockResolvedValue({}) },
        };
        const prisma = {
            nodes: {
                findFirst: vi.fn().mockResolvedValue({
                    uuid: NODE_UUID,
                    protocolSettings: {
                        warpEnabled: true,
                        warpMode: 'REUSE_EXTERNAL',
                    },
                }),
            },
            machines: {
                findUnique: vi.fn().mockResolvedValue({
                    warpStatus: 'CONNECTED',
                    warpLastChecked: new Date('2026-08-18T00:00:30.000Z'),
                }),
            },
            machineCommands: { findFirst: vi.fn().mockResolvedValue(null) },
            $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
                callback(transaction),
            ),
        };
        const repository = new MachinesRepository(prisma as unknown as PrismaService);

        await repository.ensureWarpCommand(
            MACHINE_UUID,
            new Date('2026-08-18T00:01:00.000Z'),
            true,
        );

        expect(commandCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'reconcile_warp',
                    payload: {
                        enabled: true,
                        proxyPort: 40000,
                        mode: 'REUSE_EXTERNAL',
                    },
                }),
            }),
        );
    });

    it('does not create an automatic retry loop after WARP reconciliation fails', async () => {
        const commandCreate = vi.fn().mockResolvedValue({});
        const prisma = warpRecoveryPrisma(commandCreate, {
            warpStatus: 'FAILED',
            warpLastChecked: new Date('2026-08-18T00:00:30.000Z'),
        });
        const repository = new MachinesRepository(prisma as unknown as PrismaService);

        await repository.ensureWarpCommand(
            MACHINE_UUID,
            new Date('2026-08-18T00:10:00.000Z'),
            true,
        );

        expect(commandCreate).not.toHaveBeenCalled();
    });
});

describe('MachinesRepository provisioning command order', () => {
    it('queues the read-only Machine preflight before dependency or protocol mutations', async () => {
        const commandCreate = vi.fn().mockResolvedValue({});
        const transaction = {
            machineProvisioningPlans: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            machines: {
                findUnique: vi.fn().mockResolvedValue({
                    uuid: MACHINE_UUID,
                    name: 'test-machine',
                    address: '203.0.113.10',
                    countryCode: 'US',
                    tags: [],
                    archivedAt: null,
                    clientCertFingerprint: 'a'.repeat(64),
                    agentLastSeenAt: new Date('2026-08-18T00:00:30.000Z'),
                    agentCapabilities: [
                        'preflight',
                        'reconcile_dependency',
                        'reconcile_instance',
                        'apply_config',
                    ],
                    nodes: [],
                }),
                update: vi.fn().mockResolvedValue({
                    uuid: MACHINE_UUID,
                    name: 'test-machine',
                    address: '203.0.113.10',
                    countryCode: 'US',
                    tags: [],
                    status: 'PROVISIONING',
                }),
            },
            configProfiles: {
                findUnique: vi.fn().mockImplementation((query) => {
                    const identity = query.where.templateKey_templateVersion;
                    return {
                        uuid: `profile-${identity.templateKey}`,
                        templateKey: identity.templateKey,
                        templateVersion: identity.templateVersion,
                        isSystem: true,
                        isImmutable: true,
                        configProfileInbounds: [{ uuid: `inbound-${identity.templateKey}` }],
                    };
                }),
                create: vi.fn(),
            },
            machineCommands: { create: commandCreate },
            nodes: { create: vi.fn().mockResolvedValue({ uuid: NODE_UUID }) },
            hosts: { create: vi.fn().mockResolvedValue({}) },
        };
        const repository = repositoryWithTransaction(transaction);

        await repository.provision({
            machineUuid: MACHINE_UUID,
            planUuid: COMMAND_UUID,
            protocols: [
                {
                    protocol: 'VLESS_REALITY',
                    externalPort: 443,
                    fallbackPorts: [8443],
                    serverName: 'www.microsoft.com',
                    target: 'www.microsoft.com:443',
                },
            ],
            enableWarp: false,
            warpMode: null,
            dependencyActions: [{ name: 'docker', action: 'INSTALL_IF_MISSING' }],
            nodeSecrets: { VLESS_REALITY: 'A'.repeat(120) },
            now: new Date('2026-08-18T00:01:00.000Z'),
        });

        expect(commandCreate.mock.calls.map(([call]) => call.data.kind)).toEqual([
            'preflight',
            'reconcile_dependency',
            'preflight',
            'reconcile_instance',
        ]);
        expect(commandCreate.mock.calls[0][0].data.payload).toEqual({
            ports: [],
            requireDocker: false,
        });
    });
});

function repositoryWithTransaction(transaction: object): MachinesRepository {
    const prisma = {
        $transaction: async (callback: (value: object) => unknown) => callback(transaction),
    } as unknown as PrismaService;
    return new MachinesRepository(prisma);
}

function retryTransaction(overrides: { lifecycleState: string; isPublished: boolean }) {
    const node = {
        uuid: NODE_UUID,
        protocolKey: 'VLESS_REALITY',
        port: 2222,
        externalPort: 443,
        externalNetwork: 'tcp',
        protocolSettings: {
            serverName: 'www.microsoft.com',
            target: 'www.microsoft.com:443',
            warpEnabled: false,
            fallbackPorts: [9443],
        },
        certificateMode: null,
        certificateStatus: 'NOT_REQUIRED',
        certificateExpiresAt: null,
        ...overrides,
    };
    return {
        machines: {
            findUnique: vi.fn().mockResolvedValue({
                uuid: MACHINE_UUID,
                name: 'test-machine',
                address: '203.0.113.10',
                archivedAt: null,
                agentLastSeenAt: new Date('2026-08-18T00:01:00.000Z'),
                agentCapabilities: ['preflight', 'reconcile_instance', 'apply_config'],
                warpStatus: 'DISABLED',
                nodes: [node],
            }),
            update: vi.fn().mockResolvedValue({
                uuid: MACHINE_UUID,
                status: 'PROVISIONING',
                tags: [],
            }),
        },
        machineCommands: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
        },
        nodes: { update: vi.fn().mockResolvedValue({}) },
    };
}

function warpRecoveryPrisma(
    commandCreate: ReturnType<typeof vi.fn>,
    machine: { warpStatus: string; warpLastChecked: Date | null },
) {
    const transaction = {
        machineCommands: { create: commandCreate },
        machines: { update: vi.fn().mockResolvedValue({}) },
    };
    return {
        nodes: {
            findFirst: vi.fn().mockResolvedValue({
                uuid: NODE_UUID,
                protocolSettings: {
                    warpEnabled: true,
                    warpMode: 'REUSE_EXTERNAL',
                },
            }),
        },
        machines: { findUnique: vi.fn().mockResolvedValue(machine) },
        machineCommands: { findFirst: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
            callback(transaction),
        ),
    };
}
