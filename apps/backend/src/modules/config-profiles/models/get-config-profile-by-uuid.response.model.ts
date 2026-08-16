import { ConfigProfileWithInboundsAndNodesEntity } from '../entities';
import { ConfigProfileInboundEntity } from '../entities/config-profile-inbound.entity';

export class GetConfigProfileByUuidResponseModel {
    public readonly uuid: string;
    public readonly viewPosition: number;
    public readonly name: string;
    public readonly config: object;
    public readonly templateKey: 'VLESS_REALITY' | 'VLESS_TLS_VISION' | 'HYSTERIA2' | null;
    public readonly templateVersion: number | null;
    public readonly isSystem: boolean;
    public readonly isImmutable: boolean;
    public readonly inbounds: ConfigProfileInboundEntity[];
    public readonly nodes: {
        uuid: string;
        name: string;
        countryCode: string;
    }[];

    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    constructor(entity: ConfigProfileWithInboundsAndNodesEntity) {
        this.uuid = entity.uuid;
        this.viewPosition = entity.viewPosition;
        this.name = entity.name;
        this.config = entity.config as object;
        this.templateKey = entity.templateKey;
        this.templateVersion = entity.templateVersion;
        this.isSystem = entity.isSystem;
        this.isImmutable = entity.isImmutable;
        this.inbounds = entity.inbounds;
        this.nodes = entity.nodes;

        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
