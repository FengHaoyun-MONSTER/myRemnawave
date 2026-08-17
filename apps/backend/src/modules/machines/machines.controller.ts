import {
    CONTROLLERS_INFO,
    MACHINE_ENROLLMENT_CONTROLLER,
    MACHINES_CONTROLLER,
} from '@contract/api';
import { ROLE } from '@contract/constants';

import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { ScopesGuard } from '@common/guards/scopes';
import {
    CreateMachineCommand,
    EnrollMachineCommand,
    GetMachineCommand,
    GetMachineControlStatusCommand,
    GetMachinesCommand,
    ProvisionMachineCommand,
    PublishMachineCommand,
    RetryMachineCommand,
    RotateMachineEnrollmentTokenCommand,
} from '@libs/contracts/commands';

import {
    CreateMachineBodyDto,
    CreateMachineResponseDto,
    EnrollMachineBodyDto,
    EnrollMachineResponseDto,
    GetMachineParamDto,
    GetMachineControlStatusResponseDto,
    GetMachineResponseDto,
    GetMachinesResponseDto,
    ProvisionMachineBodyDto,
    ProvisionMachineParamDto,
    ProvisionMachineResponseDto,
    PublishMachineBodyDto,
    PublishMachineParamDto,
    PublishMachineResponseDto,
    RetryMachineBodyDto,
    RetryMachineParamDto,
    RetryMachineResponseDto,
    RotateMachineEnrollmentTokenParamDto,
    RotateMachineEnrollmentTokenResponseDto,
} from './dtos/machines.dto';
import { MachinesService } from './machines.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.MACHINES.resource)
@ApiTags(CONTROLLERS_INFO.MACHINES.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(MACHINES_CONTROLLER)
export class MachinesController {
    constructor(private readonly machinesService: MachinesService) {}

    @Endpoint({
        type: CreateMachineResponseDto,
        command: CreateMachineCommand,
        httpCode: HttpStatus.CREATED,
    })
    async createMachine(@Body() body: CreateMachineBodyDto) {
        return { response: await this.machinesService.createMachine(body) };
    }

    @Endpoint({
        type: GetMachinesResponseDto,
        command: GetMachinesCommand,
        httpCode: HttpStatus.OK,
    })
    async getMachines() {
        return { response: await this.machinesService.getMachines() };
    }

    @Endpoint({
        type: GetMachineControlStatusResponseDto,
        command: GetMachineControlStatusCommand,
        httpCode: HttpStatus.OK,
    })
    getMachineControlStatus() {
        return { response: this.machinesService.getControlStatus() };
    }

    @Endpoint({
        type: GetMachineResponseDto,
        command: GetMachineCommand,
        httpCode: HttpStatus.OK,
    })
    async getMachine(@Param() params: GetMachineParamDto) {
        return { response: await this.machinesService.getMachine(params.uuid) };
    }

    @Endpoint({
        type: RotateMachineEnrollmentTokenResponseDto,
        command: RotateMachineEnrollmentTokenCommand,
        httpCode: HttpStatus.OK,
    })
    async rotateEnrollmentToken(@Param() params: RotateMachineEnrollmentTokenParamDto) {
        return {
            response: await this.machinesService.rotateEnrollmentToken(params.uuid),
        };
    }

    @Endpoint({
        type: ProvisionMachineResponseDto,
        command: ProvisionMachineCommand,
        httpCode: HttpStatus.CREATED,
    })
    async provisionMachine(
        @Param() params: ProvisionMachineParamDto,
        @Body() body: ProvisionMachineBodyDto,
    ) {
        return { response: await this.machinesService.provision(params.uuid, body) };
    }

    @Endpoint({
        type: RetryMachineResponseDto,
        command: RetryMachineCommand,
        httpCode: HttpStatus.OK,
    })
    async retryMachine(@Param() params: RetryMachineParamDto, @Body() body: RetryMachineBodyDto) {
        return { response: await this.machinesService.retry(params.uuid, body) };
    }

    @Endpoint({
        type: PublishMachineResponseDto,
        command: PublishMachineCommand,
        httpCode: HttpStatus.OK,
    })
    async publishMachine(
        @Param() params: PublishMachineParamDto,
        @Body() body: PublishMachineBodyDto,
    ) {
        return { response: await this.machinesService.publish(params.uuid, body) };
    }
}

@ApiTags('Machine Agent Enrollment')
@UseFilters(HttpExceptionFilter)
@Controller(MACHINE_ENROLLMENT_CONTROLLER)
export class MachineEnrollmentController {
    constructor(private readonly machinesService: MachinesService) {}

    @Endpoint({
        type: EnrollMachineResponseDto,
        command: EnrollMachineCommand,
        httpCode: HttpStatus.CREATED,
    })
    async enroll(@Body() body: EnrollMachineBodyDto) {
        return { response: await this.machinesService.enroll(body) };
    }
}
