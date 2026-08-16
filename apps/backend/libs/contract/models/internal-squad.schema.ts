import { z } from 'zod';

export const InternalSquadSchema = z.object({
    uuid: z.uuid(),
    viewPosition: z.int(),
    name: z.string(),

    info: z.object({
        membersCount: z.number(),
        nodesCount: z.number(),
    }),

    nodes: z.array(
        z.object({
            uuid: z.uuid(),
            name: z.string(),
            countryCode: z.string(),
            protocolKey: z.string().nullable(),
            lifecycleState: z.string(),
            isPublished: z.boolean(),
        }),
    ),

    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
