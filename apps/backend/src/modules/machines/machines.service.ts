import { createHash, randomBytes } from 'node:crypto';

import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';
import { generateMachineClientCertificate } from '@common/utils/certs/generate-machine-client-cert.util';

import { KeygenService } from '@modules/keygen/keygen.service';

import { NodesQueuesService } from '@queue/_nodes';

import {
    CreateMachineBodyDto,
    EnrollMachineBodyDto,
    ProvisionMachineBodyDto,
    PublishMachineBodyDto,
    RetryMachineBodyDto,
} from './dtos/machines.dto';
import { MachineControlGateway } from './machine-control.gateway';
import { MachineResponseModel } from './models/machine.response.model';
import { PROTOCOL_KEYS } from './protocol-templates';
import { MachinesRepository, ProvisioningError } from './repositories/machines.repository';

const ENROLLMENT_TTL_MS = 15 * 60 * 1_000;

@Injectable()
export class MachinesService {
    constructor(
        private readonly machinesRepository: MachinesRepository,
        private readonly config: TypedConfigService,
        private readonly machineControlGateway: MachineControlGateway,
        private readonly keygenService: KeygenService,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}

    async createMachine(dto: CreateMachineBodyDto) {
        const enrollment = this.createEnrollmentSecret();
        try {
            const machine = await this.machinesRepository.create({
                name: dto.name,
                address: dto.address,
                countryCode: dto.countryCode,
                tags: dto.tags,
                note: dto.note ?? null,
                enrollmentTokenHash: enrollment.hash,
                enrollmentExpiresAt: enrollment.expiresAt,
            });
            return {
                machine: new MachineResponseModel(machine),
                enrollmentToken: enrollment.token,
                enrollmentExpiresAt: enrollment.expiresAt,
            };
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                throw new ConflictException('A machine with this name or address already exists');
            }
            throw error;
        }
    }

    async getMachines(): Promise<MachineResponseModel[]> {
        const machines = await this.machinesRepository.findAll();
        return machines.map((machine) => new MachineResponseModel(machine));
    }

    async getMachine(uuid: string): Promise<MachineResponseModel> {
        const machine = await this.machinesRepository.findByUuid(uuid);
        if (!machine || machine.archivedAt) {
            throw new NotFoundException('Machine not found');
        }
        return new MachineResponseModel(machine);
    }

    async rotateEnrollmentToken(uuid: string) {
        const machine = await this.machinesRepository.findByUuid(uuid);
        if (!machine || machine.archivedAt) {
            throw new NotFoundException('Machine not found');
        }
        if (machine.clientCertFingerprint) {
            throw new ConflictException(
                'This machine is already enrolled; use certificate rotation instead',
            );
        }

        const enrollment = this.createEnrollmentSecret();
        const updated = await this.machinesRepository.replaceEnrollmentToken(
            uuid,
            enrollment.hash,
            enrollment.expiresAt,
        );
        return {
            machine: new MachineResponseModel(updated),
            enrollmentToken: enrollment.token,
            enrollmentExpiresAt: enrollment.expiresAt,
        };
    }

    async enroll(dto: EnrollMachineBodyDto) {
        const controlUrl = this.config.get('MACHINE_CONTROL_PUBLIC_URL');
        if (!controlUrl) {
            throw new ServiceUnavailableException('Machine control URL is not configured');
        }

        const tokenHash = hashEnrollmentToken(dto.enrollmentToken);
        const machine = await this.machinesRepository.findByEnrollmentTokenHash(tokenHash);
        const now = new Date();
        if (
            !machine ||
            machine.archivedAt ||
            machine.enrollmentUsedAt ||
            !machine.enrollmentExpiresAt ||
            machine.enrollmentExpiresAt <= now
        ) {
            throw new UnauthorizedException('Enrollment token is invalid or expired');
        }

        const certificateAuthority = await this.machinesRepository.getCertificateAuthority();
        if (!certificateAuthority) {
            throw new ServiceUnavailableException('Machine certificate authority is unavailable');
        }

        let certificate;
        try {
            certificate = await generateMachineClientCertificate(
                dto.csrPem,
                machine.uuid,
                certificateAuthority.caCert,
                certificateAuthority.caKey,
                now,
            );
        } catch {
            throw new BadRequestException('CSR is invalid or uses an unsupported key algorithm');
        }

        const consumed = await this.machinesRepository.consumeEnrollmentToken({
            uuid: machine.uuid,
            tokenHash,
            now,
            certificateSerial: certificate.serialNumber,
            certificateFingerprint: certificate.fingerprintSha256,
            certificateExpiresAt: certificate.expiresAt,
        });
        if (!consumed) {
            throw new UnauthorizedException('Enrollment token is invalid or expired');
        }

        return {
            machineUuid: machine.uuid,
            clientCertPem: certificate.certificatePem,
            caCertPem: certificateAuthority.caCert,
            controlUrl,
            expiresAt: certificate.expiresAt,
        };
    }

    async provision(uuid: string, dto: ProvisionMachineBodyDto) {
        try {
            const generatedCredentials = await Promise.all(
                dto.protocols.map(async (protocol) => ({
                    protocol: protocol.protocol,
                    credentials: await this.keygenService.generateKey(),
                })),
            );
            if (generatedCredentials.some((item) => !item.credentials.isOk)) {
                throw new ServiceUnavailableException('Node credentials are unavailable');
            }
            const nodeSecrets = Object.fromEntries(
                generatedCredentials.map((item) => [
                    item.protocol,
                    item.credentials.isOk ? item.credentials.response.payload : '',
                ]),
            );
            const result = await this.machinesRepository.provision({
                machineUuid: uuid,
                protocols: dto.protocols,
                enableWarp: dto.enableWarp,
                nodeSecrets,
                now: new Date(),
            });
            await Promise.all(
                result.nodeUuids.map((nodeUuid) =>
                    this.nodesQueuesService.startNode({
                        nodeUuid,
                        force: true,
                        managedConfigUpdate: true,
                    }),
                ),
            );
            await this.machineControlGateway.dispatchReady(uuid);
            return {
                machine: new MachineResponseModel(result.machine),
                nodeUuids: result.nodeUuids,
                commandUuids: result.commandUuids,
            };
        } catch (error) {
            if (error instanceof ProvisioningError) {
                switch (error.reason) {
                    case 'MACHINE_NOT_FOUND':
                        throw new NotFoundException('Machine not found');
                    case 'MACHINE_NOT_ENROLLED':
                        throw new ConflictException('Machine Agent has not enrolled yet');
                    case 'MACHINE_OFFLINE':
                        throw new ConflictException('Machine Agent is offline');
                    case 'MACHINE_AGENT_CAPABILITY_MISSING':
                        throw new ConflictException(
                            'Machine Agent must be upgraded before provisioning these features',
                        );
                    case 'PROTOCOL_ALREADY_EXISTS':
                        throw new ConflictException(
                            'One of the requested protocols already exists on this machine',
                        );
                    case 'PROTOCOL_PORT_CONFLICT':
                        throw new ConflictException(
                            'A requested protocol port conflicts with an existing managed node',
                        );
                    case 'SYSTEM_TEMPLATE_INVALID':
                        throw new ServiceUnavailableException(
                            'System protocol template is invalid',
                        );
                    case 'NODE_CREDENTIALS_MISSING':
                        throw new ServiceUnavailableException('Node credentials are unavailable');
                }
            }
            if (isUniqueConstraintViolation(error)) {
                throw new ConflictException('Provisioning conflicts with an existing node or host');
            }
            throw error;
        }
    }

    async publish(uuid: string, dto: PublishMachineBodyDto) {
        try {
            const result = await this.machinesRepository.publish({
                machineUuid: uuid,
                grants: dto.grants,
                now: new Date(),
            });
            await Promise.all(
                result.publishedNodeUuids.map((nodeUuid) =>
                    this.nodesQueuesService.startNode({
                        nodeUuid,
                        force: false,
                        managedConfigUpdate: true,
                        failClosedOnError: true,
                    }),
                ),
            );
            return {
                machine: new MachineResponseModel(result.machine),
                publishedNodeUuids: result.publishedNodeUuids,
            };
        } catch (error) {
            if (error instanceof ProvisioningError) {
                switch (error.reason) {
                    case 'MACHINE_NOT_FOUND':
                        throw new NotFoundException('Machine not found');
                    case 'PUBLISH_NODE_NOT_FOUND':
                        throw new BadRequestException(
                            'Every published node must belong to this machine',
                        );
                    case 'PUBLISH_NODE_NOT_READY':
                        throw new ConflictException(
                            'Every node must have a validated applied configuration and certificate',
                        );
                    case 'PUBLISH_SQUAD_NOT_FOUND':
                        throw new BadRequestException('One or more internal squads do not exist');
                }
            }
            throw error;
        }
    }

    async retry(uuid: string, dto: RetryMachineBodyDto) {
        try {
            const generatedCredentials = await Promise.all(
                PROTOCOL_KEYS.map(async (protocol) => ({
                    protocol,
                    credentials: await this.keygenService.generateKey(),
                })),
            );
            if (generatedCredentials.some((item) => !item.credentials.isOk)) {
                throw new ServiceUnavailableException('Node credentials are unavailable');
            }
            const nodeSecrets = Object.fromEntries(
                generatedCredentials.map((item) => [
                    item.protocol,
                    item.credentials.isOk ? item.credentials.response.payload : '',
                ]),
            );
            const result = await this.machinesRepository.retry({
                machineUuid: uuid,
                nodeUuids: dto.nodeUuids,
                nodeSecrets,
                now: new Date(),
            });
            await Promise.all(
                result.nodeUuids.map((nodeUuid) =>
                    this.nodesQueuesService.startNode({
                        nodeUuid,
                        force: true,
                        managedConfigUpdate: true,
                    }),
                ),
            );
            await this.machineControlGateway.dispatchReady(uuid);
            return {
                machine: new MachineResponseModel(result.machine),
                nodeUuids: result.nodeUuids,
                commandUuids: result.commandUuids,
            };
        } catch (error) {
            if (error instanceof ProvisioningError) {
                switch (error.reason) {
                    case 'MACHINE_NOT_FOUND':
                        throw new NotFoundException('Machine not found');
                    case 'MACHINE_OFFLINE':
                        throw new ConflictException('Machine Agent is offline');
                    case 'MACHINE_AGENT_CAPABILITY_MISSING':
                        throw new ConflictException(
                            'Machine Agent must be upgraded before retrying these features',
                        );
                    case 'RETRY_NODE_NOT_FOUND':
                        throw new BadRequestException(
                            'Every retried node must belong to this machine',
                        );
                    case 'RETRY_NODE_INVALID':
                        throw new ConflictException('Managed node metadata is incomplete');
                    case 'RETRY_ALREADY_RUNNING':
                        throw new ConflictException('A retry is already running for this node');
                    case 'NODE_CREDENTIALS_MISSING':
                        throw new ServiceUnavailableException('Node credentials are unavailable');
                }
            }
            throw error;
        }
    }

    private createEnrollmentSecret(): {
        token: string;
        hash: string;
        expiresAt: Date;
    } {
        const token = `mrw_enroll_${randomBytes(32).toString('base64url')}`;
        return {
            token,
            hash: hashEnrollmentToken(token),
            expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
        };
    }
}

function hashEnrollmentToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isUniqueConstraintViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
