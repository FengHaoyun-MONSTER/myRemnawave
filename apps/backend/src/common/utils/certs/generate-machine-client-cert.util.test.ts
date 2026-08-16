import 'reflect-metadata';
import { Crypto } from '@peculiar/webcrypto';
import {
    cryptoProvider,
    ExtendedKeyUsageExtension,
    Pkcs10CertificateRequestGenerator,
    X509Certificate,
} from '@peculiar/x509';
import { describe, expect, it } from 'vitest';

import { generateMasterCerts } from './generate-certs.util';
import { generateMachineClientCertificate } from './generate-machine-client-cert.util';

const MACHINE_UUID = '10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc';

describe('generateMachineClientCertificate', () => {
    it('signs a valid P-256 CSR without receiving the private key', async () => {
        const crypto = new Crypto();
        cryptoProvider.set(crypto);
        const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
            'sign',
            'verify',
        ]);
        const csr = await Pkcs10CertificateRequestGenerator.create(
            {
                name: 'CN=ignored-agent-subject',
                keys,
                signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
            },
            crypto,
        );
        const ca = await generateMasterCerts();

        const result = await generateMachineClientCertificate(
            csr.toString('pem'),
            MACHINE_UUID,
            ca.caCertPem,
            ca.caKeyPem,
            new Date('2026-08-16T00:00:00.000Z'),
        );

        const certificate = new X509Certificate(result.certificatePem);
        const caCertificate = new X509Certificate(ca.caCertPem);
        expect(certificate.subject).toBe(`CN=${MACHINE_UUID}`);
        expect(await certificate.verify({ publicKey: caCertificate }, crypto)).toBe(true);
        expect(certificate.publicKey.toString('base64')).toBe(csr.publicKey.toString('base64'));
        expect(certificate.getExtension(ExtendedKeyUsageExtension)?.usages).toContain(
            '1.3.6.1.5.5.7.3.2',
        );
        expect(result.expiresAt.toISOString()).toBe('2026-11-14T00:00:00.000Z');
        expect(result.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects unsupported CSR key curves', async () => {
        const crypto = new Crypto();
        cryptoProvider.set(crypto);
        const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, [
            'sign',
            'verify',
        ]);
        const csr = await Pkcs10CertificateRequestGenerator.create(
            {
                name: 'CN=unsupported-agent',
                keys,
                signingAlgorithm: { name: 'ECDSA', hash: 'SHA-384' },
            },
            crypto,
        );
        const ca = await generateMasterCerts();

        await expect(
            generateMachineClientCertificate(
                csr.toString('pem'),
                MACHINE_UUID,
                ca.caCertPem,
                ca.caKeyPem,
            ),
        ).rejects.toThrow('CSR public key must be ECDSA P-256');
    });
});
