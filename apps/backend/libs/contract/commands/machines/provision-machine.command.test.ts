import { describe, expect, it } from 'vitest';

import { ProvisionMachineCommand } from './provision-machine.command';

describe('ProvisionMachineCommand port candidates', () => {
    it('accepts a bounded Machine-specific fallback pool', () => {
        expect(
            ProvisionMachineCommand.RequestBodySchema.safeParse({
                protocols: [
                    {
                        protocol: 'VLESS_REALITY',
                        externalPort: 443,
                        fallbackPorts: [2053, 2083, 9443],
                    },
                ],
                enableWarp: false,
            }).success,
        ).toBe(true);
    });

    it.each([
        [[2222], 'reserved control port'],
        [[2053, 2053], 'duplicate fallback'],
    ])('rejects an unsafe fallback pool: %s (%s)', (fallbackPorts) => {
        expect(
            ProvisionMachineCommand.RequestBodySchema.safeParse({
                protocols: [
                    {
                        protocol: 'VLESS_REALITY',
                        externalPort: 443,
                        fallbackPorts,
                    },
                ],
                enableWarp: false,
            }).success,
        ).toBe(false);
    });

    it('accepts a Machine pool that also contains the protocol preferred port', () => {
        expect(
            ProvisionMachineCommand.RequestBodySchema.safeParse({
                protocols: [
                    {
                        protocol: 'VLESS_REALITY',
                        externalPort: 443,
                        fallbackPorts: [443, 8443, 2053],
                    },
                ],
                enableWarp: false,
            }).success,
        ).toBe(true);
    });

    it('rejects a reserved control port as the preferred external port', () => {
        expect(
            ProvisionMachineCommand.RequestBodySchema.safeParse({
                protocols: [{ protocol: 'VLESS_REALITY', externalPort: 2222 }],
                enableWarp: false,
            }).success,
        ).toBe(false);
    });
});
