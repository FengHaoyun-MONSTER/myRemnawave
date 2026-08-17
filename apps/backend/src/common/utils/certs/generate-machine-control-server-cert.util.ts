import { Crypto } from '@peculiar/webcrypto';
import {
    BasicConstraintsExtension,
    cryptoProvider,
    ExtendedKeyUsageExtension,
    KeyUsageFlags,
    KeyUsagesExtension,
    SubjectAlternativeNameExtension,
    X509Certificate,
    X509CertificateGenerator,
} from '@peculiar/x509';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export interface MachineControlServerCertificate {
    certificatePem: string;
    privateKeyPem: string;
    expiresAt: Date;
}

export async function generateMachineControlServerCertificate(
    hostname: string,
    caCertPem: string,
    caKeyPem: string,
    now: Date = new Date(),
): Promise<MachineControlServerCertificate> {
    if (!hostname || hostname.length > 253) {
        throw new Error('Machine control hostname is invalid');
    }

    const crypto = new Crypto();
    cryptoProvider.set(crypto);
    const caCert = new X509Certificate(caCertPem);
    const caPrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(caKeyPem),
        { name: 'ECDSA', namedCurve: 'P-256', hash: { name: 'SHA-256' } },
        false,
        ['sign'],
    );
    const keys = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256', hash: { name: 'SHA-256' } },
        true,
        ['sign', 'verify'],
    );
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
    const certificate = await X509CertificateGenerator.create({
        serialNumber: randomBytes(16).toString('hex'),
        subject: `CN=${hostname}`,
        issuer: caCert.subjectName,
        notBefore: new Date(now.getTime() - 5 * 60 * 1_000),
        notAfter: expiresAt,
        publicKey: keys.publicKey,
        signingKey: caPrivateKey,
        extensions: [
            new BasicConstraintsExtension(false, undefined, true),
            new KeyUsagesExtension(
                KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
                true,
            ),
            new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1'], true),
            new SubjectAlternativeNameExtension(
                [{ type: isIP(hostname) ? 'ip' : 'dns', value: hostname }],
                false,
            ),
        ],
    });

    return {
        certificatePem: certificate.toString('pem'),
        privateKeyPem: arrayBufferToPem(
            new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
            'PRIVATE KEY',
        ),
        expiresAt,
    };
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const buffer = Buffer.from(
        pem
            .replace(/-----BEGIN .* KEY-----/, '')
            .replace(/-----END .* KEY-----/, '')
            .replace(/\s+/g, ''),
        'base64',
    );
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
}

function arrayBufferToPem(buffer: Uint8Array, label: string): string {
    const base64 = Buffer.from(buffer).toString('base64');
    return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join('\n') ?? base64}\n-----END ${label}-----`;
}
