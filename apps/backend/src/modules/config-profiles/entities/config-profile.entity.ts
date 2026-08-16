import { ConfigProfiles } from '@prisma/client';

export class ConfigProfileEntity implements ConfigProfiles {
    public uuid: string;
    public viewPosition: number;
    public name: string;
    public config: object;
    public templateKey: 'VLESS_REALITY' | 'VLESS_TLS_VISION' | 'HYSTERIA2' | null;
    public templateVersion: number | null;
    public isSystem: boolean;
    public isImmutable: boolean;

    public createdAt: Date;
    public updatedAt: Date;

    constructor(configProfile: Partial<ConfigProfiles>) {
        Object.assign(this, configProfile);
        return this;
    }
}
