import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { RemoveUsersCommand as RemoveUsersFromNodeCommandSdk } from '@remnawave/node-contract';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { RemoveUsersFromNodeEvent } from './remove-users-from-node.event';

@EventsHandler(RemoveUsersFromNodeEvent)
export class RemoveUsersFromNodeHandler implements IEventHandler<RemoveUsersFromNodeEvent> {
    public readonly logger = new Logger(RemoveUsersFromNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}
    async handle(event: RemoveUsersFromNodeEvent) {
        try {
            const nodes = await this.nodesRepository.findConnectedNodesWithoutInbounds();

            if (nodes.length === 0 || event.users.length === 0) {
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

            const userData: RemoveUsersFromNodeCommandSdk.Request = {
                users: event.users.map((user) => ({
                    userId: user.id.toString(),
                    hashUuid: user.vlessUuid,
                })),
            };

            for (const node of nodes.filter((candidate) => candidate.machineUuid === null)) {
                await this.nodesQueuesService.removeUsersFromNode({
                    data: userData,
                    node: node.connectionOpts,
                });
            }

            return;
        } catch (error) {
            this.logger.error(`Error in Event RemoveUsersFromNodeHandler: ${error}`);
        }
    }
}
