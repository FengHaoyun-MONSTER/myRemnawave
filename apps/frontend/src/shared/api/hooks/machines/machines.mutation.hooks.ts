import { notifications } from '@mantine/notifications'
import {
    CreateMachineCommand,
    ProvisionMachineCommand,
    PublishMachineCommand,
    RetryMachineCommand,
    RotateMachineEnrollmentTokenCommand
} from '@remnawave/backend-contract'

import { createMutationHook } from '../../tsq-helpers'

const failure = (title: string) => (error: unknown) =>
    notifications.show({
        title,
        message: error instanceof Error ? error.message : 'Request failed with unknown error.',
        color: 'red'
    })

export const useCreateMachine = createMutationHook({
    endpoint: CreateMachineCommand.TSQ_url,
    bodySchema: CreateMachineCommand.RequestBodySchema,
    responseSchema: CreateMachineCommand.ResponseSchema,
    requestMethod: CreateMachineCommand.endpointDetails.REQUEST_METHOD,
    rMutationParams: { onError: failure('Create Machine') }
})

export const useRotateMachineEnrollmentToken = createMutationHook({
    endpoint: RotateMachineEnrollmentTokenCommand.TSQ_url,
    routeParamsSchema: RotateMachineEnrollmentTokenCommand.RequestParamsSchema,
    responseSchema: RotateMachineEnrollmentTokenCommand.ResponseSchema,
    requestMethod: RotateMachineEnrollmentTokenCommand.endpointDetails.REQUEST_METHOD,
    rMutationParams: { onError: failure('Rotate Enrollment Token') }
})

export const useProvisionMachine = createMutationHook({
    endpoint: ProvisionMachineCommand.TSQ_url,
    routeParamsSchema: ProvisionMachineCommand.RequestParamSchema,
    bodySchema: ProvisionMachineCommand.RequestBodySchema,
    responseSchema: ProvisionMachineCommand.ResponseSchema,
    requestMethod: ProvisionMachineCommand.endpointDetails.REQUEST_METHOD,
    rMutationParams: { onError: failure('Provision Machine') }
})

export const usePublishMachine = createMutationHook({
    endpoint: PublishMachineCommand.TSQ_url,
    routeParamsSchema: PublishMachineCommand.RequestParamSchema,
    bodySchema: PublishMachineCommand.RequestBodySchema,
    responseSchema: PublishMachineCommand.ResponseSchema,
    requestMethod: PublishMachineCommand.endpointDetails.REQUEST_METHOD,
    rMutationParams: { onError: failure('Publish Machine') }
})

export const useRetryMachine = createMutationHook({
    endpoint: RetryMachineCommand.TSQ_url,
    routeParamsSchema: RetryMachineCommand.RequestParamSchema,
    bodySchema: RetryMachineCommand.RequestBodySchema,
    responseSchema: RetryMachineCommand.ResponseSchema,
    requestMethod: RetryMachineCommand.endpointDetails.REQUEST_METHOD,
    rMutationParams: { onError: failure('Retry Machine Node') }
})
