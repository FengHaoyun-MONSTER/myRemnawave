import 'reflect-metadata';
import { Crypto } from '@peculiar/webcrypto';
import {
    cryptoProvider,
    ExtendedKeyUsageExtension,
    SubjectAlternativeNameExtension,
    X509Certificate,
} from '@peculiar/x509';
import { describe, expect, it } from 'vitest';

import { generateMasterCerts } from './generate-certs.util';
import { generateMachineControlServerCertificate } from './generate-machine-control-server-cert.util';

describe('generateMachineControlServerCertificate', () => {
    it.each([
        ['panel.example.test', 'dns'],
        ['203.0.113.10', 'ip'],
    ])('signs a server certificate for %s', async (hostname, nameType) => {
        const crypto = new Crypto();
        cryptoProvider.set(crypto);
        const ca = await generateMasterCerts();

        const result = await generateMachineControlServerCertificate(
            hostname,
            ca.caCertPem,
            ca.caKeyPem,
            new Date('2026-08-17T00:00:00.000Z'),
        );

        const certificate = new X509Certificate(result.certificatePem);
        const caCertificate = new X509Certificate(ca.caCertPem);
        expect(await certificate.verify({ publicKey: caCertificate }, crypto)).toBe(true);
        expect(certificate.getExtension(ExtendedKeyUsageExtension)?.usages).toContain(
            '1.3.6.1.5.5.7.3.1',
        );
        expect(certificate.getExtension(SubjectAlternativeNameExtension)?.names.toJSON()).toEqual([
            { type: nameType, value: hostname },
        ]);
        expect(result.expiresAt.toISOString()).toBe('2027-08-17T00:00:00.000Z');
        expect(result.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    });
});
