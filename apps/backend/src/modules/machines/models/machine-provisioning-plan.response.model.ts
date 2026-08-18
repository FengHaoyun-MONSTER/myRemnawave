import { MachineProvisioningPlans } from '@prisma/client';

export class MachineProvisioningPlanResponseModel {
    uuid: string;
    machineUuid: string;
    status: string;
    result: unknown | null;
    errorCode: string | null;
    errorMessage: string | null;
    expiresAt: Date;
    appliedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(plan: MachineProvisioningPlans) {
        this.uuid = plan.uuid;
        this.machineUuid = plan.machineUuid;
        this.status = plan.status;
        this.result = plan.result;
        this.errorCode = plan.errorCode;
        this.errorMessage = plan.errorMessage;
        this.expiresAt = plan.expiresAt;
        this.appliedAt = plan.appliedAt;
        this.createdAt = plan.createdAt;
        this.updatedAt = plan.updatedAt;
    }
}
