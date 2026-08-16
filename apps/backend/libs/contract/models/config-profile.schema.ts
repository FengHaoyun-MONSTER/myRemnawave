import { z } from 'zod';

import { ConfigProfileInboundsSchema } from './config-profile-inbounds.schema';

export const ConfigProfileSchema = z.object({
    uuid: z.uuid(),
    viewPosition: z.int(),
    name: z.string(),
    config: z.unknown(),
    templateKey: z.enum(['VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2']).nullable(),
    templateVersion: z.int().positive().nullable(),
    isSystem: z.boolean(),
    isImmutable: z.boolean(),
    inbounds: z.array(ConfigProfileInboundsSchema),
    nodes: z.array(
        z.object({
            uuid: z.uuid(),
            name: z.string(),
            countryCode: z.string(),
        }),
    ),

    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
