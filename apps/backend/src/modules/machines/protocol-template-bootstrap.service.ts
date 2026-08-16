import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { MachinesRepository } from './repositories/machines.repository';

@Injectable()
export class ProtocolTemplateBootstrapService implements OnApplicationBootstrap {
    constructor(private readonly machinesRepository: MachinesRepository) {}

    async onApplicationBootstrap(): Promise<void> {
        await this.machinesRepository.ensureSystemTemplates();
    }
}
