import { describe, expect, it } from 'vitest';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { CqrsModule } from '@nestjs/cqrs';

import { MachinesModule } from './machines.module';

describe('MachinesModule', () => {
    it('imports CQRS so controller guards can resolve QueryBus', () => {
        const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, MachinesModule) as unknown[];

        expect(imports).toContain(CqrsModule);
    });
});
