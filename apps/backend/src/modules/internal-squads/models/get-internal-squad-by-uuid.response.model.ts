import { InternalSquadWithInfoEntity } from '../entities/internal-squad-with-info.entity';

export class GetInternalSquadByUuidResponseModel {
    public readonly uuid: string;
    public readonly viewPosition: number;
    public readonly name: string;
    public readonly info: {
        membersCount: number;
        nodesCount: number;
    };
    public readonly nodes: InternalSquadWithInfoEntity['nodes'];

    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    constructor(entity: InternalSquadWithInfoEntity) {
        this.uuid = entity.uuid;
        this.viewPosition = entity.viewPosition;
        this.name = entity.name;
        this.info = {
            membersCount: Number(entity.membersCount),
            nodesCount: Number(entity.nodesCount),
        };
        this.nodes = entity.nodes;

        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
