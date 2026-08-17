import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EnrollMachineCommand } from '@libs/contracts/commands';
import { MachineSchema } from '@libs/contracts/models';

describe('machine API JSON schemas', () => {
    it('represents response dates as OpenAPI-compatible ISO date-time strings', () => {
        expect(() => z.toJSONSchema(MachineSchema, { io: 'input' })).not.toThrow();
        expect(() =>
            z.toJSONSchema(EnrollMachineCommand.ResponseSchema, { io: 'input' }),
        ).not.toThrow();
    });
});
