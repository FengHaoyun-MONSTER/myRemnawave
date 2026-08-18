import { describe, expect, it } from 'vitest';

import { SCOPE_ENDPOINT } from '@common/decorators/scopes';
import { EndpointDetails } from '@libs/contracts/constants';

import { MachinesController } from './machines.controller';

describe('machine API endpoint scopes', () => {
    it('uses unique endpoint slugs that do not collide with resource scopes', () => {
        const prototype = MachinesController.prototype;
        const scopes = Object.getOwnPropertyNames(prototype)
            .filter((methodName) => methodName !== 'constructor')
            .map((methodName) =>
                Reflect.getMetadata(SCOPE_ENDPOINT, Reflect.get(prototype, methodName) as object),
            )
            .filter((details): details is EndpointDetails => details !== undefined)
            .map((details) => details.SCOPE);

        expect(scopes).not.toContain('read');
        expect(scopes).not.toContain('write');
        expect(new Set(scopes).size).toBe(scopes.length);
    });
});
