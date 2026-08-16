import { InternalSquads } from '@prisma/client';

export class InternalSquadWithInfoEntity implements InternalSquads {
    public uuid: string;
    public viewPosition: number;
    public name: string;

    public membersCount: number | string | bigint | null;
    public nodesCount: number | string | bigint | null;
    public nodes: {
        uuid: string;
        name: string;
        countryCode: string;
        protocolKey: string | null;
        lifecycleState: string;
        isPublished: boolean;
    }[];

    public createdAt: Date;
    public updatedAt: Date;

    constructor(internalSquad: Partial<InternalSquadWithInfoEntity>) {
        Object.assign(this, internalSquad);

        this.membersCount = Number(this.membersCount) || 0;
        this.nodesCount = Number(this.nodesCount) || 0;

        return this;
    }
}
