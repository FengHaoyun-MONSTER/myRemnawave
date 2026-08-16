export interface IGetUserAccessibleNodes {
    uuid: string;
    nodeName: string;
    countryCode: string;
    protocolKey: string | null;
    lifecycleState: string;
    isPublished: boolean;
    activeSquads: Map<
        string,
        {
            squadUuid: string;
            squadName: string;
        }
    >;
}

export interface IGetUserAccessibleNodesResponse {
    activeNodes: {
        uuid: string;
        nodeName: string;
        countryCode: string;
        protocolKey: string | null;
        lifecycleState: string;
        isPublished: boolean;
        activeSquads: {
            squadUuid: string;
            squadName: string;
        }[];
    }[];
}
