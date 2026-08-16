import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { InternalSquadRepository } from '../../repositories/internal-squad.repository';
import { GetNodeUuidsBySquadUuidQuery } from './get-node-uuids-by-squad-uuid.query';

@QueryHandler(GetNodeUuidsBySquadUuidQuery)
export class GetNodeUuidsBySquadUuidHandler implements IQueryHandler<
    GetNodeUuidsBySquadUuidQuery,
    TResult<string[]>
> {
    constructor(private readonly repository: InternalSquadRepository) {}

    async execute(query: GetNodeUuidsBySquadUuidQuery): Promise<TResult<string[]>> {
        try {
            return ok(await this.repository.getNodeUuidsBySquadUuid(query.squadUuid));
        } catch {
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
