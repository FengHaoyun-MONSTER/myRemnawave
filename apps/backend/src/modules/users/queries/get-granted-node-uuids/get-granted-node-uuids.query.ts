import { Query } from '@nestjs/cqrs';

import { TResult } from '@common/types';

export class GetGrantedNodeUuidsQuery extends Query<TResult<string[]>> {
    constructor(public readonly userIds: bigint[]) {
        super();
    }
}
