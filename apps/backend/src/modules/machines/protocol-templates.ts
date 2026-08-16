export const PROTOCOL_KEYS = ['VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2'] as const;
export type ProtocolKey = (typeof PROTOCOL_KEYS)[number];

export const SYSTEM_TEMPLATE_VERSION = 1;
export const NODE_IMAGE =
    'remnawave/node@sha256:6a4c26eb07c91c5eb10fa0ff7f6defda8b49a3557f2dc25fa13a0110bde646e2';

export interface ProtocolTemplate {
    uuid: string;
    key: ProtocolKey;
    name: string;
    controlPort: number;
    externalPort: number;
    network: 'tcp' | 'udp';
    requiresCertificate: boolean;
    config: Record<string, unknown>;
}

const CERTIFICATE_FILES = [
    {
        certificateFile: '/etc/myremnawave/certs/fullchain.pem',
        keyFile: '/etc/myremnawave/certs/privkey.pem',
    },
];

function commonOutbounds() {
    return [
        { protocol: 'freedom', tag: 'DIRECT' },
        { protocol: 'blackhole', tag: 'BLOCK' },
        {
            protocol: 'socks',
            tag: 'WARP_OUT',
            settings: {
                servers: [{ address: 'host.docker.internal', port: 40000 }],
            },
        },
    ];
}

function commonRouting() {
    return {
        domainStrategy: 'IPIfNonMatch',
        rules: [
            {
                type: 'field',
                domain: [
                    'geosite:openai',
                    'geosite:anthropic',
                    'domain:civitai.com',
                    'domain:poe.com',
                    'domain:perplexity.ai',
                    'domain:discord.com',
                    'domain:discord.gg',
                    'domain:anthropic.com',
                    'domain:claude.ai',
                    'domain:claude.com',
                    'domain:claude.app',
                    'domain:claudeusercontent.com',
                    'domain:claudemcpcontent.com',
                    'domain:clau.de',
                    'domain:discordapp.com',
                    'domain:discordapp.net',
                    'domain:midjourney.com',
                    'domain:jzchong.com',
                    'domain:grok.com',
                    'domain:x.com',
                    'domain:x.ai',
                    'domain:net.coffee',
                ],
                outboundTag: 'WARP_OUT',
            },
            {
                type: 'field',
                protocol: ['bittorrent'],
                outboundTag: 'BLOCK',
            },
            {
                type: 'field',
                ip: ['geoip:private'],
                outboundTag: 'BLOCK',
            },
        ],
    };
}

export const PROTOCOL_TEMPLATES: Readonly<Record<ProtocolKey, ProtocolTemplate>> = {
    VLESS_REALITY: {
        uuid: '10000000-0000-4000-8000-000000000001',
        key: 'VLESS_REALITY',
        name: 'System VLESS Reality Vision v1',
        controlPort: 2222,
        externalPort: 443,
        network: 'tcp',
        requiresCertificate: false,
        config: {
            log: { loglevel: 'warning' },
            inbounds: [
                {
                    tag: 'VLESS_REALITY',
                    listen: '0.0.0.0',
                    port: 443,
                    protocol: 'vless',
                    settings: { clients: [], decryption: 'none' },
                    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
                    streamSettings: {
                        network: 'raw',
                        security: 'reality',
                        rawSettings: { header: { type: 'none' } },
                        realitySettings: {
                            show: false,
                            target: 'www.microsoft.com:443',
                            serverNames: ['www.microsoft.com'],
                            privateKey: '{{REALITY_PRIVATE_KEY}}',
                            shortIds: ['{{REALITY_SHORT_ID}}'],
                        },
                    },
                },
            ],
            outbounds: commonOutbounds(),
            routing: commonRouting(),
        },
    },
    VLESS_TLS_VISION: {
        uuid: '10000000-0000-4000-8000-000000000002',
        key: 'VLESS_TLS_VISION',
        name: 'System VLESS TLS Vision v1',
        controlPort: 2223,
        externalPort: 8443,
        network: 'tcp',
        requiresCertificate: true,
        config: {
            log: { loglevel: 'warning' },
            inbounds: [
                {
                    tag: 'VLESS_TLS_VISION',
                    listen: '0.0.0.0',
                    port: 8443,
                    protocol: 'vless',
                    settings: { clients: [], decryption: 'none' },
                    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
                    streamSettings: {
                        network: 'raw',
                        security: 'tls',
                        rawSettings: { header: { type: 'none' } },
                        tlsSettings: {
                            minVersion: '1.2',
                            certificates: CERTIFICATE_FILES,
                        },
                    },
                },
            ],
            outbounds: commonOutbounds(),
            routing: commonRouting(),
        },
    },
    HYSTERIA2: {
        uuid: '10000000-0000-4000-8000-000000000003',
        key: 'HYSTERIA2',
        name: 'System Hysteria2 v1',
        controlPort: 2224,
        externalPort: 443,
        network: 'udp',
        requiresCertificate: true,
        config: {
            log: { loglevel: 'warning' },
            inbounds: [
                {
                    tag: 'HYSTERIA2',
                    listen: '0.0.0.0',
                    port: 443,
                    protocol: 'hysteria',
                    settings: { version: 2, clients: [] },
                    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
                    streamSettings: {
                        network: 'hysteria',
                        security: 'tls',
                        hysteriaSettings: { version: 2 },
                        tlsSettings: {
                            minVersion: '1.2',
                            alpn: ['h3'],
                            certificates: CERTIFICATE_FILES,
                        },
                    },
                },
            ],
            outbounds: commonOutbounds(),
            routing: commonRouting(),
        },
    },
};

export function validateProtocolTemplates(): void {
    for (const template of Object.values(PROTOCOL_TEMPLATES)) {
        const [inbound] = template.config.inbounds as Array<Record<string, unknown>>;
        const outbounds = template.config.outbounds as unknown[];
        if (
            !inbound ||
            inbound.tag !== template.key ||
            inbound.port !== template.externalPort ||
            outbounds.length === 0
        ) {
            throw new Error(`System protocol template ${template.key} is inconsistent`);
        }
    }
}
