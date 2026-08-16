import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@common/database/prisma.service';

import { MachineEntity } from '../entities/machine.entity';

@Injectable()
export class MachinesRepository {
    constructor(private readonly prisma: PrismaService) {}

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
        const result = await this.prisma.machines.updateMany({
            where: {
                uuid: input.uuid,
                archivedAt: null,
                clientCertExpiresAt: { gt: input.now },
            },
            data: {
                status: 'CONNECTED',
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

    async getReadyCommands(machineUuid: string, now: Date) {
        await this.prisma.machineCommands.updateMany({
            where: {
                machineUuid,
                status: { in: ['QUEUED', 'RUNNING'] },
                deadlineAt: { lte: now },
            },
            data: {
                status: 'FAILED',
                errorCode: 'COMMAND_DEADLINE_EXPIRED',
                completedAt: now,
            },
        });

        const commands = await this.prisma.machineCommands.findMany({
            where: {
                machineUuid,
                status: { in: ['QUEUED', 'RUNNING'] },
                deadlineAt: { gt: now },
            },
            orderBy: { createdAt: 'asc' },
            take: 16,
        });
        if (commands.length > 0) {
            await this.prisma.machineCommands.updateMany({
                where: { uuid: { in: commands.map((command) => command.uuid) } },
                data: { status: 'RUNNING', startedAt: now },
            });
        }
        return commands;
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
        const status = input.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
        const result = await this.prisma.machineCommands.updateMany({
            where: {
                uuid: input.commandUuid,
                machineUuid: input.machineUuid,
                idempotencyKey: input.idempotencyKey,
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
                completedAt: input.completedAt,
            },
        });
        if (result.count !== 1) {
            return false;
        }

        if (input.status === 'succeeded' && input.result !== undefined) {
            const command = await this.prisma.machineCommands.findUnique({
                where: { uuid: input.commandUuid },
                select: { kind: true },
            });
            if (command?.kind === 'inventory') {
                await this.prisma.machines.update({
                    where: { uuid: input.machineUuid },
                    data: { systemInfo: input.result as Prisma.InputJsonValue },
                });
            }
        }
        return true;
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
