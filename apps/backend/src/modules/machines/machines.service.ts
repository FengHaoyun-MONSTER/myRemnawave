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

import { CreateMachineBodyDto, EnrollMachineBodyDto } from './dtos/machines.dto';
import { MachineResponseModel } from './models/machine.response.model';
import { MachinesRepository } from './repositories/machines.repository';

const ENROLLMENT_TTL_MS = 15 * 60 * 1_000;

@Injectable()
export class MachinesService {
    constructor(
        private readonly machinesRepository: MachinesRepository,
        private readonly config: TypedConfigService,
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
