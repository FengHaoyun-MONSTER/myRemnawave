import { describe, expect, it } from 'vitest';

import { PROTOCOL_TEMPLATES, validateProtocolTemplates } from './protocol-templates';

describe('system protocol templates', () => {
    it('validates all three immutable templates', () => {
        expect(() => validateProtocolTemplates()).not.toThrow();
        expect(Object.keys(PROTOCOL_TEMPLATES)).toEqual([
            'VLESS_REALITY',
            'VLESS_TLS_VISION',
            'HYSTERIA2',
        ]);
    });

    it('uses stable per-container certificate paths', () => {
        for (const key of ['VLESS_TLS_VISION', 'HYSTERIA2'] as const) {
            const serialized = JSON.stringify(PROTOCOL_TEMPLATES[key].config);
            expect(serialized).toContain('/etc/myremnawave/certs/fullchain.pem');
            expect(serialized).toContain('/etc/myremnawave/certs/privkey.pem');
        }
    });

    it('preserves the approved configuration-driven WARP policy', () => {
        for (const template of Object.values(PROTOCOL_TEMPLATES)) {
            const routing = template.config.routing as {
                rules: Array<{ outboundTag: string; domain?: string[] }>;
            };
            const warpRule = routing.rules.find((rule) => rule.outboundTag === 'WARP_OUT');
            expect(warpRule?.domain).toContain('geosite:openai');
            expect(warpRule?.domain).toContain('geosite:anthropic');
            expect(warpRule?.domain).toContain('domain:discord.com');
        }
    });
});
