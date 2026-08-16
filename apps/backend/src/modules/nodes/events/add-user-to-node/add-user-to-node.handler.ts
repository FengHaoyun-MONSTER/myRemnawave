import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler, QueryBus } from '@nestjs/cqrs';

import { GetGrantedNodeUuidsQuery } from '@modules/users/queries/get-granted-node-uuids';

import { NodesQueuesService } from '@queue/_nodes';

import { AddUserToNodeEvent } from './add-user-to-node.event';

@EventsHandler(AddUserToNodeEvent)
export class AddUserToNodeHandler implements IEventHandler<AddUserToNodeEvent> {
    private readonly logger = new Logger(AddUserToNodeHandler.name);

    constructor(
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
    ) {}

    async handle(event: AddUserToNodeEvent): Promise<void> {
        try {
            const grantedNodes = await this.queryBus.execute(
                new GetGrantedNodeUuidsQuery([event.userId]),
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
            this.logger.error(`Failed to reconcile nodes for a user change: ${String(error)}`);
        }
    }
}
