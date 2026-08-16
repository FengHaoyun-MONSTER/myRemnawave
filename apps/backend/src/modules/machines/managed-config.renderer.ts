export function renderManagedConfig(
    source: Record<string, unknown>,
    node: {
        protocolKey: string | null;
        externalPort: number | null;
        protocolSettings: Record<string, unknown>;
    },
): Record<string, unknown> {
    const config = structuredClone(source);
    if (node.protocolSettings.warpEnabled !== true) {
        if (Array.isArray(config.outbounds)) {
            config.outbounds = config.outbounds.filter(
                (value) =>
                    !value ||
                    typeof value !== 'object' ||
                    Array.isArray(value) ||
                    (value as Record<string, unknown>).tag !== 'WARP_OUT',
            );
        }
        const routing = config.routing;
        if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
            const rules = (routing as Record<string, unknown>).rules;
            if (Array.isArray(rules)) {
                (routing as Record<string, unknown>).rules = rules.filter(
                    (value) =>
                        !value ||
                        typeof value !== 'object' ||
                        Array.isArray(value) ||
                        (value as Record<string, unknown>).outboundTag !== 'WARP_OUT',
                );
            }
        }
    }
    if (!Array.isArray(config.inbounds)) return config;
    for (const value of config.inbounds) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const inbound = value as Record<string, unknown>;
        if (node.externalPort) inbound.port = node.externalPort;
        const stream = inbound.streamSettings;
        if (!stream || typeof stream !== 'object' || Array.isArray(stream)) continue;
        const streamSettings = stream as Record<string, unknown>;
        if (node.protocolKey === 'VLESS_REALITY') {
            const reality = streamSettings.realitySettings;
            if (reality && typeof reality === 'object' && !Array.isArray(reality)) {
                const settings = reality as Record<string, unknown>;
                if (typeof node.protocolSettings.serverName === 'string') {
                    settings.serverNames = [node.protocolSettings.serverName];
                }
                if (typeof node.protocolSettings.target === 'string') {
                    settings.target = node.protocolSettings.target;
                }
            }
        } else if (node.protocolKey === 'HYSTERIA2') {
            const hysteria = streamSettings.hysteriaSettings;
            if (hysteria && typeof hysteria === 'object' && !Array.isArray(hysteria)) {
                const settings = hysteria as Record<string, unknown>;
                if (typeof node.protocolSettings.congestion === 'string') {
                    settings.congestion = node.protocolSettings.congestion;
                }
                if (typeof node.protocolSettings.upMbps === 'number') {
                    settings.up = `${node.protocolSettings.upMbps} mbps`;
                }
                if (typeof node.protocolSettings.downMbps === 'number') {
                    settings.down = `${node.protocolSettings.downMbps} mbps`;
                }
            }
        }
    }
    return config;
}
