import { ConfigProfileInboundEntity } from '../entities';

export class GetAllInboundsResponseModel {
    public readonly total: number;
    public readonly inbounds: ConfigProfileInboundEntity[];

    constructor(inbounds: ConfigProfileInboundEntity[], total: number) {
        this.total = total;
        this.inbounds = inbounds;
    }
}
