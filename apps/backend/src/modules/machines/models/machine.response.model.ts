import { MachineEntity } from '../entities/machine.entity';

export class MachineResponseModel {
    uuid: string;
    name: string;
    address: string;
    status: string;
    countryCode: string;
    tags: string[];
    note: string | null;
    agentVersion: string | null;
    agentCapabilities: string[];
    agentConnectedAt: Date | null;
    agentLastSeenAt: Date | null;
    systemInfo: unknown | null;
    clientCertExpiresAt: Date | null;
    warpStatus: string;
    warpProxyPort: number | null;
    warpLastChecked: Date | null;
    lastErrorCode: string | null;
    lastStatusMessage: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(machine: MachineEntity) {
        this.uuid = machine.uuid;
        this.name = machine.name;
        this.address = machine.address;
        this.status = machine.status;
        this.countryCode = machine.countryCode;
        this.tags = machine.tags;
        this.note = machine.note;
        this.agentVersion = machine.agentVersion;
        this.agentCapabilities = machine.agentCapabilities;
        this.agentConnectedAt = machine.agentConnectedAt;
        this.agentLastSeenAt = machine.agentLastSeenAt;
        this.systemInfo = machine.systemInfo;
        this.clientCertExpiresAt = machine.clientCertExpiresAt;
        this.warpStatus = machine.warpStatus;
        this.warpProxyPort = machine.warpProxyPort;
        this.warpLastChecked = machine.warpLastChecked;
        this.lastErrorCode = machine.lastErrorCode;
        this.lastStatusMessage = machine.lastStatusMessage;
        this.archivedAt = machine.archivedAt;
        this.createdAt = machine.createdAt;
        this.updatedAt = machine.updatedAt;
    }
}
