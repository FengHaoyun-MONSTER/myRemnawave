import {
    CreateMachineCommand,
    ApplyMachineProvisioningPlanCommand,
    AuthorizeMachineWarpTakeoverCommand,
    EnrollMachineCommand,
    GetMachineControlStatusCommand,
    GetMachineProvisioningPlanCommand,
    GetMachineCommand,
    GetMachinesCommand,
    ProvisionMachineCommand,
    PublishMachineCommand,
    RetryMachineCommand,
    RotateMachineEnrollmentTokenCommand,
} from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class CreateMachineBodyDto extends createZodDto(CreateMachineCommand.RequestBodySchema) {}
export class CreateMachineResponseDto extends createZodDto(CreateMachineCommand.ResponseSchema) {}
export class GetMachinesResponseDto extends createZodDto(GetMachinesCommand.ResponseSchema) {}
export class GetMachineControlStatusResponseDto extends createZodDto(
    GetMachineControlStatusCommand.ResponseSchema,
) {}
export class GetMachineParamDto extends createZodDto(GetMachineCommand.RequestParamsSchema) {}
export class GetMachineResponseDto extends createZodDto(GetMachineCommand.ResponseSchema) {}
export class RotateMachineEnrollmentTokenParamDto extends createZodDto(
    RotateMachineEnrollmentTokenCommand.RequestParamsSchema,
) {}
export class RotateMachineEnrollmentTokenResponseDto extends createZodDto(
    RotateMachineEnrollmentTokenCommand.ResponseSchema,
) {}
export class EnrollMachineBodyDto extends createZodDto(EnrollMachineCommand.RequestBodySchema) {}
export class EnrollMachineResponseDto extends createZodDto(EnrollMachineCommand.ResponseSchema) {}
export class ProvisionMachineParamDto extends createZodDto(
    ProvisionMachineCommand.RequestParamSchema,
) {}
export class ProvisionMachineBodyDto extends createZodDto(
    ProvisionMachineCommand.RequestBodySchema,
) {}
export class ProvisionMachineResponseDto extends createZodDto(
    ProvisionMachineCommand.ResponseSchema,
) {}
export class GetMachineProvisioningPlanParamDto extends createZodDto(
    GetMachineProvisioningPlanCommand.RequestParamsSchema,
) {}
export class GetMachineProvisioningPlanResponseDto extends createZodDto(
    GetMachineProvisioningPlanCommand.ResponseSchema,
) {}
export class ApplyMachineProvisioningPlanParamDto extends createZodDto(
    ApplyMachineProvisioningPlanCommand.RequestParamsSchema,
) {}
export class ApplyMachineProvisioningPlanBodyDto extends createZodDto(
    ApplyMachineProvisioningPlanCommand.RequestBodySchema,
) {}
export class ApplyMachineProvisioningPlanResponseDto extends createZodDto(
    ApplyMachineProvisioningPlanCommand.ResponseSchema,
) {}
export class AuthorizeMachineWarpTakeoverParamDto extends createZodDto(
    AuthorizeMachineWarpTakeoverCommand.RequestParamsSchema,
) {}
export class AuthorizeMachineWarpTakeoverBodyDto extends createZodDto(
    AuthorizeMachineWarpTakeoverCommand.RequestBodySchema,
) {}
export class AuthorizeMachineWarpTakeoverResponseDto extends createZodDto(
    AuthorizeMachineWarpTakeoverCommand.ResponseSchema,
) {}
export class PublishMachineParamDto extends createZodDto(
    PublishMachineCommand.RequestParamSchema,
) {}
export class PublishMachineBodyDto extends createZodDto(PublishMachineCommand.RequestBodySchema) {}
export class PublishMachineResponseDto extends createZodDto(PublishMachineCommand.ResponseSchema) {}
export class RetryMachineParamDto extends createZodDto(RetryMachineCommand.RequestParamSchema) {}
export class RetryMachineBodyDto extends createZodDto(RetryMachineCommand.RequestBodySchema) {}
export class RetryMachineResponseDto extends createZodDto(RetryMachineCommand.ResponseSchema) {}
