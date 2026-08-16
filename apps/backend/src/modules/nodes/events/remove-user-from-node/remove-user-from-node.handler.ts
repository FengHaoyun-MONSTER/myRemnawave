import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { RemoveUserCommand as RemoveUserFromNodeCommandSdk } from '@remnawave/node-contract';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { RemoveUserFromNodeEvent } from './remove-user-from-node.event';

@EventsHandler(RemoveUserFromNodeEvent)
export class RemoveUserFromNodeHandler implements IEventHandler<RemoveUserFromNodeEvent> {
    public readonly logger = new Logger(RemoveUserFromNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}
    async handle(event: RemoveUserFromNodeEvent) {
        try {
            const nodes = await this.nodesRepository.findConnectedNodesWithoutInbounds();

            if (nodes.length === 0) {
                return;
            }

            const managedNodes = nodes.filter((node) => node.machineUuid !== null);
            await Promise.all(
                managedNodes.map((node) =>
                    this.nodesQueuesService.startNode({
                        nodeUuid: node.uuid,
                        force: false,
                        managedConfigUpdate: true,
                        failClosedOnError: true,
                    }),
                ),
            );

            const userData: RemoveUserFromNodeCommandSdk.Request = {
                username: event.id.toString(),
                hashData: {
                    vlessUuid: event.vlessUuid,
                },
            };

            await this.nodesQueuesService.removeUserFromNodeBulk(
                nodes
                    .filter((node) => node.machineUuid === null)
                    .map((node) => ({
                        data: userData,
                        node: node.connectionOpts,
                    })),
            );

            return;
        } catch (error) {
            this.logger.error(`Error in Event RemoveUserFromNodeHandler: ${error}`);
        }
    }
}
