import { CONTROLLERS_INFO, NODE_PLUGINS_CONTROLLER } from '@contract/api';
import { ROLE } from '@contract/constants';

import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';
import {
    CloneNodePluginCommand,
    CreateNodePluginCommand,
    DeleteNodePluginCommand,
    GetNodePluginCommand,
    GetNodePluginsCommand,
    PluginExecutorCommand,
    ReorderNodePluginCommand,
    UpdateNodePluginCommand,
} from '@libs/contracts/commands';

import {
    ReorderNodePluginsBodyDto,
    ReorderNodePluginsResponseDto,
    GetNodePluginsResponseDto,
    GetNodePluginResponseDto,
    UpdateNodePluginBodyDto,
    UpdateNodePluginResponseDto,
    DeleteNodePluginParamDto,
    CreateNodePluginBodyDto,
    CreateNodePluginResponseDto,
    CloneNodePluginResponseDto,
    CloneNodePluginBodyDto,
    PluginExecutorBodyDto,
    GetNodePluginParamDto,
} from './dtos/node-plugins.dtos';
import { NodePluginService } from './node-plugins.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.NODE_PLUGINS.resource)
@ApiTags(CONTROLLERS_INFO.NODE_PLUGINS.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(NODE_PLUGINS_CONTROLLER)
export class NodePluginController {
    constructor(private readonly nodePluginService: NodePluginService) {}

    @Endpoint({
        type: GetNodePluginsResponseDto,
        command: GetNodePluginsCommand,
        httpCode: HttpStatus.OK,
    })
    async getAllConfigs(): Promise<GetNodePluginsResponseDto> {
        const result = await this.nodePluginService.getAllConfigs();

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        type: GetNodePluginResponseDto,
        command: GetNodePluginCommand,
        httpCode: HttpStatus.OK,
    })
    async getConfigByUuid(
        @Param() param: GetNodePluginParamDto,
    ): Promise<GetNodePluginResponseDto> {
        const { uuid } = param;
        const result = await this.nodePluginService.getConfigByUuid(uuid);
        const data = errorHandler(result);
        return {
            response: {
                ...data,
                pluginConfig: data.pluginConfig!,
            },
        };
    }

    @Endpoint({
        type: UpdateNodePluginResponseDto,
        command: UpdateNodePluginCommand,
        httpCode: HttpStatus.OK,
    })
    async updateConfig(
        @Body() body: UpdateNodePluginBodyDto,
    ): Promise<UpdateNodePluginResponseDto> {
        const result = await this.nodePluginService.updateConfig(
            body.uuid,
            body.name?.trim() ?? undefined,
            body.pluginConfig ?? undefined,
        );

        const data = errorHandler(result);
        return {
            response: {
                ...data,
                pluginConfig: data.pluginConfig!,
            },
        };
    }

    @Endpoint({
        command: DeleteNodePluginCommand,
        httpCode: HttpStatus.NO_CONTENT,
    })
    async deleteConfig(@Param() param: DeleteNodePluginParamDto) {
        const result = await this.nodePluginService.deleteConfig(param.uuid);

        errorHandler(result);
        return;
    }

    @Endpoint({
        type: CreateNodePluginResponseDto,
        command: CreateNodePluginCommand,
        httpCode: HttpStatus.CREATED,
    })
    async createConfig(
        @Body() body: CreateNodePluginBodyDto,
    ): Promise<CreateNodePluginResponseDto> {
        const result = await this.nodePluginService.createConfig(body.name);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        type: ReorderNodePluginsResponseDto,
        command: ReorderNodePluginCommand,
        httpCode: HttpStatus.OK,
    })
    async reorderNodePlugins(
        @Body() body: ReorderNodePluginsBodyDto,
    ): Promise<ReorderNodePluginsResponseDto> {
        const result = await this.nodePluginService.reorderNodePlugins(body.items);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        type: CloneNodePluginResponseDto,
        command: CloneNodePluginCommand,
        httpCode: HttpStatus.OK,
    })
    async cloneNodePlugin(
        @Body() body: CloneNodePluginBodyDto,
    ): Promise<CloneNodePluginResponseDto> {
        const result = await this.nodePluginService.cloneNodePlugin(body.cloneFromUuid);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        command: PluginExecutorCommand,
        httpCode: HttpStatus.ACCEPTED,
    })
    async pluginExecutor(@Body() body: PluginExecutorBodyDto) {
        const result = await this.nodePluginService.executePluginCommand(body);

        errorHandler(result);
        return;
    }
}
