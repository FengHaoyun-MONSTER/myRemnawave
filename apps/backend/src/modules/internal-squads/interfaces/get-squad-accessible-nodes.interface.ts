export interface IGetSquadAccessibleNodes {
    squadUuid: string;
    accessibleNodes: {
        uuid: string;
        nodeName: string;
        countryCode: string;
        protocolKey: string | null;
        lifecycleState: string;
        isPublished: boolean;
    }[];
}
