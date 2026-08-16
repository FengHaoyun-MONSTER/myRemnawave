import { IGetSquadAccessibleNodes } from '../interfaces';

export class GetInternalSquadAccessibleNodesResponseModel {
    public readonly squadUuid: string;
    public readonly accessibleNodes: {
        uuid: string;
        nodeName: string;
        countryCode: string;
        protocolKey: string | null;
        lifecycleState: string;
        isPublished: boolean;
    }[];

    constructor(data: IGetSquadAccessibleNodes) {
        this.squadUuid = data.squadUuid;
        this.accessibleNodes = data.accessibleNodes;
    }
}
