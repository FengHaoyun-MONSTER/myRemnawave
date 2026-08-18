import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineSchema } from '../../models';

export namespace ApplyMachineProvisioningPlanCommand {
    export const url = REST_API.MACHINES.ACTIONS.APPLY_PROVISIONING_PLAN(':uuid', ':planUuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.APPLY_PROVISIONING_PLAN(':uuid', ':planUuid'),
        'post',
        'Apply a ready Machine provisioning plan',
        { scope: 'provision', kind: 'write' },
    );
    export const RequestParamsSchema = z.object({ uuid: z.uuid(), planUuid: z.uuid() });
    export const RequestBodySchema = z.object({}).strict();
    export const ResponseSchema = z.object({
        response: z.object({
            machine: MachineSchema,
            nodeUuids: z.array(z.uuid()),
            commandUuids: z.array(z.uuid()),
        }),
    });
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
