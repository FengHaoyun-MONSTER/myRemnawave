import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '@common/database/prisma.service';

import { NodesQueuesService } from '@queue/_nodes';

@Injectable()
export class RenewMachineCertificatesTask {
    private readonly logger = new Logger(RenewMachineCertificatesTask.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}

    @Cron('0 */15 * * * *', { name: 'renew-machine-certificates' })
    async handle(): Promise<void> {
        const now = new Date();
        const renewBefore = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
        const recentlyAttempted = new Date(now.getTime() - 6 * 60 * 60 * 1_000);
        const candidates = await this.prisma.nodes.findMany({
            where: {
                machineUuid: { not: null },
                certificateMode: { in: ['HTTP_01', 'IMPORT_EXISTING'] },
                OR: [
                    { certificateExpiresAt: null },
                    { certificateExpiresAt: { lte: renewBefore } },
                    { certificateStatus: 'FAILED' },
                ],
                machine: { archivedAt: null },
            },
            orderBy: { certificateExpiresAt: 'asc' },
            take: 100,
            select: {
                uuid: true,
                machineUuid: true,
                certificateMode: true,
                certificateExpiresAt: true,
                certificateBlockedAt: true,
                lastStatusMessage: true,
                protocolSettings: true,
                machine: { select: { address: true, agentLastSeenAt: true } },
            },
        });

        for (const node of candidates) {
            if (!node.machineUuid || !node.certificateMode || !node.machine) continue;
            const expired = Boolean(node.certificateExpiresAt && node.certificateExpiresAt <= now);
            if (expired && !node.certificateBlockedAt) {
                await this.prisma.$transaction([
                    this.prisma.nodes.update({
                        where: { uuid: node.uuid },
                        data: { certificateBlockedAt: now, certificateStatus: 'FAILED' },
                    }),
                    this.prisma.hosts.updateMany({
                        where: { nodes: { some: { nodeUuid: node.uuid } } },
                        data: { isDisabled: true },
                    }),
                ]);
            }
            if (
                !node.machine.agentLastSeenAt ||
                now.getTime() - node.machine.agentLastSeenAt.getTime() > 2 * 60 * 1_000
            ) {
                continue;
            }
            if (node.certificateMode === 'IMPORT_EXISTING') {
                if (!expired) {
                    if (node.lastStatusMessage !== 'IMPORTED_CERTIFICATE_EXPIRING') {
                        await this.prisma.nodes.update({
                            where: { uuid: node.uuid },
                            data: {
                                lastStatusMessage: 'IMPORTED_CERTIFICATE_EXPIRING',
                                lastStatusChange: now,
                            },
                        });
                    }
                    continue;
                }
                const stoppedAfterExpiry = await this.prisma.machineCommands.findFirst({
                    where: {
                        machineUuid: node.machineUuid,
                        kind: 'stop_instance',
                        createdAt: { gte: node.certificateBlockedAt ?? now },
                        payload: { path: ['instanceId'], equals: node.uuid },
                    },
                    select: { uuid: true },
                });
                if (!stoppedAfterExpiry) {
                    await queueCommand(
                        this.prisma,
                        node.machineUuid,
                        'stop_instance',
                        { instanceId: node.uuid },
                        now,
                    );
                }
                continue;
            }
            const recent = await this.prisma.machineCommands.findFirst({
                where: {
                    machineUuid: node.machineUuid,
                    kind: 'reconcile_certificate',
                    createdAt: { gte: recentlyAttempted },
                    payload: { path: ['instanceId'], equals: node.uuid },
                },
                select: { uuid: true },
            });
            if (recent) continue;

            const payload = certificatePayload(node, node.machine.address);
            if (!payload) {
                this.logger.error(
                    `Certificate metadata is incomplete for managed node ${node.uuid}`,
                );
                continue;
            }
            await this.prisma.$transaction(async (transaction) => {
                if (expired) {
                    await queueCommand(
                        transaction,
                        node.machineUuid!,
                        'stop_instance',
                        { instanceId: node.uuid },
                        now,
                    );
                }
                await queueCommand(
                    transaction,
                    node.machineUuid!,
                    'reconcile_certificate',
                    payload,
                    now,
                );
                if (!expired) {
                    await queueCommand(
                        transaction,
                        node.machineUuid!,
                        'stop_instance',
                        { instanceId: node.uuid },
                        now,
                    );
                }
                await queueCommand(
                    transaction,
                    node.machineUuid!,
                    'start_instance',
                    { instanceId: node.uuid },
                    now,
                );
                await transaction.nodes.update({
                    where: { uuid: node.uuid },
                    data: { certificateStatus: 'RENEWING' },
                });
            });
            await this.nodesQueuesService.startNode({ nodeUuid: node.uuid, force: true });
        }
    }
}

function certificatePayload(
    node: {
        uuid: string;
        certificateMode: string | null;
        protocolSettings: unknown;
    },
    machineAddress: string,
): Prisma.InputJsonValue | null {
    const settings = node.protocolSettings as Record<string, unknown>;
    if (typeof settings.domain !== 'string') return null;
    if (node.certificateMode === 'HTTP_01' && typeof settings.certificateEmail === 'string') {
        return {
            instanceId: node.uuid,
            mode: 'HTTP_01',
            domain: settings.domain,
            email: settings.certificateEmail,
            expectedAddress: machineAddress,
        };
    }
    if (
        node.certificateMode === 'IMPORT_EXISTING' &&
        typeof settings.certificatePath === 'string' &&
        typeof settings.privateKeyPath === 'string'
    ) {
        return {
            instanceId: node.uuid,
            mode: 'IMPORT_EXISTING',
            domain: settings.domain,
            certificatePath: settings.certificatePath,
            privateKeyPath: settings.privateKeyPath,
        };
    }
    return null;
}

async function queueCommand(
    transaction: Prisma.TransactionClient,
    machineUuid: string,
    kind: string,
    payload: Prisma.InputJsonValue,
    now: Date,
): Promise<void> {
    const uuid = randomUUID();
    await transaction.machineCommands.create({
        data: {
            uuid,
            machineUuid,
            kind,
            idempotencyKey: `${kind}:${uuid}`,
            payload,
            deadlineAt: new Date(now.getTime() + 45 * 60 * 1_000),
        },
    });
}
