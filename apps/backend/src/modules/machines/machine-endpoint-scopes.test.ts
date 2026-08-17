import { describe, expect, it } from 'vitest';

import {
    CreateMachineCommand,
    GetMachineCommand,
    GetMachineControlStatusCommand,
    GetMachinesCommand,
    ProvisionMachineCommand,
    PublishMachineCommand,
    RetryMachineCommand,
    RotateMachineEnrollmentTokenCommand,
} from '@libs/contracts/commands';

describe('machine API endpoint scopes', () => {
    it('uses unique endpoint slugs that do not collide with resource scopes', () => {
        const scopes = [
            CreateMachineCommand.endpointDetails.SCOPE,
            GetMachinesCommand.endpointDetails.SCOPE,
            GetMachineCommand.endpointDetails.SCOPE,
            GetMachineControlStatusCommand.endpointDetails.SCOPE,
            RotateMachineEnrollmentTokenCommand.endpointDetails.SCOPE,
            ProvisionMachineCommand.endpointDetails.SCOPE,
            RetryMachineCommand.endpointDetails.SCOPE,
            PublishMachineCommand.endpointDetails.SCOPE,
        ];

        expect(scopes).not.toContain('read');
        expect(scopes).not.toContain('write');
        expect(new Set(scopes).size).toBe(scopes.length);
    });
});
