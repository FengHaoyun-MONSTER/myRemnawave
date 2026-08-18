import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineProvisioningPlanSchema, MachineSchema } from '../../models';

const DomainSchema = z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(
        /^(?=.{1,253}\.?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?(?:$)/,
        'Expected a fully-qualified domain name',
    );

const CertificateSchema = z.discriminatedUnion('mode', [
    z
        .object({
            mode: z.literal('HTTP_01'),
            domain: DomainSchema,
            email: z.email().max(254),
        })
        .strict(),
    z
        .object({
            mode: z.literal('IMPORT_EXISTING'),
            domain: DomainSchema,
            certificatePath: z.string().startsWith('/').max(4096),
            privateKeyPath: z.string().startsWith('/').max(4096),
        })
        .strict(),
]);

const FallbackPortsSchema = z
    .array(z.int().min(1).max(65535))
    .max(15)
    .refine((ports) => new Set(ports).size === ports.length, 'Fallback ports must be unique')
    .refine(
        (ports) => ports.every((port) => ![2222, 2223, 2224].includes(port)),
        'Machine control ports 2222-2224 are reserved',
    );

const ExternalPortSchema = (defaultPort: number) =>
    z
        .int()
        .min(1)
        .max(65535)
        .refine((port) => ![2222, 2223, 2224].includes(port), 'Machine control port is reserved')
        .default(defaultPort);

const RealitySchema = z
    .object({
        protocol: z.literal('VLESS_REALITY'),
        remark: z.string().trim().min(1).max(100).optional(),
        externalPort: ExternalPortSchema(443),
        fallbackPorts: FallbackPortsSchema.optional(),
        serverName: DomainSchema.default('www.microsoft.com'),
        target: z.string().trim().min(3).max(255).default('www.microsoft.com:443'),
    })
    .strict();

const TlsVisionSchema = z
    .object({
        protocol: z.literal('VLESS_TLS_VISION'),
        remark: z.string().trim().min(1).max(100).optional(),
        externalPort: ExternalPortSchema(8443),
        fallbackPorts: FallbackPortsSchema.optional(),
        certificate: CertificateSchema,
    })
    .strict();

const Hysteria2Schema = z
    .object({
        protocol: z.literal('HYSTERIA2'),
        remark: z.string().trim().min(1).max(100).optional(),
        externalPort: ExternalPortSchema(443),
        fallbackPorts: FallbackPortsSchema.optional(),
        certificate: CertificateSchema,
        congestion: z.enum(['bbr', 'brutal']).optional(),
        upMbps: z.int().positive().max(100_000).optional(),
        downMbps: z.int().positive().max(100_000).optional(),
    })
    .strict();

export namespace ProvisionMachineCommand {
    export const url = REST_API.MACHINES.ACTIONS.PROVISION(':uuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.PROVISION(':uuid'),
        'post',
        'Discover resources and plan protocol instances on a machine',
        { scope: 'provision', kind: 'write' },
    );

    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z
        .object({
            protocols: z
                .array(
                    z.discriminatedUnion('protocol', [
                        RealitySchema,
                        TlsVisionSchema,
                        Hysteria2Schema,
                    ]),
                )
                .min(1)
                .max(3)
                .refine(
                    (items) => new Set(items.map((item) => item.protocol)).size === items.length,
                    'Each protocol may only be provisioned once per machine',
                )
                .refine(
                    (items) =>
                        new Set(
                            items.map(
                                (item) =>
                                    `${item.protocol === 'HYSTERIA2' ? 'udp' : 'tcp'}:${item.externalPort}`,
                            ),
                        ).size === items.length,
                    'Two protocol instances cannot bind the same port and network',
                )
                .refine(
                    (items) =>
                        !items.some(
                            (item) => 'certificate' in item && item.certificate.mode === 'HTTP_01',
                        ) ||
                        !items.some(
                            (item) => item.protocol !== 'HYSTERIA2' && item.externalPort === 80,
                        ),
                    'TCP port 80 is reserved while HTTP-01 certificate automation is enabled',
                ),
            enableWarp: z.boolean().default(false),
        })
        .strict();
    export const ResponseSchema = z.object({
        response: z.object({
            machine: MachineSchema,
            plan: MachineProvisioningPlanSchema,
            commandUuid: z.uuid(),
        }),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
