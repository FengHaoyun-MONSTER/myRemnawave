import 'reflect-metadata';
import { get } from 'node:https';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { TypedConfigService } from '@common/config/app-config';
import { generateMasterCerts } from '@common/utils/certs/generate-certs.util';

import { NodesQueuesService } from '@queue/_nodes';

import { MachineControlGateway } from './machine-control.gateway';
import { MachinesRepository } from './repositories/machines.repository';

describe('MachineControlGateway TLS boundary', () => {
    let gateway: MachineControlGateway | undefined;

    afterEach(async () => {
        await gateway?.onApplicationShutdown();
    });

    it('auto-generates its server certificate and rejects clients without mTLS', async () => {
        const ca = await generateMasterCerts();
        const config = {
            get: vi.fn((name: string) => {
                if (name === 'MACHINE_CONTROL_PUBLIC_URL') {
                    return 'wss://127.0.0.1:3010/api/machine-control';
                }
                return undefined;
            }),
            getOrThrow: vi.fn(() => 0),
        };
        const repository = {
            getCertificateAuthority: vi.fn(async () => ({
                caCert: ca.caCertPem,
                caKey: ca.caKeyPem,
            })),
        };
        gateway = new MachineControlGateway(
            config as unknown as TypedConfigService,
            repository as unknown as MachinesRepository,
            {} as NodesQueuesService,
        );

        expect(gateway.isReady()).toBe(false);
        await gateway.onApplicationBootstrap();
        expect(gateway.isReady()).toBe(true);
        const port = (gateway as unknown as { server: { address(): AddressInfo } }).server.address()
            .port;

        await expect(
            new Promise<void>((resolve, reject) => {
                const request = get(
                    {
                        host: '127.0.0.1',
                        port,
                        path: '/api/machine-control',
                        rejectUnauthorized: false,
                        minVersion: 'TLSv1.3',
                    },
                    (response) => {
                        response.resume();
                        resolve();
                    },
                );
                request.on('error', reject);
            }),
        ).rejects.toThrow();
    });
});

describe('MachineControlGateway command diagnostics', () => {
    it('forces WARP relay recovery when an Agent reconnects', async () => {
        const ensureWarpCommand = vi.fn().mockResolvedValue(undefined);
        const repository = {
            markAgentConnected: vi.fn().mockResolvedValue(true),
            resetRunningCommands: vi.fn().mockResolvedValue(undefined),
            ensureInventoryCommand: vi.fn().mockResolvedValue(undefined),
            ensureWarpCommand,
            getReadyCommands: vi.fn().mockResolvedValue([]),
        };
        const gateway = new MachineControlGateway(
            {} as TypedConfigService,
            repository as unknown as MachinesRepository,
            {} as NodesQueuesService,
        );
        const machineUuid = '123e4567-e89b-42d3-a456-426614174000';
        const state = { machineUuid, helloReceived: false };
        const message = JSON.stringify({
            version: 1,
            id: 'hello-machine',
            type: 'hello',
            sentAt: '2026-08-18T00:00:00.000Z',
            payload: {
                machineId: machineUuid,
                agentVersion: 'v0.2.0',
                capabilities: ['reconcile_warp'],
            },
        });
        const webSocket = { readyState: WebSocket.OPEN, send: vi.fn() };

        await (
            gateway as unknown as {
                handleMessage(
                    socket: typeof webSocket,
                    connectionState: typeof state,
                    data: Buffer,
                    isBinary: boolean,
                ): Promise<void>;
            }
        ).handleMessage(webSocket, state, Buffer.from(message), false);

        expect(state.helloReceived).toBe(true);
        expect(ensureWarpCommand).toHaveBeenCalledWith(machineUuid, expect.any(Date), true);
    });

    it('queues managed configuration only after instance reconciliation reports its final port', async () => {
        const repository = {
            getActiveCommandKind: vi.fn().mockResolvedValue('reconcile_instance'),
            completeCommand: vi.fn().mockResolvedValue(true),
            getReadyCommands: vi.fn().mockResolvedValue([]),
        };
        const startNode = vi.fn().mockResolvedValue(undefined);
        const gateway = new MachineControlGateway(
            {} as TypedConfigService,
            repository as unknown as MachinesRepository,
            { startNode } as unknown as NodesQueuesService,
        );
        const message = JSON.stringify({
            version: 1,
            id: 'result-1',
            type: 'command_result',
            sentAt: '2026-08-18T00:00:00.000Z',
            payload: {
                commandId: '123e4567-e89b-42d3-a456-426614174002',
                idempotencyKey: 'reconcile_instance:test',
                status: 'succeeded',
                payload: {
                    instanceId: '123e4567-e89b-42d3-a456-426614174001',
                    containerName: 'myremnawave-123e4567e89b42d3',
                    configHash: 'a'.repeat(64),
                    externalPort: 2053,
                },
                completedAt: '2026-08-18T00:00:00.000Z',
            },
        });
        const webSocket = { readyState: WebSocket.OPEN, send: vi.fn() };

        await (
            gateway as unknown as {
                handleMessage(
                    socket: typeof webSocket,
                    state: { machineUuid: string; helloReceived: boolean },
                    data: Buffer,
                    isBinary: boolean,
                ): Promise<void>;
            }
        ).handleMessage(
            webSocket,
            {
                machineUuid: '123e4567-e89b-42d3-a456-426614174000',
                helloReceived: true,
            },
            Buffer.from(message),
            false,
        );

        expect(startNode).toHaveBeenCalledWith({
            nodeUuid: '123e4567-e89b-42d3-a456-426614174001',
            force: true,
            managedConfigUpdate: true,
        });
    });

    it('passes a redacted, bounded Agent error message to command completion', async () => {
        const completeCommand = vi.fn().mockResolvedValue(true);
        const repository = {
            getActiveCommandKind: vi.fn().mockResolvedValue('reconcile_instance'),
            completeCommand,
            getReadyCommands: vi.fn().mockResolvedValue([]),
        };
        const gateway = new MachineControlGateway(
            {} as TypedConfigService,
            repository as unknown as MachinesRepository,
            {} as NodesQueuesService,
        );
        const message = JSON.stringify({
            version: 1,
            id: 'result-1',
            type: 'command_result',
            sentAt: '2026-08-18T00:00:00.000Z',
            payload: {
                commandId: '123e4567-e89b-42d3-a456-426614174002',
                idempotencyKey: 'reconcile_instance:test',
                status: 'failed',
                errorCode: 'CONTAINER_RUN_FAILED',
                message: 'docker failed with token=mrw_enroll_sensitive-value',
                completedAt: '2026-08-18T00:00:00.000Z',
            },
        });
        const webSocket = { readyState: WebSocket.OPEN, send: vi.fn() };

        await (
            gateway as unknown as {
                handleMessage(
                    socket: typeof webSocket,
                    state: { machineUuid: string; helloReceived: boolean },
                    data: Buffer,
                    isBinary: boolean,
                ): Promise<void>;
            }
        ).handleMessage(
            webSocket,
            {
                machineUuid: '123e4567-e89b-42d3-a456-426614174000',
                helloReceived: true,
            },
            Buffer.from(message),
            false,
        );

        expect(completeCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                errorMessage: 'docker failed with token=[REDACTED]',
            }),
        );
    });

    it('redacts diagnostics nested inside a successful discovery result', async () => {
        const completeCommand = vi.fn().mockResolvedValue(true);
        const repository = {
            getActiveCommandKind: vi.fn().mockResolvedValue('discover_host'),
            completeCommand,
            getReadyCommands: vi.fn().mockResolvedValue([]),
        };
        const gateway = new MachineControlGateway(
            {} as TypedConfigService,
            repository as unknown as MachinesRepository,
            {} as NodesQueuesService,
        );
        const planId = '123e4567-e89b-42d3-a456-426614174005';
        const message = JSON.stringify({
            version: 1,
            id: 'result-discovery',
            type: 'command_result',
            sentAt: '2026-08-18T00:00:00.000Z',
            payload: {
                commandId: '123e4567-e89b-42d3-a456-426614174002',
                idempotencyKey: 'discover_host:test',
                status: 'succeeded',
                payload: {
                    planId,
                    system: {},
                    machineChecks: [
                        {
                            code: 'DOCKER_READY',
                            ok: true,
                            message: 'docker token=mrw_enroll_sensitive-value',
                        },
                    ],
                    dependencies: [
                        {
                            name: 'docker',
                            state: 'READY_EXTERNAL',
                            action: 'REUSE',
                            ownership: 'EXTERNAL',
                            required: true,
                            message: 'secret=hidden-value',
                        },
                    ],
                    protocols: [
                        {
                            protocol: 'VLESS_REALITY',
                            network: 'tcp',
                            status: 'READY',
                            selectedPort: 443,
                            checks: [],
                            portAttempts: [
                                {
                                    port: 443,
                                    available: true,
                                    message: 'bearer private-token',
                                },
                            ],
                        },
                    ],
                    machineReady: true,
                    ready: true,
                },
                completedAt: '2026-08-18T00:00:00.000Z',
            },
        });
        const webSocket = { readyState: WebSocket.OPEN, send: vi.fn() };

        await (
            gateway as unknown as {
                handleMessage(
                    socket: typeof webSocket,
                    state: { machineUuid: string; helloReceived: boolean },
                    data: Buffer,
                    isBinary: boolean,
                ): Promise<void>;
            }
        ).handleMessage(
            webSocket,
            {
                machineUuid: '123e4567-e89b-42d3-a456-426614174000',
                helloReceived: true,
            },
            Buffer.from(message),
            false,
        );

        expect(completeCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                result: expect.objectContaining({
                    machineChecks: [
                        expect.objectContaining({ message: 'docker token=[REDACTED]' }),
                    ],
                    dependencies: [expect.objectContaining({ message: 'secret=[REDACTED]' })],
                    protocols: [
                        expect.objectContaining({
                            portAttempts: [
                                expect.objectContaining({ message: 'bearer [REDACTED]' }),
                            ],
                        }),
                    ],
                }),
            }),
        );
    });
});
