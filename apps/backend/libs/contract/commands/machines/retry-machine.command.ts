import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineSchema } from '../../models';

export namespace RetryMachineCommand {
    export const url = REST_API.MACHINES.ACTIONS.RETRY(':uuid');
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.ACTIONS.RETRY(':uuid'),
        'post',
        'Retry failed machine node provisioning steps',
        { scope: 'retry', kind: 'write' },
    );

    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z
        .object({
            nodeUuids: z
                .array(z.uuid())
                .min(1)
                .max(3)
                .refine(
                    (items) => new Set(items).size === items.length,
                    'Node UUIDs must be unique',
                ),
        })
        .strict();
    export const ResponseSchema = z.object({
        response: z.object({
            machine: MachineSchema,
            nodeUuids: z.array(z.uuid()),
            commandUuids: z.array(z.uuid()),
        }),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>['response'];
}
