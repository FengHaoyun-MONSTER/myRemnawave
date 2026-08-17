import 'reflect-metadata';
import { get } from 'node:https';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TypedConfigService } from '@common/config/app-config';
import { generateMasterCerts } from '@common/utils/certs/generate-certs.util';

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
