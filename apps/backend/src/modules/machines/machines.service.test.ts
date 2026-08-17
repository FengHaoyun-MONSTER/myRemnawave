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

const TOKEN = 'mrw_enroll_1234567890123456789012345678901234567890';
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

function createService(controlReady: boolean) {
    const repository = {
        create: vi.fn(),
        findByEnrollmentCredentialHash: vi.fn(),
        getCertificateAuthority: vi.fn(),
        consumeEnrollmentToken: vi.fn(),
    };
    const config = {
        get: vi.fn((name: string) =>
            name === 'MACHINE_CONTROL_PUBLIC_URL'
                ? 'wss://panel.example.test:3010/api/machine-control'
                : undefined,
        ),
    };
    const gateway = { isReady: vi.fn(() => controlReady) };
    return {
        repository,
        service: new MachinesService(
            repository as unknown as MachinesRepository,
            config as unknown as TypedConfigService,
            gateway as unknown as MachineControlGateway,
            {} as KeygenService,
            {} as NodesQueuesService,
        ),
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
