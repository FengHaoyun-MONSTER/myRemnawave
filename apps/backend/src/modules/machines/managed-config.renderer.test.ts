import { describe, expect, it } from 'vitest';

import { renderManagedConfig } from './managed-config.renderer';
import { PROTOCOL_TEMPLATES } from './protocol-templates';

describe('managed config renderer', () => {
    it('removes WARP policy when the machine runtime is not enabled', () => {
        const rendered = renderManagedConfig(PROTOCOL_TEMPLATES.VLESS_TLS_VISION.config, {
            protocolKey: 'VLESS_TLS_VISION',
            externalPort: 9443,
            protocolSettings: { warpEnabled: false },
        });
        expect(JSON.stringify(rendered)).not.toContain('WARP_OUT');
        expect((rendered.inbounds as Array<{ port: number }>)[0].port).toBe(9443);
    });

    it('keeps WARP fail-closed routing when enabled', () => {
        const rendered = renderManagedConfig(PROTOCOL_TEMPLATES.HYSTERIA2.config, {
            protocolKey: 'HYSTERIA2',
            externalPort: 443,
            protocolSettings: { warpEnabled: true, congestion: 'bbr', upMbps: 100 },
        });
        expect(JSON.stringify(rendered)).toContain('WARP_OUT');
        const inbound = (
            rendered.inbounds as Array<{
                streamSettings: { hysteriaSettings: Record<string, unknown> };
            }>
        )[0];
        expect(inbound.streamSettings.hysteriaSettings).toMatchObject({
            congestion: 'bbr',
            up: '100 mbps',
        });
    });

    it('injects only public Reality overrides', () => {
        const rendered = renderManagedConfig(PROTOCOL_TEMPLATES.VLESS_REALITY.config, {
            protocolKey: 'VLESS_REALITY',
            externalPort: 443,
            protocolSettings: {
                warpEnabled: false,
                serverName: 'example.com',
                target: 'example.com:443',
            },
        });
        const inbound = (
            rendered.inbounds as Array<{
                streamSettings: { realitySettings: Record<string, unknown> };
            }>
        )[0];
        expect(inbound.streamSettings.realitySettings).toMatchObject({
            serverNames: ['example.com'],
            target: 'example.com:443',
        });
    });
});
