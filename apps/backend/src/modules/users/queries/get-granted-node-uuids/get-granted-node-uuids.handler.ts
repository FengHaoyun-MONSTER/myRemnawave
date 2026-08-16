import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { UsersRepository } from '../../repositories/users.repository';
import { GetGrantedNodeUuidsQuery } from './get-granted-node-uuids.query';

@QueryHandler(GetGrantedNodeUuidsQuery)
export class GetGrantedNodeUuidsHandler implements IQueryHandler<
    GetGrantedNodeUuidsQuery,
    TResult<string[]>
> {
    constructor(private readonly usersRepository: UsersRepository) {}

    async execute(query: GetGrantedNodeUuidsQuery): Promise<TResult<string[]>> {
        try {
            return ok(await this.usersRepository.getGrantedNodeUuids(query.userIds));
        } catch {
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
