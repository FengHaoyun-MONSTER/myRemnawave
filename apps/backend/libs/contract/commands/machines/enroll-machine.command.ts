import { z } from 'zod';

import { MACHINE_ENROLLMENT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace EnrollMachineCommand {
    export const url = REST_API.MACHINE_ENROLLMENT.ENROLL;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        MACHINE_ENROLLMENT_ROUTES.ENROLL,
        'post',
        'Exchange a one-time enrollment token and CSR for an mTLS client certificate',
        { scope: 'create', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        enrollmentToken: z.string().min(40).max(256),
        csrPem: z
            .string()
            .min(100)
            .max(16_384)
            .refine(
                (value) =>
                    value.startsWith('-----BEGIN CERTIFICATE REQUEST-----') &&
                    value.includes('-----END CERTIFICATE REQUEST-----'),
                'csrPem must be a PEM encoded PKCS#10 certificate request',
            ),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            machineUuid: z.uuid(),
            clientCertPem: z.string(),
            caCertPem: z.string(),
            controlUrl: z.url().startsWith('wss://'),
            expiresAt: z.date(),
        }),
    });
}
