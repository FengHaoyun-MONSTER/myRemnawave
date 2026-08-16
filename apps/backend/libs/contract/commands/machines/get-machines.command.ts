import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineSchema } from '../../models';

export namespace GetMachinesCommand {
    export const url = REST_API.MACHINES.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(MACHINES_ROUTES.GET, 'get', 'Get machines', {
        scope: 'read',
        kind: 'read',
    });

    export const ResponseSchema = z.object({
        response: z.array(MachineSchema),
    });
}
