import { z } from 'zod';

import { MACHINES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { MachineEnrollmentTokenSchema } from '../../models';

export namespace CreateMachineCommand {
    export const url = REST_API.MACHINES.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        MACHINES_ROUTES.CREATE,
        'post',
        'Create a machine draft and one-time enrollment token',
        { scope: 'create', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        name: z.string().trim().min(3).max(100),
        address: z.string().trim().min(2).max(255),
        countryCode: z.string().length(2).toUpperCase().default('XX'),
        tags: z.array(z.string().trim().min(1).max(36)).max(10).default([]),
        note: z.string().trim().max(255).nullable().optional(),
    });

    export const ResponseSchema = z.object({
        response: MachineEnrollmentTokenSchema,
    });
}
