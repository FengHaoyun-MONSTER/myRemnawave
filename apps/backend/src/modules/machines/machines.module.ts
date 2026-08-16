import { Module } from '@nestjs/common';

import { MachineControlGateway } from './machine-control.gateway';
import { MachineEnrollmentController, MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';
import { MachinesRepository } from './repositories/machines.repository';

@Module({
    controllers: [MachinesController, MachineEnrollmentController],
    providers: [MachinesRepository, MachinesService, MachineControlGateway],
    exports: [MachinesRepository],
})
export class MachinesModule {}
