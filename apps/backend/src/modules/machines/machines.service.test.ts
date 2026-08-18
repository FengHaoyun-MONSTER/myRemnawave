import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';

import { KeygenService } from '@modules/keygen/keygen.service';

import { NodesQueuesService } from '@queue/_nodes';

import { MachineEntity } from './entities/machine.entity';
import { MachineControlGateway } from './machine-control.gateway';
import { MachinesService } from './machines.service';

vi.mock('@common/utils/certs/generate-machine-client-cert.util', () => ({
    generateMachineClientCertificate: vi.fn(async () => ({
        certificatePem: 'client-certificate',
        serialNumber: '0123456789abcdef',
        fingerprintSha256: 'a'.repeat(64),
        expiresAt: new Date('2026-11-15T00:00:00.000Z'),
    })),
}));
import { MachinesRepository } from './repositories/machines.repository';

const TOKEN = `mrw_enroll_${'test-token-'.repeat(5)}`;
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';
const CSR = 'persisted-csr';

describe('MachinesService enrollment safety', () => {
    it('blocks draft creation while the control listener is not ready', async () => {
        const { service, repository } = createService(false);

        await expect(
            service.createMachine({
                name: 'test-machine',
                address: '203.0.113.10',
                countryCode: 'US',
                tags: [],
            }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(repository.create).not.toHaveBeenCalled();
    });

    it('issues enrollment tokens for thirty minutes when control is ready', async () => {
        const { service, repository } = createService(true);
        repository.create.mockImplementation(async (value: object) => machine(value));
        const before = Date.now();

        const result = await service.createMachine({
            name: 'test-machine',
            address: '203.0.113.10',
            countryCode: 'US',
            tags: [],
        });

        expect(result.enrollmentExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
        expect(result.enrollmentExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    });

    it('replays the same response only for the same token, attempt, and CSR', async () => {
        const { service, repository } = createService(true);
        const response = {
            machineUuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            clientCertPem: 'client-certificate',
            caCertPem: 'ca-certificate',
            controlUrl: 'wss://panel.example.test:3010/api/machine-control',
            expiresAt: '2026-11-15T00:00:00.000Z',
        };
        repository.findByEnrollmentCredentialHash.mockResolvedValue(
            machine({
                enrollmentTokenHash: null,
                enrollmentExpiresAt: null,
                enrollmentUsedAt: new Date(),
                enrollmentReplayTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
                enrollmentAttemptId: ATTEMPT_ID,
                enrollmentCsrFingerprint: createHash('sha256').update(CSR).digest('hex'),
                enrollmentResponse: response,
                enrollmentReplayExpiresAt: new Date(Date.now() + 60_000),
            }),
        );

        await expect(
            service.enroll({ enrollmentToken: TOKEN, attemptId: ATTEMPT_ID, csrPem: CSR }),
        ).resolves.toEqual({ ...response, expiresAt: new Date(response.expiresAt) });
        await expect(
            service.enroll({
                enrollmentToken: TOKEN,
                attemptId: '123e4567-e89b-42d3-a456-426614174001',
                csrPem: CSR,
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            service.enroll({
                enrollmentToken: TOKEN,
                attemptId: ATTEMPT_ID,
                csrPem: 'changed-csr',
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('converges concurrent matching requests on one committed response', async () => {
        const { service, repository } = createService(true);
        const active = machine({
            enrollmentTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
            enrollmentExpiresAt: new Date(Date.now() + 60_000),
            enrollmentUsedAt: null,
        });
        let committed: MachineEntity | null = null;
        repository.findByEnrollmentCredentialHash.mockImplementation(
            async () => committed ?? active,
        );
        repository.getCertificateAuthority.mockResolvedValue({
            caCert: 'ca-certificate',
            caKey: 'ca-private-key',
        });
        repository.consumeEnrollmentToken.mockImplementation(
            async (input: {
                now: Date;
                tokenHash: string;
                attemptId: string;
                csrFingerprint: string;
                response: object;
                replayExpiresAt: Date;
            }) => {
                if (committed) return false;
                committed = machine({
                    enrollmentTokenHash: null,
                    enrollmentUsedAt: input.now,
                    enrollmentReplayTokenHash: input.tokenHash,
                    enrollmentAttemptId: input.attemptId,
                    enrollmentCsrFingerprint: input.csrFingerprint,
                    enrollmentResponse: input.response,
                    enrollmentReplayExpiresAt: input.replayExpiresAt,
                });
                return true;
            },
        );

        const requests = await Promise.all([
            service.enroll({ enrollmentToken: TOKEN, attemptId: ATTEMPT_ID, csrPem: CSR }),
            service.enroll({ enrollmentToken: TOKEN, attemptId: ATTEMPT_ID, csrPem: CSR }),
        ]);

        expect(requests[0]).toEqual(requests[1]);
        expect(repository.consumeEnrollmentToken).toHaveBeenCalledTimes(2);
    });

    it('accepts a legacy first exchange without an attempt ID', async () => {
        const { service, repository } = createService(true);
        repository.findByEnrollmentCredentialHash.mockResolvedValue(
            machine({
                enrollmentTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
                enrollmentExpiresAt: new Date(Date.now() + 60_000),
                enrollmentUsedAt: null,
            }),
        );
        repository.getCertificateAuthority.mockResolvedValue({
            caCert: 'ca-certificate',
            caKey: 'ca-private-key',
        });
        repository.consumeEnrollmentToken.mockResolvedValue(true);

        await expect(
            service.enroll({ enrollmentToken: TOKEN, csrPem: CSR }),
        ).resolves.toMatchObject({
            machineUuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
            controlUrl: 'wss://panel.example.test:3010/api/machine-control',
        });
        expect(repository.consumeEnrollmentToken).toHaveBeenCalledWith(
            expect.objectContaining({ attemptId: expect.any(String) }),
        );
    });
});

describe('MachinesService resource planning', () => {
    it('does not generate node credentials or create nodes during read-only planning', async () => {
        const { service, repository, keygen, gateway } = createService(true);
        repository.createProvisioningPlan.mockResolvedValue({
            machine: machine({ status: 'PROVISIONING' }),
            plan: provisioningPlan({ status: 'PENDING' }),
            commandUuid: '123e4567-e89b-42d3-a456-426614174002',
        });

        const result = await service.provision('10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc', {
            protocols: [
                {
                    protocol: 'VLESS_REALITY',
                    externalPort: 443,
                    serverName: 'www.microsoft.com',
                    target: 'www.microsoft.com:443',
                },
            ],
            enableWarp: false,
        });

        expect(result.plan.status).toBe('PENDING');
        expect(repository.createProvisioningPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                request: expect.objectContaining({
                    protocols: [
                        expect.objectContaining({
                            fallbackPorts: [8443, 2053, 2083],
                        }),
                    ],
                }),
            }),
        );
        expect(keygen.generateKey).not.toHaveBeenCalled();
        expect(repository.provision).not.toHaveBeenCalled();
        expect(gateway.dispatchReady).toHaveBeenCalled();
    });

    it('applies only ready sibling protocols and preserves deterministic fallback order', async () => {
        const { service, repository, keygen } = createService(true);
        const planUuid = '123e4567-e89b-42d3-a456-426614174005';
        repository.getProvisioningPlan.mockResolvedValue(
            provisioningPlan({
                uuid: planUuid,
                status: 'READY',
                request: {
                    protocols: [
                        {
                            protocol: 'VLESS_REALITY',
                            externalPort: 443,
                            serverName: 'www.microsoft.com',
                            target: 'www.microsoft.com:443',
                        },
                        {
                            protocol: 'HYSTERIA2',
                            externalPort: 443,
                            certificate: {
                                mode: 'IMPORT_EXISTING',
                                domain: 'hy2.example.com',
                                certificatePath: '/etc/certs/fullchain.pem',
                                privateKeyPath: '/etc/certs/privkey.pem',
                            },
                        },
                    ],
                    enableWarp: true,
                },
                result: {
                    planId: planUuid,
                    system: {},
                    machineChecks: [],
                    dependencies: [
                        {
                            name: 'docker',
                            state: 'MISSING',
                            action: 'INSTALL',
                            ownership: 'ABSENT',
                            required: true,
                            message: 'install Docker',
                        },
                        {
                            name: 'warp',
                            state: 'READY_EXTERNAL',
                            action: 'REUSE_EXTERNAL',
                            ownership: 'EXTERNAL',
                            required: true,
                            message: 'reuse WARP',
                        },
                    ],
                    protocols: [
                        {
                            protocol: 'VLESS_REALITY',
                            network: 'tcp',
                            status: 'BLOCKED',
                            selectedPort: null,
                            errorCode: 'PORT_POOL_EXHAUSTED',
                            checks: [],
                            portAttempts: [],
                        },
                        {
                            protocol: 'HYSTERIA2',
                            network: 'udp',
                            status: 'READY',
                            selectedPort: 2053,
                            checks: [],
                            portAttempts: [
                                { port: 443, available: false, message: 'occupied' },
                                { port: 2053, available: true, message: 'available' },
                                { port: 2087, available: true, message: 'available' },
                            ],
                        },
                    ],
                    machineReady: true,
                    ready: true,
                },
            }),
        );
        keygen.generateKey.mockResolvedValue({
            isOk: true,
            response: { payload: 'A'.repeat(120) },
        });
        repository.provision.mockResolvedValue({
            machine: machine({ status: 'PROVISIONING' }),
            nodeUuids: ['123e4567-e89b-42d3-a456-426614174001'],
            commandUuids: ['123e4567-e89b-42d3-a456-426614174002'],
        });

        await service.applyProvisioningPlan('10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc', planUuid);

        expect(keygen.generateKey).toHaveBeenCalledTimes(1);
        expect(repository.provision).toHaveBeenCalledWith(
            expect.objectContaining({
                planUuid,
                dependencyActions: [{ name: 'docker', action: 'INSTALL_IF_MISSING' }],
                warpMode: 'REUSE_EXTERNAL',
                protocols: [
                    expect.objectContaining({
                        protocol: 'HYSTERIA2',
                        externalPort: 2053,
                        fallbackPorts: [2087],
                    }),
                ],
            }),
        );
    });

    it('does not generate credentials or apply an expired resource plan', async () => {
        const { service, repository, keygen } = createService(true);
        const planUuid = '123e4567-e89b-42d3-a456-426614174005';
        repository.getProvisioningPlan.mockResolvedValue(
            provisioningPlan({
                uuid: planUuid,
                status: 'READY',
                expiresAt: new Date('2026-08-17T23:59:59.000Z'),
            }),
        );

        await expect(
            service.applyProvisioningPlan('10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc', planUuid),
        ).rejects.toThrow('Machine provisioning plan is not ready');
        expect(keygen.generateKey).not.toHaveBeenCalled();
        expect(repository.provision).not.toHaveBeenCalled();
    });

    it('records an explicit admin WARP takeover decision against the blocked plan', async () => {
        const { service, repository, gateway } = createService(true);
        repository.authorizeWarpTakeover.mockResolvedValue({
            commandUuid: '123e4567-e89b-42d3-a456-426614174009',
        });

        await expect(
            service.authorizeWarpTakeover(
                '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
                '123e4567-e89b-42d3-a456-426614174005',
                {
                    confirmation: 'TAKE_OVER_EXTERNAL_WARP',
                    attestNo3xuiUse: true,
                },
                '123e4567-e89b-42d3-a456-426614174010',
            ),
        ).resolves.toEqual({ commandUuid: '123e4567-e89b-42d3-a456-426614174009' });
        expect(repository.authorizeWarpTakeover).toHaveBeenCalledWith(
            expect.objectContaining({
                machineUuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
                planUuid: '123e4567-e89b-42d3-a456-426614174005',
                requestedBy: '123e4567-e89b-42d3-a456-426614174010',
            }),
        );
        expect(gateway.dispatchReady).toHaveBeenCalledWith('10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc');
    });
});

function createService(controlReady: boolean) {
    const repository = {
        create: vi.fn(),
        createProvisioningPlan: vi.fn(),
        authorizeWarpTakeover: vi.fn(),
        getProvisioningPlan: vi.fn(),
        provision: vi.fn(),
        findByEnrollmentCredentialHash: vi.fn(),
        getCertificateAuthority: vi.fn(),
        consumeEnrollmentToken: vi.fn(),
    };
    const config = {
        get: vi.fn((name: string) => {
            if (name === 'MACHINE_CONTROL_PUBLIC_URL') {
                return 'wss://panel.example.test:3010/api/machine-control';
            }
            if (name === 'MACHINE_PORT_CANDIDATES') return [443, 8443, 2053, 2083];
            return undefined;
        }),
    };
    const gateway = {
        isReady: vi.fn(() => controlReady),
        dispatchReady: vi.fn().mockResolvedValue(undefined),
    };
    const keygen = { generateKey: vi.fn() };
    return {
        repository,
        gateway,
        keygen,
        service: new MachinesService(
            repository as unknown as MachinesRepository,
            config as unknown as TypedConfigService,
            gateway as unknown as MachineControlGateway,
            keygen as unknown as KeygenService,
            {} as NodesQueuesService,
        ),
    };
}

function provisioningPlan(overrides: object = {}) {
    const now = new Date();
    return {
        uuid: '123e4567-e89b-42d3-a456-426614174005',
        machineUuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
        status: 'PENDING',
        request: {},
        requestHash: 'a'.repeat(64),
        result: null,
        commandUuid: '123e4567-e89b-42d3-a456-426614174002',
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(now.getTime() + 60_000),
        appliedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function machine(overrides: object = {}): MachineEntity {
    return {
        uuid: '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc',
        name: 'test-machine',
        address: '203.0.113.10',
        status: 'DRAFT',
        countryCode: 'US',
        tags: [],
        note: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as unknown as MachineEntity;
}
