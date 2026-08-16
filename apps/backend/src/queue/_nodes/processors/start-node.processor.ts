import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import semver from 'semver';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AxiosService } from '@common/axios/axios.service';
import { PrismaService } from '@common/database/prisma.service';
import { RawCacheService } from '@common/raw-cache';
import { formatExecutionTime, getTime } from '@common/utils/get-elapsed-time';
import { CACHE_KEYS, CACHE_KEYS_TTL, EVENTS } from '@libs/contracts/constants';

import { NodeEvent } from '@integration-modules/notifications/interfaces';

import { GetNodeJwtCommand } from '@modules/keygen/commands/get-node-jwt';
import { renderManagedConfig } from '@modules/machines/managed-config.renderer';
import { GetPluginByUuidQuery } from '@modules/node-plugins/queries/get-plugin-by-uuid';
import { UpdateNodeCommand } from '@modules/nodes/commands/update-node';
import { NodesEntity } from '@modules/nodes/entities/nodes.entity';
import { GetNodeByUuidQuery } from '@modules/nodes/queries/get-node-by-uuid';
import { GetPreparedConfigWithUsersQuery } from '@modules/users/queries/get-prepared-config-with-users';

import { QUEUES_NAMES } from '@queue/queue.enum';

import { NODES_JOB_NAMES } from '../constants/nodes-job-name.constant';
import { NodesQueuesService } from '../nodes-queues.service';

@Processor(QUEUES_NAMES.NODES.START, {
    concurrency: 40,
})
export class StartNodeProcessor extends WorkerHost {
    private readonly logger = new Logger(StartNodeProcessor.name);

    constructor(
        private readonly axios: AxiosService,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
        private readonly eventEmitter: EventEmitter2,
        private readonly commandBus: CommandBus,
        private readonly rawCacheService: RawCacheService,
        private readonly prisma: PrismaService,
    ) {
        super();
    }

    async process(
        job: Job<{
            nodeUuid: string;
            force?: boolean;
            managedConfigUpdate?: boolean;
            failClosedOnError?: boolean;
        }>,
    ) {
        try {
            const { nodeUuid, force, failClosedOnError } = job.data;

            const nodeCheckup = await this.queryBus.execute(new GetNodeByUuidQuery(nodeUuid));

            if (!nodeCheckup.isOk) {
                this.logger.error(`Node ${nodeUuid} not found`);
                return;
            }

            const { response: node } = nodeCheckup;

            if (node.isConnecting && !node.machineUuid) {
                return;
            }

            await this.rawCacheService.delMany([
                CACHE_KEYS.NODE_SYSTEM_STATS(nodeUuid),
                CACHE_KEYS.NODE_USERS_ONLINE(nodeUuid),
                CACHE_KEYS.NODE_XRAY_UPTIME(nodeUuid),
            ]);

            if (node.activeInbounds.length === 0 || !node.activeConfigProfileUuid) {
                this.logger.warn(
                    `Node ${nodeUuid} has no active config profile or inbounds, disabling and clearing profile from node...`,
                );

                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isDisabled: true,
                        activeConfigProfileUuid: null,
                        isConnecting: false,
                        isConnected: false,
                        lastStatusMessage: null,
                        lastStatusChange: new Date(),
                    }),
                );

                await this.nodesQueuesService.stopNode({
                    nodeUuid: node.uuid,
                    isNeedToBeDeleted: false,
                });

                return;
            }

            await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnecting: true,
                }),
            );

            if (node.machineUuid) {
                await this.queueManagedConfig(node, force ?? false, failClosedOnError ?? false);
                return;
            }

            const xrayStatusResponse = await this.axios.getNodeHealth({
                address: node.address,
                port: node.port,
                proxyUrl: node.proxyUrl,
            });

            if (!xrayStatusResponse.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: xrayStatusResponse.message ?? null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Pre-check failed. Node: ${node.uuid} – ${node.address}:${node.port}, error: ${xrayStatusResponse.message}`,
                );

                return;
            }

            if (semver.lt(xrayStatusResponse.response.nodeVersion, '2.7.0')) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                );

                return;
            }

            let plugin: {
                uuid: string;
                config: Record<string, unknown>;
                name: string;
            } | null = null;

            if (node.activePluginUuid) {
                const getNodePluginResult = await this.queryBus.execute(
                    new GetPluginByUuidQuery(node.activePluginUuid),
                );

                if (!getNodePluginResult.isOk) {
                    this.logger.error(`Failed to get node plugin: ${getNodePluginResult.message}`);
                    return;
                }
                const { response: nodePlugin } = getNodePluginResult;
                plugin = {
                    uuid: nodePlugin.uuid,
                    config: nodePlugin.pluginConfig as Record<string, unknown>,
                    name: nodePlugin.name,
                };
            }

            const syncNodePluginsResponse = await this.axios.syncNodePlugins(
                {
                    plugin,
                },
                {
                    address: node.address,
                    port: node.port,
                    proxyUrl: node.proxyUrl,
                },
            );

            if (!syncNodePluginsResponse.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isConnecting: false,
                        isConnected: false,
                        lastStatusMessage: `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                        lastStatusChange: new Date(),
                    }),
                );

                this.logger.error(
                    `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                );
                return;
            }

            const startTime = getTime();
            const config = await this.queryBus.execute(
                new GetPreparedConfigWithUsersQuery(
                    node.uuid,
                    node.activeConfigProfileUuid,
                    node.activeInbounds,
                ),
            );

            this.logger.log(`Generated config for node in ${formatExecutionTime(startTime)}`);

            if (!config.isOk) {
                throw new Error('Failed to get config for node');
            }

            const reqStartTime = getTime();

            const startNodeResult = await this.axios.startXray(
                {
                    xrayConfig: config.response.config as unknown as Record<string, unknown>,
                    internals: {
                        hashes: config.response.hashesPayload,
                        forceRestart: force ?? false,
                    },
                },
                {
                    address: node.address,
                    port: node.port,
                    proxyUrl: node.proxyUrl,
                },
            );

            this.logger.log(`Started node in ${formatExecutionTime(reqStartTime)}`);

            if (!startNodeResult.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: startNodeResult.message ?? null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                return;
            }

            const nodeResponse = startNodeResult.response;

            await this.rawCacheService.setMany([
                {
                    key: CACHE_KEYS.NODE_SYSTEM_INFO(node.uuid),
                    value: nodeResponse.system.info,
                },
                {
                    key: CACHE_KEYS.NODE_VERSIONS(node.uuid),
                    value:
                        nodeResponse.nodeInformation.version && nodeResponse.version
                            ? {
                                  xray: nodeResponse.version,
                                  node: nodeResponse.nodeInformation.version,
                              }
                            : null,
                },
                {
                    key: CACHE_KEYS.NODE_SYSTEM_STATS(node.uuid),
                    value: nodeResponse.system.stats,
                    ttlSeconds: CACHE_KEYS_TTL.NODE_SYSTEM_STATS,
                },
            ]);

            const updateNodeResult = await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnected: nodeResponse.isStarted,
                    lastStatusMessage: nodeResponse.error ?? null,
                    lastStatusChange: new Date(),
                    isConnecting: false,
                }),
            );

            if (!updateNodeResult.isOk) {
                this.logger.error(`Failed to update node ${node.uuid}`);
                return;
            }

            if (!node.isConnected) {
                this.eventEmitter.emit(
                    EVENTS.NODE.CONNECTION_RESTORED,
                    new NodeEvent(updateNodeResult.response, EVENTS.NODE.CONNECTION_RESTORED),
                );
            }

            return;
        } catch (error) {
            this.logger.error(`Error handling "${NODES_JOB_NAMES.START_NODE}" job: ${error}`);
            await this.handleManagedConfigQueueFailure(
                job.data.nodeUuid,
                error,
                job.data.failClosedOnError ?? false,
            );
        }
    }

    private async handleManagedConfigQueueFailure(
        nodeUuid: string,
        error: unknown,
        failClosedOnError: boolean,
    ): Promise<void> {
        const node = await this.prisma.nodes.findUnique({
            where: { uuid: nodeUuid },
            select: { machineUuid: true, isPublished: true },
        });
        if (!node?.machineUuid) return;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            await transaction.nodes.update({
                where: { uuid: nodeUuid },
                data: {
                    lifecycleState: failClosedOnError
                        ? 'FAILED'
                        : node.isPublished
                          ? 'PUBLISHED'
                          : 'FAILED',
                    isConnecting: false,
                    isConnected: node.isPublished && !failClosedOnError,
                    lastStatusMessage: message,
                    lastStatusChange: now,
                },
            });
            if (!failClosedOnError) return;
            await transaction.hosts.updateMany({
                where: { nodes: { some: { nodeUuid } } },
                data: { isDisabled: true },
            });
            const activeStop = await transaction.machineCommands.findFirst({
                where: {
                    machineUuid: node.machineUuid!,
                    kind: 'stop_instance',
                    status: { in: ['QUEUED', 'RUNNING'] },
                    payload: { path: ['instanceId'], equals: nodeUuid },
                },
                select: { uuid: true },
            });
            if (!activeStop) {
                const commandUuid = randomUUID();
                await transaction.machineCommands.create({
                    data: {
                        uuid: commandUuid,
                        machineUuid: node.machineUuid!,
                        kind: 'stop_instance',
                        idempotencyKey: `stop_instance:${commandUuid}`,
                        payload: { instanceId: nodeUuid },
                        deadlineAt: new Date(now.getTime() + 45 * 60 * 1_000),
                    },
                });
            }
            const healthyPublishedSiblings = await transaction.nodes.count({
                where: {
                    machineUuid: node.machineUuid!,
                    uuid: { not: nodeUuid },
                    isPublished: true,
                    lifecycleState: { notIn: ['FAILED', 'DEGRADED'] },
                },
            });
            await transaction.machines.update({
                where: { uuid: node.machineUuid! },
                data: { status: healthyPublishedSiblings > 0 ? 'DEGRADED' : 'FAILED' },
            });
        });
    }

    private async queueManagedConfig(
        node: NodesEntity,
        forceRestart: boolean,
        failClosedOnError: boolean,
    ): Promise<void> {
        if (!node.machineUuid || !node.activeConfigProfileUuid || !node.port) return;
        const config = await this.queryBus.execute(
            new GetPreparedConfigWithUsersQuery(
                node.uuid,
                node.activeConfigProfileUuid,
                node.activeInbounds,
            ),
        );
        if (!config.isOk) {
            throw new Error(`Failed to generate managed config for ${node.uuid}`);
        }
        const credentials = await this.commandBus.execute(new GetNodeJwtCommand());
        if (!credentials.isOk) {
            throw new Error('Failed to generate managed node API credentials');
        }
        const commandUuid = randomUUID();
        await this.prisma.$transaction(async (transaction) => {
            const updatedNode = await transaction.nodes.update({
                where: { uuid: node.uuid },
                data: {
                    desiredRevision: { increment: 1 },
                    lifecycleState: 'PROVISIONING',
                },
                select: { desiredRevision: true },
            });
            const deadlineAt = new Date(Date.now() + 45 * 60 * 1_000);
            const payload = {
                instanceId: node.uuid,
                revision: updatedNode.desiredRevision,
                failClosedOnError,
                controlPort: node.port!,
                jwtToken: credentials.response.jwtToken,
                clientCert: credentials.response.clientCert,
                clientKey: credentials.response.clientKey,
                caCert: credentials.response.caCert,
                xrayConfig: renderManagedConfig(
                    config.response.config as Record<string, unknown>,
                    node,
                ),
                internals: {
                    hashes: config.response.hashesPayload,
                    forceRestart,
                },
            };
            const queued = await transaction.machineCommands.findFirst({
                where: {
                    machineUuid: node.machineUuid!,
                    kind: 'apply_config',
                    status: 'QUEUED',
                    payload: { path: ['instanceId'], equals: node.uuid },
                },
                orderBy: { queueSequence: 'desc' },
                select: { uuid: true, payload: true },
            });
            const effectivePayload = {
                ...payload,
                failClosedOnError:
                    failClosedOnError ||
                    (queued?.payload as Record<string, unknown> | undefined)?.failClosedOnError ===
                        true,
            };
            if (queued) {
                const replaced = await transaction.machineCommands.updateMany({
                    where: { uuid: queued.uuid, status: 'QUEUED' },
                    data: { payload: effectivePayload, deadlineAt },
                });
                if (replaced.count === 1) return;
            }
            await transaction.machineCommands.create({
                data: {
                    uuid: commandUuid,
                    machineUuid: node.machineUuid!,
                    kind: 'apply_config',
                    idempotencyKey: `apply_config:${commandUuid}`,
                    payload: effectivePayload,
                    deadlineAt,
                },
            });
        });
    }
}
