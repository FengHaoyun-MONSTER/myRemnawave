import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineEnrollmentTokenSchema } from '../../models';

export namespace RotateMachineEnrollmentTokenCommand {
    export const url = REST_API.MACHINES.ACTIONS.ROTATE_ENROLLMENT_TOKEN(':uuid');
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.ROTATE_ENROLLMENT_TOKEN(':uuid'),
        'post',
        'Invalidate the old enrollment token and issue a new one',
        { scope: 'update', kind: 'write' },
    );

    export const RequestParamsSchema = z.object({ uuid: z.uuid() });
    export const ResponseSchema = z.object({
        response: MachineEnrollmentTokenSchema,
    });
}
