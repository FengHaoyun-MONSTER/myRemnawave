import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace GetMachineControlStatusCommand {
    export const url = REST_API.MACHINES.GET_CONTROL_STATUS;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.GET_CONTROL_STATUS,
        'get',
        'Get Machine Agent control-plane readiness',
        { scope: 'control-status', kind: 'read' },
    );

    export const ResponseSchema = z.object({
        response: z.object({
            enabled: z.boolean(),
            ready: z.boolean(),
            publicUrl: z.url().startsWith('wss://').nullable(),
        }),
    });
}
