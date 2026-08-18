import { describe, expect, it, vi } from 'vitest';

import { NodeHealthCheckQueueProcessor } from './node-health-check.processor';

const NODE_UUID = '123e4567-e89b-42d3-a456-426614174001';
const MACHINE_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('NodeHealthCheckQueueProcessor managed node boundary', () => {
    it('does not enqueue legacy start work for a disconnected Machine-managed node', async () => {
        const startNode = vi.fn();
        const processor = new NodeHealthCheckQueueProcessor(
            {
                execute: vi.fn().mockResolvedValue({
                    isOk: true,
                    response: {
                        uuid: NODE_UUID,
                        machineUuid: MACHINE_UUID,
                        address: '127.0.0.1',
                        port: 2222,
                    },
                }),
            } as never,
            { emit: vi.fn() } as never,
            {
                getSystemStats: vi
                    .fn()
                    .mockResolvedValue({ isOk: false, message: 'connection refused' }),
            } as never,
            { startNode, collectReports: vi.fn() } as never,
            { delMany: vi.fn(), setMany: vi.fn() } as never,
        );

        await processor.process({
            data: {
                nodeUuid: NODE_UUID,
                isConnected: false,
                connectionOpts: { address: '127.0.0.1', port: 2222 },
            },
        } as never);

        expect(startNode).not.toHaveBeenCalled();
    });
});
