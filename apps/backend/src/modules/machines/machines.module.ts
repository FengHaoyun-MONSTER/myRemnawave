import { Module } from '@nestjs/common';

import { KeygenModule } from '@modules/keygen/keygen.module';

import { MachineControlGateway } from './machine-control.gateway';
import { MachineEnrollmentController, MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';
import { ProtocolTemplateBootstrapService } from './protocol-template-bootstrap.service';
import { MachinesRepository } from './repositories/machines.repository';

@Module({
    imports: [KeygenModule],
    controllers: [MachinesController, MachineEnrollmentController],
    providers: [
        MachinesRepository,
        MachinesService,
        MachineControlGateway,
        ProtocolTemplateBootstrapService,
    ],
    exports: [MachinesRepository],
})
export class MachinesModule {}
