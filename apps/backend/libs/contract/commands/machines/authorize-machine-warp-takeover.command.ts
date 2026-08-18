import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace AuthorizeMachineWarpTakeoverCommand {
    export const url = REST_API.MACHINES.ACTIONS.AUTHORIZE_WARP_TAKEOVER(':uuid', ':planUuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.AUTHORIZE_WARP_TAKEOVER(':uuid', ':planUuid'),
        'post',
        'Explicitly authorize takeover of an incompatible external WARP runtime',
        { scope: 'provision', kind: 'write' },
    );
    export const RequestParamsSchema = z.object({ uuid: z.uuid(), planUuid: z.uuid() });
    export const RequestBodySchema = z
        .object({
            confirmation: z.literal('TAKE_OVER_EXTERNAL_WARP'),
            attestNo3xuiUse: z.literal(true),
        })
        .strict();
    export const ResponseSchema = z.object({
        response: z.object({ commandUuid: z.uuid() }),
    });
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
