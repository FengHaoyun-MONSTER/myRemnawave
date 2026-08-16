import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { MachineEntity } from '../entities/machine.entity';
import {
    NODE_IMAGE,
    PROTOCOL_TEMPLATES,
    ProtocolKey,
    SYSTEM_TEMPLATE_VERSION,
} from '../protocol-templates';

@Injectable()
export class MachinesRepository {
    constructor(private readonly prisma: PrismaService) {}

    async ensureSystemTemplates(): Promise<void> {
        await this.prisma.$transaction(async (transaction) => {
            await ensureProtocolProfiles(transaction);
        });
    }

    async create(data: Prisma.MachinesCreateInput): Promise<MachineEntity> {
        const result = await this.prisma.machines.create({ data });
        return new MachineEntity(result);
    }

    async findAll(): Promise<MachineEntity[]> {
        const result = await this.prisma.machines.findMany({
            where: { archivedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return result.map((machine) => new MachineEntity(machine));
    }

    async findByUuid(uuid: string): Promise<MachineEntity | null> {
        const result = await this.prisma.machines.findUnique({
            where: { uuid },
        });
        return result ? new MachineEntity(result) : null;
    }

    async provision(input: {
        machineUuid: string;
        protocols: Array<{
            protocol: ProtocolKey;
            remark?: string;
            externalPort: number;
            certificate?:
                | { mode: 'HTTP_01'; domain: string; email: string }
                | {
                      mode: 'IMPORT_EXISTING';
                      domain: string;
                      certificatePath: string;
                      privateKeyPath: string;
                  };
            serverName?: string;
            target?: string;
            congestion?: 'bbr' | 'brutal';
            upMbps?: number;
            downMbps?: number;
        }>;
        enableWarp: boolean;
        nodeSecrets: Partial<Record<ProtocolKey, string>>;
        now: Date;
    }): Promise<{ machine: MachineEntity; nodeUuids: string[]; commandUuids: string[] }> {
        return this.prisma.$transaction(async (transaction) => {
            const machine = await transaction.machines.findUnique({
                where: { uuid: input.machineUuid },
                include: {
                    nodes: {
                        select: {
                            protocolKey: true,
                            externalPort: true,
                            externalNetwork: true,
                        },
                    },
                },
            });
            if (!machine || machine.archivedAt) {
                throw new ProvisioningError('MACHINE_NOT_FOUND');
            }
            if (!machine.clientCertFingerprint || !machine.agentLastSeenAt) {
                throw new ProvisioningError('MACHINE_NOT_ENROLLED');
            }
            if (input.now.getTime() - machine.agentLastSeenAt.getTime() > 2 * 60 * 1_000) {
                throw new ProvisioningError('MACHINE_OFFLINE');
            }
            const requiredCapabilities = new Set([
                'preflight',
                'reconcile_instance',
                'apply_config',
            ]);
            if (input.protocols.some((item) => item.certificate)) {
                requiredCapabilities.add('reconcile_certificate');
            }
            if (input.enableWarp) {
                requiredCapabilities.add('reconcile_warp');
            }
            if (
                [...requiredCapabilities].some(
                    (capability) => !machine.agentCapabilities.includes(capability),
                )
            ) {
                throw new ProvisioningError('MACHINE_AGENT_CAPABILITY_MISSING');
            }
            const existingProtocols = new Set(machine.nodes.map((node) => node.protocolKey));
            if (input.protocols.some((item) => existingProtocols.has(item.protocol))) {
                throw new ProvisioningError('PROTOCOL_ALREADY_EXISTS');
            }
            const existingPorts = new Set(
                machine.nodes
                    .filter((node) => node.externalPort && node.externalNetwork)
                    .map((node) => `${node.externalNetwork}:${node.externalPort}`),
            );
            if (
                input.protocols.some((item) =>
                    existingPorts.has(
                        `${PROTOCOL_TEMPLATES[item.protocol].network}:${item.externalPort}`,
                    ),
                ) ||
                (input.protocols.some((item) => item.certificate?.mode === 'HTTP_01') &&
                    existingPorts.has('tcp:80'))
            ) {
                throw new ProvisioningError('PROTOCOL_PORT_CONFLICT');
            }

            const profiles = await ensureProtocolProfiles(transaction);

            const nodeUuids: string[] = [];
            const commandUuids: string[] = [];
            const ports = input.protocols.map((item) => ({
                port: item.externalPort,
                network: PROTOCOL_TEMPLATES[item.protocol].network,
            }));
            if (input.protocols.some((item) => item.certificate?.mode === 'HTTP_01')) {
                ports.push({ port: 80, network: 'tcp' });
            }
            commandUuids.push(
                await createCommand(
                    transaction,
                    input.machineUuid,
                    'preflight',
                    { ports },
                    input.now,
                ),
            );
            if (input.enableWarp) {
                commandUuids.push(
                    await createCommand(
                        transaction,
                        input.machineUuid,
                        'reconcile_warp',
                        { enabled: true, proxyPort: 40000 },
                        input.now,
                    ),
                );
            }

            for (const requested of input.protocols) {
                const template = PROTOCOL_TEMPLATES[requested.protocol];
                const profile = profiles.get(requested.protocol)!;
                const nodeSecret = input.nodeSecrets[requested.protocol];
                if (!nodeSecret) {
                    throw new ProvisioningError('NODE_CREDENTIALS_MISSING');
                }
                const certificate = requested.certificate;
                const nodeName = managedNodeName(machine.name, requested.protocol);
                const protocolSettings = {
                    ...(requested.protocol === 'VLESS_REALITY'
                        ? { serverName: requested.serverName, target: requested.target }
                        : {}),
                    ...(requested.protocol === 'HYSTERIA2'
                        ? {
                              ...(requested.congestion ? { congestion: requested.congestion } : {}),
                              ...(requested.upMbps ? { upMbps: requested.upMbps } : {}),
                              ...(requested.downMbps ? { downMbps: requested.downMbps } : {}),
                          }
                        : {}),
                    ...(certificate ? { domain: certificate.domain } : {}),
                    ...(certificate?.mode === 'HTTP_01'
                        ? { certificateEmail: certificate.email }
                        : certificate?.mode === 'IMPORT_EXISTING'
                          ? {
                                certificatePath: certificate.certificatePath,
                                privateKeyPath: certificate.privateKeyPath,
                            }
                          : {}),
                    warpEnabled: input.enableWarp,
                    templateVersion: SYSTEM_TEMPLATE_VERSION,
                };
                const node = await transaction.nodes.create({
                    data: {
                        name: nodeName,
                        address: machine.address,
                        port: template.controlPort,
                        machineUuid: machine.uuid,
                        protocolKey: requested.protocol,
                        lifecycleState: 'PROVISIONING',
                        externalPort: requested.externalPort,
                        externalNetwork: template.network,
                        protocolSettings,
                        desiredRevision: 0,
                        certificateMode: certificate?.mode ?? null,
                        certificateStatus: certificate ? 'PENDING' : 'NOT_REQUIRED',
                        countryCode: machine.countryCode,
                        tags: machine.tags,
                        activeConfigProfileUuid: profile.uuid,
                        configProfileInboundsToNodes: {
                            create: { configProfileInboundUuid: profile.inboundUuid },
                        },
                    },
                });
                nodeUuids.push(node.uuid);

                const hostAddress = certificate?.domain ?? machine.address;
                await transaction.hosts.create({
                    data: {
                        remark: requested.remark ?? nodeName,
                        address: hostAddress,
                        port: requested.externalPort,
                        sni:
                            requested.protocol === 'VLESS_REALITY'
                                ? requested.serverName
                                : certificate?.domain,
                        fingerprint: 'chrome',
                        isDisabled: true,
                        configProfileUuid: profile.uuid,
                        configProfileInboundUuid: profile.inboundUuid,
                        nodes: { create: { nodeUuid: node.uuid } },
                    },
                });

                if (certificate) {
                    commandUuids.push(
                        await createCommand(
                            transaction,
                            machine.uuid,
                            'reconcile_certificate',
                            {
                                instanceId: node.uuid,
                                ...(certificate.mode === 'HTTP_01'
                                    ? { expectedAddress: machine.address }
                                    : {}),
                                ...certificate,
                            },
                            input.now,
                        ),
                    );
                }
                commandUuids.push(
                    await createCommand(
                        transaction,
                        machine.uuid,
                        'reconcile_instance',
                        {
                            instanceId: node.uuid,
                            protocol: requested.protocol,
                            image: NODE_IMAGE,
                            controlPort: template.controlPort,
                            externalPort: requested.externalPort,
                            network: template.network,
                            secretKey: nodeSecret,
                        },
                        input.now,
                    ),
                );
            }

            const updated = await transaction.machines.update({
                where: { uuid: machine.uuid },
                data: {
                    status: 'PROVISIONING',
                    ...(input.enableWarp ? { warpStatus: 'INSTALLING' } : {}),
                },
            });
            return { machine: new MachineEntity(updated), nodeUuids, commandUuids };
        });
    }

    async retry(input: {
        machineUuid: string;
        nodeUuids: string[];
        nodeSecrets: Partial<Record<ProtocolKey, string>>;
        now: Date;
    }): Promise<{ machine: MachineEntity; nodeUuids: string[]; commandUuids: string[] }> {
        return this.prisma.$transaction(async (transaction) => {
            const machine = await transaction.machines.findUnique({
                where: { uuid: input.machineUuid },
                include: {
                    nodes: {
                        where: { uuid: { in: input.nodeUuids } },
                        select: {
                            uuid: true,
                            protocolKey: true,
                            port: true,
                            externalPort: true,
                            externalNetwork: true,
                            protocolSettings: true,
                            certificateMode: true,
                            certificateStatus: true,
                            certificateExpiresAt: true,
                            isPublished: true,
                        },
                    },
                },
            });
            if (!machine || machine.archivedAt) {
                throw new ProvisioningError('MACHINE_NOT_FOUND');
            }
            if (
                !machine.agentLastSeenAt ||
                input.now.getTime() - machine.agentLastSeenAt.getTime() > 2 * 60 * 1_000
            ) {
                throw new ProvisioningError('MACHINE_OFFLINE');
            }
            if (machine.nodes.length !== input.nodeUuids.length) {
                throw new ProvisioningError('RETRY_NODE_NOT_FOUND');
            }
            if (
                ['preflight', 'reconcile_instance', 'apply_config'].some(
                    (capability) => !machine.agentCapabilities.includes(capability),
                )
            ) {
                throw new ProvisioningError('MACHINE_AGENT_CAPABILITY_MISSING');
            }

            const commandUuids: string[] = [];
            const needsHTTP01 = machine.nodes.some(
                (node) =>
                    node.certificateMode === 'HTTP_01' &&
                    (node.certificateStatus !== 'VALID' ||
                        !node.certificateExpiresAt ||
                        node.certificateExpiresAt <= input.now),
            );
            commandUuids.push(
                await createCommand(
                    transaction,
                    machine.uuid,
                    'preflight',
                    { ports: needsHTTP01 ? [{ port: 80, network: 'tcp' }] : [] },
                    input.now,
                ),
            );

            const warpDesired = machine.nodes.some(
                (node) => (node.protocolSettings as Record<string, unknown>).warpEnabled === true,
            );
            if (warpDesired && machine.warpStatus !== 'CONNECTED') {
                if (!machine.agentCapabilities.includes('reconcile_warp')) {
                    throw new ProvisioningError('MACHINE_AGENT_CAPABILITY_MISSING');
                }
                commandUuids.push(
                    await createCommand(
                        transaction,
                        machine.uuid,
                        'reconcile_warp',
                        { enabled: true, proxyPort: 40000 },
                        input.now,
                    ),
                );
            }

            for (const node of machine.nodes) {
                if (
                    !node.protocolKey ||
                    !(node.protocolKey in PROTOCOL_TEMPLATES) ||
                    !node.port ||
                    !node.externalPort ||
                    !node.externalNetwork
                ) {
                    throw new ProvisioningError('RETRY_NODE_INVALID');
                }
                const protocol = node.protocolKey as ProtocolKey;
                const secretKey = input.nodeSecrets[protocol];
                if (!secretKey) throw new ProvisioningError('NODE_CREDENTIALS_MISSING');
                const active = await transaction.machineCommands.findFirst({
                    where: {
                        machineUuid: machine.uuid,
                        status: { in: ['QUEUED', 'RUNNING'] },
                        payload: { path: ['instanceId'], equals: node.uuid },
                    },
                    select: { uuid: true },
                });
                if (active) throw new ProvisioningError('RETRY_ALREADY_RUNNING');

                const certificateRequired =
                    node.certificateMode !== null &&
                    (node.certificateStatus !== 'VALID' ||
                        !node.certificateExpiresAt ||
                        node.certificateExpiresAt <= input.now);
                if (certificateRequired) {
                    if (!machine.agentCapabilities.includes('reconcile_certificate')) {
                        throw new ProvisioningError('MACHINE_AGENT_CAPABILITY_MISSING');
                    }
                    const certificate = managedCertificatePayload(node, machine.address);
                    if (!certificate) throw new ProvisioningError('RETRY_NODE_INVALID');
                    commandUuids.push(
                        await createCommand(
                            transaction,
                            machine.uuid,
                            'reconcile_certificate',
                            certificate,
                            input.now,
                        ),
                    );
                }
                commandUuids.push(
                    await createCommand(
                        transaction,
                        machine.uuid,
                        'reconcile_instance',
                        {
                            instanceId: node.uuid,
                            protocol,
                            image: NODE_IMAGE,
                            controlPort: node.port,
                            externalPort: node.externalPort,
                            network: node.externalNetwork,
                            secretKey,
                        },
                        input.now,
                    ),
                );
                await transaction.nodes.update({
                    where: { uuid: node.uuid },
                    data: {
                        lifecycleState: 'PROVISIONING',
                        isConnecting: false,
                        lastStatusMessage: null,
                        ...(certificateRequired ? { certificateStatus: 'PENDING' } : {}),
                    },
                });
            }

            const updated = await transaction.machines.update({
                where: { uuid: machine.uuid },
                data: {
                    status: 'PROVISIONING',
                    ...(warpDesired && machine.warpStatus !== 'CONNECTED'
                        ? { warpStatus: 'INSTALLING' }
                        : {}),
                },
            });
            return {
                machine: new MachineEntity(updated),
                nodeUuids: machine.nodes.map((node) => node.uuid),
                commandUuids,
            };
        });
    }

    async publish(input: {
        machineUuid: string;
        grants: Array<{ nodeUuid: string; internalSquadUuids: string[] }>;
        now: Date;
    }): Promise<{ machine: MachineEntity; publishedNodeUuids: string[] }> {
        return this.prisma.$transaction(async (transaction) => {
            const machine = await transaction.machines.findUnique({
                where: { uuid: input.machineUuid },
            });
            if (!machine || machine.archivedAt) {
                throw new ProvisioningError('MACHINE_NOT_FOUND');
            }

            const nodeUuids = input.grants.map((grant) => grant.nodeUuid);
            const nodes = await transaction.nodes.findMany({
                where: { machineUuid: input.machineUuid, uuid: { in: nodeUuids } },
                select: {
                    uuid: true,
                    protocolKey: true,
                    lifecycleState: true,
                    desiredRevision: true,
                    appliedRevision: true,
                    certificateMode: true,
                    certificateStatus: true,
                    certificateExpiresAt: true,
                    protocolSettings: true,
                },
            });
            if (nodes.length !== nodeUuids.length) {
                throw new ProvisioningError('PUBLISH_NODE_NOT_FOUND');
            }
            if (
                nodes.some(
                    (node) =>
                        !['CONFIG_VALIDATED', 'PUBLISHED'].includes(node.lifecycleState) ||
                        node.desiredRevision !== node.appliedRevision ||
                        (node.certificateMode !== null &&
                            (node.certificateStatus !== 'VALID' ||
                                !node.certificateExpiresAt ||
                                node.certificateExpiresAt <= input.now)),
                )
            ) {
                throw new ProvisioningError('PUBLISH_NODE_NOT_READY');
            }
            if (
                nodes.some((node) => {
                    const settings = node.protocolSettings as Record<string, unknown>;
                    return settings.warpEnabled === true;
                }) &&
                machine.warpStatus !== 'CONNECTED'
            ) {
                throw new ProvisioningError('PUBLISH_NODE_NOT_READY');
            }
            const realityNodeUuids = nodes
                .filter((node) => node.protocolKey === 'VLESS_REALITY')
                .map((node) => node.uuid);
            if (realityNodeUuids.length > 0) {
                const readyRealityHosts = await transaction.hosts.count({
                    where: {
                        nodes: { some: { nodeUuid: { in: realityNodeUuids } } },
                        realityPublicKey: { not: null },
                        realityShortId: { not: null },
                    },
                });
                if (readyRealityHosts !== realityNodeUuids.length) {
                    throw new ProvisioningError('PUBLISH_NODE_NOT_READY');
                }
            }

            const squadUuids = [
                ...new Set(input.grants.flatMap((grant) => grant.internalSquadUuids)),
            ];
            const squads = await transaction.internalSquads.count({
                where: { uuid: { in: squadUuids } },
            });
            if (squads !== squadUuids.length) {
                throw new ProvisioningError('PUBLISH_SQUAD_NOT_FOUND');
            }

            await transaction.internalSquadNodes.deleteMany({
                where: { nodeUuid: { in: nodeUuids } },
            });
            await transaction.internalSquadNodes.createMany({
                data: input.grants.flatMap((grant) =>
                    grant.internalSquadUuids.map((internalSquadUuid) => ({
                        internalSquadUuid,
                        nodeUuid: grant.nodeUuid,
                    })),
                ),
            });
            await transaction.nodes.updateMany({
                where: { uuid: { in: nodeUuids }, machineUuid: input.machineUuid },
                data: { isPublished: true, lifecycleState: 'PROVISIONING', isDisabled: false },
            });

            const updated = await transaction.machines.update({
                where: { uuid: input.machineUuid },
                data: { status: 'PROVISIONING' },
            });
            return {
                machine: new MachineEntity(updated),
                publishedNodeUuids: nodeUuids,
            };
        });
    }

    async findByEnrollmentTokenHash(hash: string): Promise<MachineEntity | null> {
        const result = await this.prisma.machines.findUnique({
            where: { enrollmentTokenHash: hash },
        });
        return result ? new MachineEntity(result) : null;
    }

    async replaceEnrollmentToken(
        uuid: string,
        tokenHash: string,
        expiresAt: Date,
    ): Promise<MachineEntity> {
        const result = await this.prisma.machines.update({
            where: { uuid },
            data: {
                status: 'DRAFT',
                enrollmentTokenHash: tokenHash,
                enrollmentExpiresAt: expiresAt,
                enrollmentUsedAt: null,
            },
        });
        return new MachineEntity(result);
    }

    async consumeEnrollmentToken(input: {
        uuid: string;
        tokenHash: string;
        now: Date;
        certificateSerial: string;
        certificateFingerprint: string;
        certificateExpiresAt: Date;
    }): Promise<boolean> {
        const result = await this.prisma.machines.updateMany({
            where: {
                uuid: input.uuid,
                enrollmentTokenHash: input.tokenHash,
                enrollmentUsedAt: null,
                enrollmentExpiresAt: { gt: input.now },
                archivedAt: null,
            },
            data: {
                status: 'ENROLLING',
                enrollmentTokenHash: null,
                enrollmentUsedAt: input.now,
                clientCertSerial: input.certificateSerial,
                clientCertFingerprint: input.certificateFingerprint,
                clientCertExpiresAt: input.certificateExpiresAt,
            },
        });
        return result.count === 1;
    }

    async getCertificateAuthority(): Promise<{
        caCert: string;
        caKey: string;
    } | null> {
        const result = await this.prisma.keygen.findFirst({
            where: { caCert: { not: null }, caKey: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { caCert: true, caKey: true },
        });
        if (!result?.caCert || !result.caKey) {
            return null;
        }
        return { caCert: result.caCert, caKey: result.caKey };
    }

    async markAgentConnected(input: {
        uuid: string;
        agentVersion: string;
        capabilities: string[];
        now: Date;
    }): Promise<boolean> {
        const machine = await this.prisma.machines.findUnique({
            where: { uuid: input.uuid },
            select: { status: true },
        });
        if (!machine) return false;
        const nextStatus = ['DRAFT', 'ENROLLING', 'CONNECTED'].includes(machine.status)
            ? 'CONNECTED'
            : machine.status;
        const result = await this.prisma.machines.updateMany({
            where: {
                uuid: input.uuid,
                archivedAt: null,
                clientCertExpiresAt: { gt: input.now },
            },
            data: {
                status: nextStatus,
                agentVersion: input.agentVersion,
                agentCapabilities: input.capabilities,
                agentConnectedAt: input.now,
                agentLastSeenAt: input.now,
            },
        });
        return result.count === 1;
    }

    async markAgentHeartbeat(uuid: string, now: Date): Promise<boolean> {
        const result = await this.prisma.machines.updateMany({
            where: { uuid, archivedAt: null, clientCertExpiresAt: { gt: now } },
            data: { agentLastSeenAt: now },
        });
        return result.count === 1;
    }

    async ensureInventoryCommand(machineUuid: string, now: Date): Promise<void> {
        const active = await this.prisma.machineCommands.findFirst({
            where: {
                machineUuid,
                kind: 'inventory',
                status: { in: ['QUEUED', 'RUNNING'] },
                deadlineAt: { gt: now },
            },
            select: { uuid: true },
        });
        if (active) {
            return;
        }
        const commandUuid = randomUUID();
        await this.prisma.machineCommands.create({
            data: {
                uuid: commandUuid,
                machineUuid,
                kind: 'inventory',
                idempotencyKey: `inventory:${commandUuid}`,
                payload: {},
                deadlineAt: new Date(now.getTime() + 2 * 60 * 1_000),
            },
        });
    }

    async ensureWarpCommand(machineUuid: string, now: Date): Promise<void> {
        const desiredNode = await this.prisma.nodes.findFirst({
            where: {
                machineUuid,
                protocolSettings: { path: ['warpEnabled'], equals: true },
            },
            select: { uuid: true },
        });
        if (!desiredNode) return;

        const machine = await this.prisma.machines.findUnique({
            where: { uuid: machineUuid },
            select: { warpStatus: true, warpLastChecked: true },
        });
        if (
            !machine ||
            (machine.warpLastChecked &&
                now.getTime() - machine.warpLastChecked.getTime() < 2 * 60 * 1_000)
        ) {
            return;
        }
        const activeWarp = await this.prisma.machineCommands.findFirst({
            where: {
                machineUuid,
                kind: 'reconcile_warp',
                status: { in: ['QUEUED', 'RUNNING'] },
                deadlineAt: { gt: now },
            },
            select: { uuid: true },
        });
        if (activeWarp) return;
        await this.prisma.$transaction(async (transaction) => {
            await createCommand(
                transaction,
                machineUuid,
                'reconcile_warp',
                { enabled: true, proxyPort: 40000 },
                now,
            );
            if (machine.warpStatus === 'FAILED') {
                await transaction.machines.update({
                    where: { uuid: machineUuid },
                    data: { warpStatus: 'RECOVERING' },
                });
            }
        });
    }

    async getReadyCommands(machineUuid: string, now: Date) {
        const expiredCommands = await this.prisma.machineCommands.findMany({
            where: {
                machineUuid,
                status: { in: ['QUEUED', 'RUNNING'] },
                deadlineAt: { lte: now },
            },
            select: { uuid: true, idempotencyKey: true },
        });
        for (const command of expiredCommands) {
            await this.completeCommand({
                machineUuid,
                commandUuid: command.uuid,
                idempotencyKey: command.idempotencyKey,
                status: 'failed',
                errorCode: 'COMMAND_DEADLINE_EXPIRED',
                result: null,
                completedAt: now,
            });
        }

        return this.prisma.$transaction(async (transaction) => {
            const command = await transaction.machineCommands.findFirst({
                where: {
                    machineUuid,
                    status: 'QUEUED',
                    deadlineAt: { gt: now },
                },
                orderBy: { queueSequence: 'asc' },
            });
            if (!command) return [];
            const claimed = await transaction.machineCommands.updateMany({
                where: { uuid: command.uuid, status: 'QUEUED' },
                data: { status: 'RUNNING', startedAt: now },
            });
            return claimed.count === 1 ? [command] : [];
        });
    }

    async resetRunningCommands(machineUuid: string): Promise<void> {
        await this.prisma.machineCommands.updateMany({
            where: { machineUuid, status: 'RUNNING' },
            data: { status: 'QUEUED', startedAt: null },
        });
    }

    async completeCommand(input: {
        machineUuid: string;
        commandUuid: string;
        idempotencyKey: string;
        status: 'succeeded' | 'failed' | 'unsupported';
        errorCode?: string;
        result?: unknown;
        completedAt: Date;
    }): Promise<boolean> {
        return this.prisma.$transaction(async (transaction) => {
            const command = await transaction.machineCommands.findFirst({
                where: {
                    uuid: input.commandUuid,
                    machineUuid: input.machineUuid,
                    idempotencyKey: input.idempotencyKey,
                    status: { in: ['QUEUED', 'RUNNING'] },
                },
                select: { kind: true, payload: true },
            });
            if (!command) return false;

            const status = input.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
            const payload = command.payload as Record<string, unknown>;
            const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId : null;
            if (
                input.status === 'succeeded' &&
                instanceId &&
                input.result &&
                typeof input.result === 'object' &&
                'instanceId' in input.result &&
                input.result.instanceId !== instanceId
            ) {
                return false;
            }
            const scrubPayload = [
                'reconcile_instance',
                'reconcile_certificate',
                'apply_config',
            ].includes(command.kind);
            const result = await transaction.machineCommands.updateMany({
                where: {
                    uuid: input.commandUuid,
                    status: { in: ['QUEUED', 'RUNNING'] },
                },
                data: {
                    status,
                    errorCode:
                        input.status === 'unsupported'
                            ? (input.errorCode ?? 'CAPABILITY_NOT_AVAILABLE')
                            : (input.errorCode ?? null),
                    result:
                        input.result === undefined || input.result === null
                            ? Prisma.JsonNull
                            : (input.result as Prisma.InputJsonValue),
                    payload: scrubPayload
                        ? ({ redacted: true, instanceId } as Prisma.InputJsonValue)
                        : undefined,
                    completedAt: input.completedAt,
                },
            });
            if (result.count !== 1) return false;

            if (input.status === 'succeeded' && input.result !== undefined) {
                if (command.kind === 'inventory') {
                    await transaction.machines.update({
                        where: { uuid: input.machineUuid },
                        data: { systemInfo: input.result as Prisma.InputJsonValue },
                    });
                } else if (command.kind === 'reconcile_instance' && instanceId) {
                    const reconcileResult = input.result as {
                        realityPublicKey?: string;
                        realityShortId?: string;
                    };
                    await transaction.nodes.updateMany({
                        where: { uuid: instanceId, machineUuid: input.machineUuid },
                        data: { lastStatusMessage: null, lastStatusChange: input.completedAt },
                    });
                    if (reconcileResult.realityPublicKey && reconcileResult.realityShortId) {
                        await transaction.hosts.updateMany({
                            where: { nodes: { some: { nodeUuid: instanceId } } },
                            data: {
                                realityPublicKey: reconcileResult.realityPublicKey,
                                realityShortId: reconcileResult.realityShortId,
                            },
                        });
                    }
                } else if (command.kind === 'reconcile_certificate' && instanceId) {
                    const certificateResult = input.result as { expiresAt: string };
                    const certificateNode = await transaction.nodes.findFirst({
                        where: { uuid: instanceId, machineUuid: input.machineUuid },
                        select: { isPublished: true, certificateBlockedAt: true },
                    });
                    await transaction.nodes.updateMany({
                        where: { uuid: instanceId, machineUuid: input.machineUuid },
                        data: {
                            certificateStatus: 'VALID',
                            certificateExpiresAt: new Date(certificateResult.expiresAt),
                            certificateBlockedAt: null,
                            lastStatusMessage: null,
                            lastStatusChange: input.completedAt,
                        },
                    });
                    if (certificateNode?.isPublished && certificateNode.certificateBlockedAt) {
                        await transaction.hosts.updateMany({
                            where: { nodes: { some: { nodeUuid: instanceId } } },
                            data: { isDisabled: false },
                        });
                    }
                } else if (command.kind === 'reconcile_warp') {
                    await transaction.nodes.updateMany({
                        where: {
                            machineUuid: input.machineUuid,
                            isPublished: true,
                            lifecycleState: 'DEGRADED',
                            protocolSettings: { path: ['warpEnabled'], equals: true },
                        },
                        data: {
                            lifecycleState: 'PUBLISHED',
                            lastStatusMessage: null,
                            lastStatusChange: input.completedAt,
                        },
                    });
                    const unpublished = await transaction.nodes.count({
                        where: { machineUuid: input.machineUuid, isPublished: false },
                    });
                    const published = await transaction.nodes.count({
                        where: { machineUuid: input.machineUuid, isPublished: true },
                    });
                    const failed = await transaction.nodes.count({
                        where: {
                            machineUuid: input.machineUuid,
                            lifecycleState: { in: ['FAILED', 'DEGRADED'] },
                        },
                    });
                    await transaction.machines.update({
                        where: { uuid: input.machineUuid },
                        data: {
                            warpStatus: 'CONNECTED',
                            warpProxyPort: 40000,
                            warpLastChecked: input.completedAt,
                            ...(failed > 0
                                ? { status: published > 0 ? 'DEGRADED' : 'FAILED' }
                                : published > 0
                                  ? {
                                        status:
                                            unpublished === 0 ? 'PUBLISHED' : 'CONFIG_VALIDATED',
                                    }
                                  : {}),
                        },
                    });
                } else if (command.kind === 'apply_config' && instanceId) {
                    const targetNode = await transaction.nodes.findFirst({
                        where: { uuid: instanceId, machineUuid: input.machineUuid },
                        select: {
                            desiredRevision: true,
                            isPublished: true,
                            certificateMode: true,
                            certificateStatus: true,
                            certificateExpiresAt: true,
                            certificateBlockedAt: true,
                        },
                    });
                    if (targetNode) {
                        const requestedRevision =
                            typeof payload.revision === 'number' &&
                            Number.isInteger(payload.revision) &&
                            payload.revision >= 0 &&
                            payload.revision <= targetNode.desiredRevision
                                ? payload.revision
                                : targetNode.desiredRevision;
                        const caughtUp = requestedRevision === targetNode.desiredRevision;
                        await transaction.nodes.update({
                            where: { uuid: instanceId },
                            data: {
                                appliedRevision: requestedRevision,
                                lifecycleState: caughtUp
                                    ? targetNode.isPublished
                                        ? 'PUBLISHED'
                                        : 'CONFIG_VALIDATED'
                                    : 'PROVISIONING',
                                isConnected: true,
                                isConnecting: !caughtUp,
                                lastStatusMessage: null,
                                lastStatusChange: input.completedAt,
                            },
                        });
                        const certificateReady =
                            targetNode.certificateMode === null ||
                            (targetNode.certificateStatus === 'VALID' &&
                                targetNode.certificateExpiresAt !== null &&
                                targetNode.certificateExpiresAt > input.completedAt &&
                                targetNode.certificateBlockedAt === null);
                        if (targetNode.isPublished && caughtUp && certificateReady) {
                            await transaction.hosts.updateMany({
                                where: { nodes: { some: { nodeUuid: instanceId } } },
                                data: { isDisabled: false },
                            });
                        }
                    }
                    const pendingNodes = await transaction.nodes.count({
                        where: {
                            machineUuid: input.machineUuid,
                            lifecycleState: { notIn: ['CONFIG_VALIDATED', 'PUBLISHED'] },
                        },
                    });
                    if (pendingNodes === 0) {
                        const unpublished = await transaction.nodes.count({
                            where: { machineUuid: input.machineUuid, isPublished: false },
                        });
                        await transaction.machines.update({
                            where: { uuid: input.machineUuid },
                            data: { status: unpublished === 0 ? 'PUBLISHED' : 'CONFIG_VALIDATED' },
                        });
                    }
                }
            } else if (
                instanceId &&
                command.kind === 'apply_config' &&
                payload.failClosedOnError === true
            ) {
                await transaction.machineCommands.updateMany({
                    where: {
                        machineUuid: input.machineUuid,
                        status: 'QUEUED',
                        payload: { path: ['instanceId'], equals: instanceId },
                    },
                    data: {
                        status: 'CANCELLED',
                        errorCode: 'AUTHORIZATION_CONFIG_FAILED',
                        completedAt: input.completedAt,
                    },
                });
                await createCommand(
                    transaction,
                    input.machineUuid,
                    'stop_instance',
                    { instanceId },
                    input.completedAt,
                );
                await transaction.nodes.updateMany({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    data: {
                        lifecycleState: 'FAILED',
                        isConnected: false,
                        isConnecting: false,
                        lastStatusMessage: input.errorCode ?? 'AUTHORIZATION_CONFIG_FAILED',
                        lastStatusChange: input.completedAt,
                    },
                });
                await transaction.hosts.updateMany({
                    where: { nodes: { some: { nodeUuid: instanceId } } },
                    data: { isDisabled: true },
                });
                const healthyPublishedSiblings = await transaction.nodes.count({
                    where: {
                        machineUuid: input.machineUuid,
                        uuid: { not: instanceId },
                        isPublished: true,
                        lifecycleState: { notIn: ['FAILED', 'DEGRADED'] },
                    },
                });
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { status: healthyPublishedSiblings > 0 ? 'DEGRADED' : 'FAILED' },
                });
            } else if (instanceId && command.kind === 'reconcile_certificate') {
                const certificateNode = await transaction.nodes.findFirst({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    select: { isPublished: true, certificateExpiresAt: true },
                });
                const existingCertificateIsValid = Boolean(
                    certificateNode?.isPublished &&
                    certificateNode.certificateExpiresAt &&
                    certificateNode.certificateExpiresAt > input.completedAt,
                );
                await transaction.nodes.updateMany({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    data: {
                        lifecycleState: existingCertificateIsValid ? 'PUBLISHED' : 'FAILED',
                        certificateStatus: 'FAILED',
                        certificateBlockedAt: existingCertificateIsValid ? null : input.completedAt,
                        isConnecting: false,
                        isConnected: existingCertificateIsValid,
                        lastStatusMessage: input.errorCode ?? 'CERTIFICATE_RECONCILE_FAILED',
                        lastStatusChange: input.completedAt,
                    },
                });
                await transaction.machineCommands.updateMany({
                    where: {
                        machineUuid: input.machineUuid,
                        status: 'QUEUED',
                        payload: { path: ['instanceId'], equals: instanceId },
                    },
                    data: {
                        status: 'CANCELLED',
                        errorCode: input.errorCode ?? 'INSTANCE_DEPENDENCY_FAILED',
                        completedAt: input.completedAt,
                    },
                });
                if (!existingCertificateIsValid) {
                    await transaction.hosts.updateMany({
                        where: { nodes: { some: { nodeUuid: instanceId } } },
                        data: { isDisabled: true },
                    });
                }
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { status: existingCertificateIsValid ? 'DEGRADED' : 'FAILED' },
                });
            } else if (
                instanceId &&
                command.kind === 'apply_config' &&
                input.errorCode === 'CONFIG_APPLY_FAILED_ROLLED_BACK'
            ) {
                const rolledBackNode = await transaction.nodes.findFirst({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    select: { isPublished: true },
                });
                await transaction.nodes.updateMany({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    data: {
                        lifecycleState: rolledBackNode?.isPublished ? 'PUBLISHED' : 'FAILED',
                        isConnected: Boolean(rolledBackNode?.isPublished),
                        isConnecting: false,
                        lastStatusMessage: input.errorCode,
                        lastStatusChange: input.completedAt,
                    },
                });
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { status: rolledBackNode?.isPublished ? 'DEGRADED' : 'FAILED' },
                });
            } else if (instanceId) {
                const publishedNodes = await transaction.nodes.count({
                    where: { machineUuid: input.machineUuid, isPublished: true },
                });
                await transaction.nodes.updateMany({
                    where: { uuid: instanceId, machineUuid: input.machineUuid },
                    data: {
                        lifecycleState: 'FAILED',
                        isConnecting: false,
                        isConnected: false,
                        ...(command.kind === 'reconcile_certificate'
                            ? { certificateStatus: 'FAILED' }
                            : {}),
                        lastStatusMessage: input.errorCode ?? 'Machine command failed',
                        lastStatusChange: input.completedAt,
                    },
                });
                if (command.kind === 'apply_config') {
                    await transaction.hosts.updateMany({
                        where: { nodes: { some: { nodeUuid: instanceId } } },
                        data: { isDisabled: true },
                    });
                }
                await transaction.machineCommands.updateMany({
                    where: {
                        machineUuid: input.machineUuid,
                        status: 'QUEUED',
                        payload: { path: ['instanceId'], equals: instanceId },
                    },
                    data: {
                        status: 'CANCELLED',
                        errorCode: input.errorCode ?? 'INSTANCE_DEPENDENCY_FAILED',
                        completedAt: input.completedAt,
                    },
                });
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { status: publishedNodes > 0 ? 'DEGRADED' : 'FAILED' },
                });
            } else if (command.kind === 'reconcile_warp') {
                const publishedNodes = await transaction.nodes.count({
                    where: { machineUuid: input.machineUuid, isPublished: true },
                });
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: {
                        warpStatus: 'FAILED',
                        warpLastChecked: input.completedAt,
                        status: publishedNodes > 0 ? 'DEGRADED' : 'FAILED',
                    },
                });
                await transaction.nodes.updateMany({
                    where: {
                        machineUuid: input.machineUuid,
                        isPublished: true,
                        protocolSettings: { path: ['warpEnabled'], equals: true },
                    },
                    data: {
                        lifecycleState: 'DEGRADED',
                        lastStatusMessage: input.errorCode ?? 'WARP_HEALTH_CHECK_FAILED',
                        lastStatusChange: input.completedAt,
                    },
                });
            }
            if (command.kind === 'preflight' && input.status !== 'succeeded') {
                await transaction.machineCommands.updateMany({
                    where: { machineUuid: input.machineUuid, status: 'QUEUED' },
                    data: {
                        status: 'CANCELLED',
                        errorCode: 'PREFLIGHT_FAILED',
                        completedAt: input.completedAt,
                    },
                });
                await transaction.nodes.updateMany({
                    where: { machineUuid: input.machineUuid },
                    data: {
                        lifecycleState: 'FAILED',
                        isConnected: false,
                        isConnecting: false,
                        lastStatusMessage: 'Machine preflight failed',
                        lastStatusChange: input.completedAt,
                    },
                });
                await transaction.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { status: 'FAILED' },
                });
            }
            return true;
        });
    }

    async getActiveCommandKind(
        machineUuid: string,
        commandUuid: string,
        idempotencyKey: string,
    ): Promise<string | null> {
        const command = await this.prisma.machineCommands.findFirst({
            where: {
                uuid: commandUuid,
                machineUuid,
                idempotencyKey,
                status: { in: ['QUEUED', 'RUNNING'] },
            },
            select: { kind: true },
        });
        return command?.kind ?? null;
    }
}

export class ProvisioningError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
    }
}

function managedCertificatePayload(
    node: { uuid: string; certificateMode: string | null; protocolSettings: unknown },
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

function managedNodeName(machineName: string, protocol: ProtocolKey): string {
    const suffix: Record<ProtocolKey, string> = {
        VLESS_REALITY: 'Reality',
        VLESS_TLS_VISION: 'TLSVision',
        HYSTERIA2: 'Hysteria2',
    };
    return `${machineName.slice(0, 18)}-${suffix[protocol]}`;
}

async function createCommand(
    transaction: Prisma.TransactionClient,
    machineUuid: string,
    kind: string,
    payload: Prisma.InputJsonValue,
    now: Date,
): Promise<string> {
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
    return uuid;
}

async function ensureProtocolProfiles(
    transaction: Prisma.TransactionClient,
): Promise<Map<ProtocolKey, { uuid: string; inboundUuid: string }>> {
    const profiles = new Map<ProtocolKey, { uuid: string; inboundUuid: string }>();
    for (const template of Object.values(PROTOCOL_TEMPLATES)) {
        let profile = await transaction.configProfiles.findUnique({
            where: {
                templateKey_templateVersion: {
                    templateKey: template.key,
                    templateVersion: SYSTEM_TEMPLATE_VERSION,
                },
            },
            include: { configProfileInbounds: true },
        });
        if (!profile) {
            profile = await transaction.configProfiles.create({
                data: {
                    uuid: template.uuid,
                    name: template.name,
                    config: template.config as Prisma.InputJsonValue,
                    templateKey: template.key,
                    templateVersion: SYSTEM_TEMPLATE_VERSION,
                    isSystem: true,
                    isImmutable: true,
                    configProfileInbounds: {
                        create: {
                            tag: template.key,
                            type: template.key === 'HYSTERIA2' ? 'hysteria' : 'vless',
                            network: template.key === 'HYSTERIA2' ? 'hysteria' : 'raw',
                            security: template.key === 'VLESS_REALITY' ? 'reality' : 'tls',
                            port: template.externalPort,
                            rawInbound: (
                                template.config.inbounds as unknown[]
                            )[0] as Prisma.InputJsonValue,
                        },
                    },
                },
                include: { configProfileInbounds: true },
            });
        }
        const inbound = profile.configProfileInbounds[0];
        if (
            !profile.isSystem ||
            !profile.isImmutable ||
            profile.templateKey !== template.key ||
            profile.templateVersion !== SYSTEM_TEMPLATE_VERSION ||
            !inbound ||
            profile.configProfileInbounds.length !== 1
        ) {
            throw new ProvisioningError('SYSTEM_TEMPLATE_INVALID');
        }
        profiles.set(template.key, { uuid: profile.uuid, inboundUuid: inbound.uuid });
    }
    return profiles;
}
