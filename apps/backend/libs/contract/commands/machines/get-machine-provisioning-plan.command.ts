import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineProvisioningPlanSchema } from '../../models';

export namespace GetMachineProvisioningPlanCommand {
    export const url = REST_API.MACHINES.GET_PROVISIONING_PLAN(':uuid', ':planUuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.GET_PROVISIONING_PLAN(':uuid', ':planUuid'),
        'get',
        'Get a Machine provisioning plan',
        { scope: 'view', kind: 'read' },
    );
    export const RequestParamsSchema = z.object({ uuid: z.uuid(), planUuid: z.uuid() });
    export const ResponseSchema = z.object({ response: MachineProvisioningPlanSchema });
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
