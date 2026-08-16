import { Query } from '@nestjs/cqrs';

import { TResult } from '@common/types';

export class GetNodeUuidsBySquadUuidQuery extends Query<TResult<string[]>> {
    constructor(public readonly squadUuid: string) {
        super();
    }
}
