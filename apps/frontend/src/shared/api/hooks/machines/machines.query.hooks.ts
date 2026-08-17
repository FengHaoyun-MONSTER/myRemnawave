import { createQueryKeys } from '@lukemorales/query-key-factory'
import {
    GetMachineCommand,
    GetMachineControlStatusCommand,
    GetMachinesCommand
} from '@remnawave/backend-contract'

import { sToMs } from '@shared/utils/time-utils'

import { createGetQueryHook, errorHandler } from '../../tsq-helpers'

export const machinesQueryKeys = createQueryKeys('machines', {
    getMachines: { queryKey: null },
    getMachine: (route: { uuid: string }) => ({ queryKey: [route] }),
    getControlStatus: { queryKey: ['control-status'] }
})

export const useGetMachineControlStatus = createGetQueryHook({
    endpoint: GetMachineControlStatusCommand.TSQ_url,
    responseSchema: GetMachineControlStatusCommand.ResponseSchema,
    getQueryKey: () => machinesQueryKeys.getControlStatus.queryKey,
    rQueryParams: {
        refetchInterval: sToMs(5),
        refetchOnMount: true,
        staleTime: 0
    },
    errorHandler: (error) => errorHandler(error, 'Get Machine Control Status')
})

export const useGetMachines = createGetQueryHook({
    endpoint: GetMachinesCommand.TSQ_url,
    responseSchema: GetMachinesCommand.ResponseSchema,
    getQueryKey: () => machinesQueryKeys.getMachines.queryKey,
    rQueryParams: {
        refetchInterval: sToMs(5),
        refetchOnMount: true,
        staleTime: 0
    },
    errorHandler: (error) => errorHandler(error, 'Get Machines')
})

export const useGetMachine = createGetQueryHook({
    endpoint: GetMachineCommand.TSQ_url,
    responseSchema: GetMachineCommand.ResponseSchema,
    routeParamsSchema: GetMachineCommand.RequestParamsSchema,
    getQueryKey: ({ route }) => machinesQueryKeys.getMachine(route!).queryKey,
    rQueryParams: {
        refetchInterval: sToMs(5),
        refetchOnMount: true,
        staleTime: 0
    },
    errorHandler: (error) => errorHandler(error, 'Get Machine')
})
