import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler, QueryBus } from '@nestjs/cqrs';

import { GetGrantedNodeUuidsQuery } from '@modules/users/queries/get-granted-node-uuids';

import { NodesQueuesService } from '@queue/_nodes';

import { AddUsersToNodeEvent } from './add-users-to-node.event';

@EventsHandler(AddUsersToNodeEvent)
export class AddUsersToNodeHandler implements IEventHandler<AddUsersToNodeEvent> {
    private readonly logger = new Logger(AddUsersToNodeHandler.name);

    constructor(
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
    ) {}

    async handle(event: AddUsersToNodeEvent): Promise<void> {
        try {
            const grantedNodes = await this.queryBus.execute(
                new GetGrantedNodeUuidsQuery(event.ids),
            );
            if (!grantedNodes.isOk) return;
            await Promise.all(
                grantedNodes.response.map((nodeUuid) =>
                    this.nodesQueuesService.startNode({
                        nodeUuid,
                        force: false,
                        managedConfigUpdate: true,
                    }),
                ),
            );
        } catch (error) {
            this.logger.error(`Failed to reconcile nodes for user changes: ${String(error)}`);
        }
    }
}
