import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineSchema } from '../../models';

export namespace PublishMachineCommand {
    export const url = REST_API.MACHINES.ACTIONS.PUBLISH(':uuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.PUBLISH(':uuid'),
        'post',
        'Publish validated machine nodes to internal squads',
        { scope: 'publish', kind: 'write' },
    );

    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z
        .object({
            grants: z
                .array(
                    z
                        .object({
                            nodeUuid: z.uuid(),
                            internalSquadUuids: z.array(z.uuid()).min(1).max(1_000),
                        })
                        .strict(),
                )
                .min(1)
                .max(3)
                .refine(
                    (items) => new Set(items.map((item) => item.nodeUuid)).size === items.length,
                    'Each node may only appear once',
                )
                .refine(
                    (items) =>
                        items.every(
                            (item) =>
                                new Set(item.internalSquadUuids).size ===
                                item.internalSquadUuids.length,
                        ),
                    'Internal squad UUIDs must be unique for each node',
                ),
        })
        .strict();
    export const ResponseSchema = z.object({
        response: z.object({
            machine: MachineSchema,
            publishedNodeUuids: z.array(z.uuid()),
        }),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
