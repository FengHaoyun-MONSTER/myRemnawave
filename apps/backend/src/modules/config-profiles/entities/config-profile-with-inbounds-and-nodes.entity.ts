import { ConfigProfiles } from '@prisma/client';
import { JsonArray, JsonObject } from '@prisma/client/runtime/library';

import { ConfigProfileInboundEntity } from './config-profile-inbound.entity';

export class ConfigProfileWithInboundsAndNodesEntity implements ConfigProfiles {
    public uuid: string;
    public viewPosition: number;
    public name: string;
    public config: string | number | boolean | JsonObject | JsonArray | null | object;
    public templateKey: 'VLESS_REALITY' | 'VLESS_TLS_VISION' | 'HYSTERIA2' | null;
    public templateVersion: number | null;
    public isSystem: boolean;
    public isImmutable: boolean;

    public inbounds: ConfigProfileInboundEntity[];
    public nodes: {
        uuid: string;
        name: string;
        countryCode: string;
    }[];

    public createdAt: Date;
    public updatedAt: Date;

    constructor(
        configProfileWithInboundsAndNodes: Partial<
            Omit<ConfigProfileWithInboundsAndNodesEntity, 'templateKey'>
        > & { templateKey?: string | null },
    ) {
        Object.assign(this, configProfileWithInboundsAndNodes);
        const templateKey = configProfileWithInboundsAndNodes.templateKey;
        if (
            templateKey !== undefined &&
            templateKey !== null &&
            !['VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2'].includes(templateKey)
        ) {
            throw new Error(`Unknown system template key: ${templateKey}`);
        }
        this.templateKey = (templateKey ??
            null) as ConfigProfileWithInboundsAndNodesEntity['templateKey'];
        return this;
    }
}
