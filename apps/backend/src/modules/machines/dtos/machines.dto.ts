import {
    CreateMachineCommand,
    EnrollMachineCommand,
    GetMachineCommand,
    GetMachinesCommand,
    RotateMachineEnrollmentTokenCommand,
} from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class CreateMachineBodyDto extends createZodDto(CreateMachineCommand.RequestBodySchema) {}
export class CreateMachineResponseDto extends createZodDto(CreateMachineCommand.ResponseSchema) {}
export class GetMachinesResponseDto extends createZodDto(GetMachinesCommand.ResponseSchema) {}
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
