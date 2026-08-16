import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineSchema } from '../../models';

export namespace GetMachineCommand {
    export const url = REST_API.MACHINES.GET_BY_UUID(':uuid');
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.GET_BY_UUID(':uuid'),
        'get',
        'Get a machine',
        { scope: 'read', kind: 'read' },
    );

    export const RequestParamsSchema = z.object({ uuid: z.uuid() });
    export const ResponseSchema = z.object({ response: MachineSchema });
}
