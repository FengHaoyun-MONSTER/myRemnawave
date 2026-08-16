import { fromNanoToNumber } from '@common/utils/nano';
import { TNodeIps } from '@libs/contracts/models';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';
import { InfraProviderEntity } from '@modules/infra-billing/entities';

import { NodesEntity } from '../entities';
import { INodeHotCache, INodeSystem, INodeVersions } from '../interfaces';

export class NodeResponseModel {
    public uuid: string;
    public id: number;
    public name: string;
    public address: string;
    public port: null | number;
    public proxyUrl: string | null;
    public machineUuid: string | null;
    public endpointUuid: string;
    public protocolKey: string | null;
    public lifecycleState: string;
    public isPublished: boolean;
    public externalPort: number | null;
    public externalNetwork: 'tcp' | 'udp' | null;
    public protocolSettings: Record<string, unknown>;
    public desiredRevision: number;
    public appliedRevision: number;
    public certificateMode: 'HTTP_01' | 'IMPORT_EXISTING' | null;
    public certificateStatus:
        | 'NOT_REQUIRED'
        | 'PENDING'
        | 'ISSUING'
        | 'VALID'
        | 'RENEWING'
        | 'FAILED';
    public certificateExpiresAt: Date | null;
    public isConnected: boolean;
    public isConnecting: boolean;
    public isDisabled: boolean;
    public lastStatusChange: Date | null;
    public lastStatusMessage: null | string;
    public trafficResetDay: null | number;
    public consumptionMultiplier: number;
    public nodeConsumptionMultiplier: number;
    public isTrafficTrackingActive: boolean;
    public trafficLimitBytes: null | number;
    public trafficUsedBytes: null | number;
    public notifyPercent: null | number;
    public note: null | string;
    public viewPosition: number;
    public countryCode: string;
    public tags: string[];
    public ips: TNodeIps;
    public createdAt: Date;
    public updatedAt: Date;

    public configProfile: {
        activeConfigProfileUuid: string | null;
        activeInbounds: ConfigProfileInboundEntity[];
    };
    public providerUuid: string | null;
    public provider: InfraProviderEntity | null;
    public activePluginUuid: string | null;

    public xrayUptime: number;
    public usersOnline: number;
    public system: INodeSystem | null;
    public versions: INodeVersions | null;

    constructor(data: NodesEntity, hotCache: INodeHotCache) {
        this.uuid = data.uuid;
        this.id = Number(data.id);
        this.name = data.name;
        this.address = data.address;
        this.port = data.port;
        this.proxyUrl = data.proxyUrl;
        this.machineUuid = data.machineUuid;
        this.endpointUuid = data.endpointUuid;
        this.protocolKey = data.protocolKey;
        this.lifecycleState = data.lifecycleState;
        this.isPublished = data.isPublished;
        this.externalPort = data.externalPort;
        this.externalNetwork = data.externalNetwork;
        this.protocolSettings = data.protocolSettings;
        this.desiredRevision = data.desiredRevision;
        this.appliedRevision = data.appliedRevision;
        this.certificateMode = data.certificateMode;
        this.certificateStatus = data.certificateStatus;
        this.certificateExpiresAt = data.certificateExpiresAt;
        this.isConnected = data.isConnected;
        this.isConnecting = data.isConnecting;
        this.isDisabled = data.isDisabled;
        this.lastStatusChange = data.lastStatusChange;
        this.lastStatusMessage = data.lastStatusMessage;
        this.isTrafficTrackingActive = data.isTrafficTrackingActive;
        this.trafficResetDay = data.trafficResetDay;
        this.trafficLimitBytes = Number(data.trafficLimitBytes);
        this.trafficUsedBytes = Number(data.trafficUsedBytes);
        this.notifyPercent = data.notifyPercent;
        this.note = data.note;
        this.consumptionMultiplier = fromNanoToNumber(data.consumptionMultiplier);
        this.nodeConsumptionMultiplier = fromNanoToNumber(data.nodeConsumptionMultiplier);
        this.tags = data.tags;
        this.ips = data.ips;
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;

        this.viewPosition = data.viewPosition;
        this.countryCode = data.countryCode;

        this.configProfile = {
            activeConfigProfileUuid: data.activeConfigProfileUuid,
            activeInbounds: data.activeInbounds,
        };

        this.providerUuid = data.providerUuid;
        this.provider = data.provider;
        this.activePluginUuid = data.activePluginUuid;

        this.system = hotCache.system;
        this.usersOnline = hotCache.onlineUsers;
        this.versions = hotCache.versions;
        this.xrayUptime = hotCache.xrayUptime;
    }
}
