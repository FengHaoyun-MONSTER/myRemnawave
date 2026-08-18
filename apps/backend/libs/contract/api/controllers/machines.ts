export const MACHINES_CONTROLLER = 'machines' as const;

const ACTIONS_ROUTE = 'actions' as const;

export const MACHINES_ROUTES = {
    CREATE: '',
    GET: '',
    GET_CONTROL_STATUS: 'control-status',
    GET_BY_UUID: (uuid: string) => uuid,
    GET_PROVISIONING_PLAN: (uuid: string, planUuid: string) =>
        `${uuid}/provisioning-plans/${planUuid}`,
    ACTIONS: {
        ROTATE_ENROLLMENT_TOKEN: (uuid: string) =>
            `${uuid}/${ACTIONS_ROUTE}/rotate-enrollment-token`,
        PROVISION: (uuid: string) => `${uuid}/${ACTIONS_ROUTE}/provision`,
        APPLY_PROVISIONING_PLAN: (uuid: string, planUuid: string) =>
            `${uuid}/${ACTIONS_ROUTE}/provision/${planUuid}/apply`,
        AUTHORIZE_WARP_TAKEOVER: (uuid: string, planUuid: string) =>
            `${uuid}/${ACTIONS_ROUTE}/provision/${planUuid}/warp-takeover`,
        RETRY: (uuid: string) => `${uuid}/${ACTIONS_ROUTE}/retry`,
        PUBLISH: (uuid: string) => `${uuid}/${ACTIONS_ROUTE}/publish`,
    },
} as const;

export const MACHINE_ENROLLMENT_CONTROLLER = 'machine-enrollment' as const;

export const MACHINE_ENROLLMENT_ROUTES = {
    ENROLL: '',
} as const;
