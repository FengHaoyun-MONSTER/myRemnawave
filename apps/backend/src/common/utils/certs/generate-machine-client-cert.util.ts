import { Crypto } from '@peculiar/webcrypto';
import {
    BasicConstraintsExtension,
    cryptoProvider,
    ExtendedKeyUsageExtension,
    KeyUsageFlags,
    KeyUsagesExtension,
    Pkcs10CertificateRequest,
    X509Certificate,
    X509CertificateGenerator,
} from '@peculiar/x509';
import { createHash, randomBytes } from 'node:crypto';

export interface MachineClientCertificate {
    certificatePem: string;
    serialNumber: string;
    fingerprintSha256: string;
    expiresAt: Date;
}

export async function generateMachineClientCertificate(
    csrPem: string,
    machineUuid: string,
    caCertPem: string,
    caKeyPem: string,
    now: Date = new Date(),
): Promise<MachineClientCertificate> {
    const crypto = new Crypto();
    cryptoProvider.set(crypto);

    const csr = new Pkcs10CertificateRequest(csrPem);
    if (!(await csr.verify(crypto))) {
        throw new Error('CSR signature is invalid');
    }

    const algorithm = csr.publicKey.algorithm as EcKeyAlgorithm;
    if (algorithm.name !== 'ECDSA' || algorithm.namedCurve !== 'P-256') {
        throw new Error('CSR public key must be ECDSA P-256');
    }

    const caCert = new X509Certificate(caCertPem);
    const caPrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(caKeyPem),
        {
            name: 'ECDSA',
            namedCurve: 'P-256',
            hash: { name: 'SHA-256' },
        },
        false,
        ['sign'],
    );

    const notBefore = new Date(now.getTime() - 5 * 60 * 1_000);
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000);
    const serialNumber = randomBytes(16).toString('hex');
    const certificate = await X509CertificateGenerator.create({
        serialNumber,
        subject: `CN=${machineUuid}`,
        issuer: caCert.subjectName,
        notBefore,
        notAfter: expiresAt,
        publicKey: csr.publicKey,
        signingKey: caPrivateKey,
        extensions: [
            new BasicConstraintsExtension(false, undefined, true),
            new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
            new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.2'], true),
        ],
    });
    const fingerprintSha256 = createHash('sha256')
        .update(Buffer.from(certificate.rawData))
        .digest('hex');

    return {
        certificatePem: certificate.toString('pem'),
        serialNumber,
        fingerprintSha256,
        expiresAt,
    };
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN .* KEY-----/, '')
        .replace(/-----END .* KEY-----/, '')
        .replace(/\s+/g, '');
    const buffer = Buffer.from(base64, 'base64');
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
}
