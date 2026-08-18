import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { IncomingMessage } from 'node:http';
import { createServer, Server } from 'node:https';
import { isAbsolute } from 'node:path';
import { TLSSocket } from 'node:tls';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';
import { generateMachineControlServerCertificate } from '@common/utils/certs/generate-machine-control-server-cert.util';

import {
    agentEnvelopeSchema,
    commandEnvelope,
    commandResultSchema,
    heartbeatSchema,
    helloSchema,
    MACHINE_CONTROL_MAX_MESSAGE_BYTES,
} from './machine-control.protocol';
import { MachinesRepository } from './repositories/machines.repository';

const MACHINE_ID_HEADER = 'x-myremnawave-machine-id';
const HELLO_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 45_000;

const inventorySchema = z
    .object({
        hostname: z.string().min(1).max(255),
        osId: z.string().min(1).max(64),
        osVersion: z.string().max(64),
        osPrettyName: z.string().max(255),
        architecture: z.string().min(1).max(32),
        cpuCount: z.int().min(1).max(4096),
        memoryBytes: z.number().nonnegative(),
        diskFreeBytes: z.number().nonnegative(),
    })
    .strict();

const preflightResultSchema = z
    .object({
        system: inventorySchema,
        checks: z
            .array(
                z
                    .object({
                        name: z.string().min(1).max(128),
                        ok: z.boolean(),
                        message: z.string().max(1024),
                    })
                    .strict(),
            )
            .max(64),
        ok: z.boolean(),
    })
    .strict();

const reconcileInstanceResultSchema = z
    .object({
        instanceId: z.uuid(),
        containerName: z.string().regex(/^myremnawave-[0-9a-f]{16}$/),
        configHash: z.string().regex(/^[0-9a-f]{64}$/),
        realityPublicKey: z.string().max(128).optional(),
        realityShortId: z
            .string()
            .regex(/^[0-9a-f]{16}$/)
            .optional(),
    })
    .strict();

const reconcileCertificateResultSchema = z
    .object({
        instanceId: z.uuid(),
        domain: z.string().min(1).max(253),
        expiresAt: z.iso.datetime(),
        fingerprintSha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict();

const reconcileWarpResultSchema = z
    .object({
        enabled: z.literal(true),
        proxyPort: z.literal(40000),
        version: z.string().min(1).max(128),
        status: z.literal('CONNECTED'),
    })
    .strict();

const applyConfigResultSchema = z
    .object({
        instanceId: z.uuid(),
        applied: z.literal(true),
    })
    .strict();

const lifecycleResultSchema = z
    .object({
        instanceId: z.uuid(),
        state: z.enum(['RUNNING', 'STOPPED']),
    })
    .strict();

interface SessionState {
    machineUuid: string;
    helloReceived: boolean;
}

@Injectable()
export class MachineControlGateway implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(MachineControlGateway.name);
    private readonly sessions = new Map<string, WebSocket>();
    private readonly liveness = new WeakMap<WebSocket, boolean>();
    private server?: Server;
    private webSocketServer?: WebSocketServer;
    private pingTimer?: NodeJS.Timeout;

    constructor(
        private readonly config: TypedConfigService,
        private readonly machinesRepository: MachinesRepository,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const publicUrl = this.config.get('MACHINE_CONTROL_PUBLIC_URL');
        if (!publicUrl) {
            this.logger.warn('Machine control gateway is disabled');
            return;
        }

        const authority = await this.machinesRepository.getCertificateAuthority();
        if (!authority) {
            throw new Error('Machine control certificate authority is unavailable');
        }

        const certPath = this.config.get('MACHINE_CONTROL_TLS_CERT_PATH');
        const keyPath = this.config.get('MACHINE_CONTROL_TLS_KEY_PATH');
        let certificate: Buffer | string;
        let privateKey: Buffer | string;
        if (certPath && keyPath) {
            if (!isAbsolute(certPath) || !isAbsolute(keyPath)) {
                throw new Error('Machine control TLS certificate and key paths must be absolute');
            }
            [certificate, privateKey] = await Promise.all([readFile(certPath), readFile(keyPath)]);
        } else {
            const generated = await generateMachineControlServerCertificate(
                new URL(publicUrl).hostname,
                authority.caCert,
                authority.caKey,
            );
            certificate = generated.certificatePem;
            privateKey = generated.privateKeyPem;
        }
        const expectedPath = new URL(publicUrl).pathname;
        this.server = createServer({
            cert: certificate,
            key: privateKey,
            ca: authority.caCert,
            minVersion: 'TLSv1.3',
            requestCert: true,
            rejectUnauthorized: true,
        });
        this.webSocketServer = new WebSocketServer({
            noServer: true,
            maxPayload: MACHINE_CONTROL_MAX_MESSAGE_BYTES,
            perMessageDeflate: false,
        });
        this.server.on('request', (_request, response) => {
            response.writeHead(404).end();
        });
        this.server.on('upgrade', (request, socket, head) => {
            void this.handleUpgrade(expectedPath, request, socket as TLSSocket, head);
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            this.server!.once('error', onError);
            this.server!.listen(this.config.getOrThrow('MACHINE_CONTROL_PORT'), '0.0.0.0', () => {
                this.server!.off('error', onError);
                resolve();
            });
        });
        this.pingTimer = setInterval(() => this.pingSessions(), PING_INTERVAL_MS);
        this.pingTimer.unref();
        this.logger.log(
            `Machine control gateway listening on port ${this.config.getOrThrow('MACHINE_CONTROL_PORT')}`,
        );
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        for (const session of this.sessions.values()) {
            session.close(1001, 'server shutting down');
        }
        await Promise.all([
            new Promise<void>((resolve) => {
                if (!this.webSocketServer) return resolve();
                this.webSocketServer.close(() => resolve());
            }),
            new Promise<void>((resolve) => {
                if (!this.server) return resolve();
                this.server.close(() => resolve());
            }),
        ]);
    }

    async dispatchReady(machineUuid: string): Promise<void> {
        const session = this.sessions.get(machineUuid);
        if (session?.readyState === WebSocket.OPEN) {
            await this.sendReadyCommands(session, machineUuid);
        }
    }

    isReady(): boolean {
        return this.server?.listening === true;
    }

    private async handleUpgrade(
        expectedPath: string,
        request: IncomingMessage,
        socket: TLSSocket,
        head: Buffer,
    ): Promise<void> {
        try {
            if (new URL(request.url ?? '/', 'https://localhost').pathname !== expectedPath) {
                return rejectUpgrade(socket, 404, 'Not Found');
            }
            const machineUuid = singleHeader(request.headers[MACHINE_ID_HEADER]);
            if (!machineUuid || !socket.authorized) {
                return rejectUpgrade(socket, 401, 'Unauthorized');
            }
            const peer = socket.getPeerCertificate();
            if (!peer.raw || peer.subject?.CN !== machineUuid) {
                return rejectUpgrade(socket, 401, 'Unauthorized');
            }
            const machine = await this.machinesRepository.findByUuid(machineUuid);
            const fingerprint = createHash('sha256').update(peer.raw).digest('hex');
            if (
                !machine ||
                machine.archivedAt ||
                !machine.clientCertFingerprint ||
                !machine.clientCertExpiresAt ||
                machine.clientCertExpiresAt <= new Date() ||
                !safeFingerprintEqual(machine.clientCertFingerprint, fingerprint)
            ) {
                return rejectUpgrade(socket, 401, 'Unauthorized');
            }

            this.webSocketServer!.handleUpgrade(request, socket, head, (webSocket) => {
                this.startSession(webSocket, machineUuid);
            });
        } catch (error) {
            this.logger.warn(`Rejected Machine Agent connection: ${safeError(error)}`);
            rejectUpgrade(socket, 400, 'Bad Request');
        }
    }

    private startSession(webSocket: WebSocket, machineUuid: string): void {
        const oldSession = this.sessions.get(machineUuid);
        if (oldSession) {
            oldSession.close(4001, 'superseded by a new session');
        }
        this.sessions.set(machineUuid, webSocket);
        this.liveness.set(webSocket, true);
        const state: SessionState = { machineUuid, helloReceived: false };
        const helloTimer = setTimeout(
            () => webSocket.close(4002, 'hello message not received'),
            HELLO_TIMEOUT_MS,
        );
        helloTimer.unref();

        let pipeline = Promise.resolve();
        webSocket.on('pong', () => this.liveness.set(webSocket, true));
        webSocket.on('message', (data, isBinary) => {
            pipeline = pipeline
                .then(() => this.handleMessage(webSocket, state, data, isBinary))
                .catch((error) => {
                    this.logger.warn(
                        `Closing invalid Machine Agent session ${machineUuid}: ${safeError(error)}`,
                    );
                    webSocket.close(4003, 'invalid control message');
                });
        });
        webSocket.on('close', () => {
            clearTimeout(helloTimer);
            if (this.sessions.get(machineUuid) === webSocket) {
                this.sessions.delete(machineUuid);
            }
        });
        webSocket.on('error', (error) => {
            this.logger.warn(`Machine Agent session ${machineUuid} error: ${safeError(error)}`);
        });
    }

    private async handleMessage(
        webSocket: WebSocket,
        state: SessionState,
        data: Buffer | ArrayBuffer | Buffer[],
        isBinary: boolean,
    ): Promise<void> {
        if (isBinary) {
            throw new Error('binary control messages are not supported');
        }
        const envelope = agentEnvelopeSchema.parse(
            JSON.parse(Buffer.concat(toBuffers(data)).toString()),
        );

        if (!state.helloReceived && envelope.type !== 'hello') {
            throw new Error('hello must be the first control message');
        }
        if (envelope.type === 'hello') {
            if (state.helloReceived) throw new Error('duplicate hello message');
            const hello = helloSchema.parse(envelope.payload);
            if (hello.machineId !== state.machineUuid) throw new Error('machine identity mismatch');
            const connected = await this.machinesRepository.markAgentConnected({
                uuid: state.machineUuid,
                agentVersion: hello.agentVersion,
                capabilities: [...new Set(hello.capabilities)].sort(),
                now: new Date(),
            });
            if (!connected) throw new Error('machine is no longer eligible to connect');
            state.helloReceived = true;
            await this.machinesRepository.resetRunningCommands(state.machineUuid);
            await this.machinesRepository.ensureInventoryCommand(state.machineUuid, new Date());
            await this.machinesRepository.ensureWarpCommand(state.machineUuid, new Date());
            await this.sendReadyCommands(webSocket, state.machineUuid);
            return;
        }
        if (envelope.type === 'heartbeat') {
            const heartbeat = heartbeatSchema.parse(envelope.payload);
            if (heartbeat.machineId !== state.machineUuid)
                throw new Error('machine identity mismatch');
            const updated = await this.machinesRepository.markAgentHeartbeat(
                state.machineUuid,
                new Date(),
            );
            if (!updated) throw new Error('machine is no longer eligible to connect');
            await this.machinesRepository.ensureWarpCommand(state.machineUuid, new Date());
            await this.sendReadyCommands(webSocket, state.machineUuid);
            return;
        }

        const result = commandResultSchema.parse(envelope.payload);
        const commandKind = await this.machinesRepository.getActiveCommandKind(
            state.machineUuid,
            result.commandId,
            result.idempotencyKey,
        );
        if (!commandKind) throw new Error('unknown or already completed command result');
        const validatedResult =
            result.status !== 'succeeded'
                ? result.payload
                : commandKind === 'inventory'
                  ? inventorySchema.parse(result.payload)
                  : commandKind === 'preflight'
                    ? preflightResultSchema.parse(result.payload)
                    : commandKind === 'reconcile_instance'
                      ? reconcileInstanceResultSchema.parse(result.payload)
                      : commandKind === 'reconcile_certificate'
                        ? reconcileCertificateResultSchema.parse(result.payload)
                        : commandKind === 'reconcile_warp'
                          ? reconcileWarpResultSchema.parse(result.payload)
                          : commandKind === 'apply_config'
                            ? applyConfigResultSchema.parse(result.payload)
                            : commandKind === 'start_instance' || commandKind === 'stop_instance'
                              ? lifecycleResultSchema.parse(result.payload)
                              : result.payload;
        const preflightFailed =
            commandKind === 'preflight' &&
            result.status === 'succeeded' &&
            preflightResultSchema.parse(validatedResult).ok === false;
        const errorMessage = preflightFailed
            ? summarizePreflightFailure(preflightResultSchema.parse(validatedResult))
            : result.status === 'succeeded'
              ? undefined
              : sanitizeAgentMessage(result.message);
        const accepted = await this.machinesRepository.completeCommand({
            machineUuid: state.machineUuid,
            commandUuid: result.commandId,
            idempotencyKey: result.idempotencyKey,
            status: preflightFailed ? 'failed' : result.status,
            errorCode: preflightFailed ? 'PREFLIGHT_FAILED' : result.errorCode,
            errorMessage,
            result: validatedResult,
            completedAt: new Date(),
        });
        if (!accepted) throw new Error('unknown or already completed command result');
        await this.sendReadyCommands(webSocket, state.machineUuid);
    }

    private async sendReadyCommands(webSocket: WebSocket, machineUuid: string): Promise<void> {
        const commands = await this.machinesRepository.getReadyCommands(machineUuid, new Date());
        for (const command of commands) {
            if (webSocket.readyState !== WebSocket.OPEN) return;
            webSocket.send(
                JSON.stringify(
                    commandEnvelope({
                        uuid: command.uuid,
                        kind: command.kind,
                        idempotencyKey: command.idempotencyKey,
                        deadlineAt: command.deadlineAt,
                        payload: command.payload,
                    }),
                ),
            );
        }
    }

    private pingSessions(): void {
        for (const session of this.sessions.values()) {
            if (!this.liveness.get(session)) {
                session.terminate();
                continue;
            }
            this.liveness.set(session, false);
            session.ping();
        }
    }
}

function singleHeader(value: string | string[] | undefined): string | null {
    return typeof value === 'string' ? value : null;
}

function safeFingerprintEqual(expected: string, actual: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function rejectUpgrade(socket: TLSSocket, status: number, reason: string): void {
    if (!socket.destroyed) {
        socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    }
}

function toBuffers(data: Buffer | ArrayBuffer | Buffer[]): Buffer[] {
    if (Array.isArray(data)) return data;
    return [Buffer.isBuffer(data) ? data : Buffer.from(data)];
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'unknown error';
    return message.slice(0, 1024).replaceAll('\0', '');
}

function summarizePreflightFailure(result: z.infer<typeof preflightResultSchema>): string {
    const message = result.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name}: ${check.message}`)
        .join('; ');
    return (
        sanitizeAgentMessage(message || 'Machine preflight failed') ?? 'Machine preflight failed'
    );
}

function sanitizeAgentMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    const redacted = message
        .replaceAll('\0', '')
        .replace(
            /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
            '[REDACTED PRIVATE KEY]',
        )
        .replace(/mrw_enroll_[A-Za-z0-9_-]+/g, '[REDACTED]')
        .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
        .replace(
            /((?:token|secret|password|private[_-]?key|client[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
            '$1[REDACTED]',
        );
    return redacted.slice(0, 1024);
}
