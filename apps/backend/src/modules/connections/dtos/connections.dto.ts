import {
    ConnectionsByUserCommand,
    ConnectionsByUserResultCommand,
    ConnectionsByNodeCommand,
    ConnectionsByNodeResultCommand,
    DropConnectionsCommand,
} from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class ConnectionsByUserBodyParamDto extends createZodDto(
    ConnectionsByUserCommand.RequestParamSchema,
) {}

export class ConnectionsByUserResponseDto extends createZodDto(
    ConnectionsByUserCommand.ResponseSchema,
) {}

export class ConnectionsByUserResultParamDto extends createZodDto(
    ConnectionsByUserResultCommand.RequestParamSchema,
) {}

export class ConnectionsByUserResultResponseDto extends createZodDto(
    ConnectionsByUserResultCommand.ResponseSchema,
) {}

export class DropConnectionsBodyDto extends createZodDto(
    DropConnectionsCommand.RequestBodySchema,
) {}

export class ConnectionsByNodeParamDto extends createZodDto(
    ConnectionsByNodeCommand.RequestParamSchema,
) {}

export class ConnectionsByNodeResponseDto extends createZodDto(
    ConnectionsByNodeCommand.ResponseSchema,
) {}

export class ConnectionsByNodeResultParamDto extends createZodDto(
    ConnectionsByNodeResultCommand.RequestParamSchema,
) {}

export class ConnectionsByNodeResultResponseDto extends createZodDto(
    ConnectionsByNodeResultCommand.ResponseSchema,
) {}
