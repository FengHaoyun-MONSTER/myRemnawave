import { IGetUserAccessibleNodesResponse } from '../interfaces';

export class GetUserAccessibleNodesResponseModel {
    public readonly userId: number;
    public readonly activeNodes: {
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

    constructor(data: IGetUserAccessibleNodesResponse, userId: bigint) {
        this.userId = Number(userId);
        this.activeNodes = data.activeNodes;
    }
}
