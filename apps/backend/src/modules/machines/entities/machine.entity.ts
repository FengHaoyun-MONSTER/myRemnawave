import { Machines, Prisma } from '@prisma/client';

export class MachineEntity implements Machines {
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
    systemInfo: Prisma.JsonValue | null;
    enrollmentTokenHash: string | null;
    enrollmentExpiresAt: Date | null;
    enrollmentUsedAt: Date | null;
    clientCertSerial: string | null;
    clientCertFingerprint: string | null;
    clientCertExpiresAt: Date | null;
    warpStatus: string;
    warpProxyPort: number | null;
    warpLastChecked: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: Machines) {
        Object.assign(this, data);
    }
}
