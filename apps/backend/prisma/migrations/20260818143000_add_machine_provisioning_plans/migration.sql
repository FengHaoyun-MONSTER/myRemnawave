CREATE TABLE "machine_provisioning_plans" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "machine_uuid" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "request" JSONB NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "result" JSONB,
    "command_uuid" UUID,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(1024),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "machine_provisioning_plans_pkey" PRIMARY KEY ("uuid"),
    CONSTRAINT "machine_provisioning_plans_status_check" CHECK ("status" IN ('PENDING', 'READY', 'BLOCKED', 'APPLIED', 'EXPIRED', 'FAILED')),
    CONSTRAINT "machine_provisioning_plans_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machines"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "machine_provisioning_plans_command_uuid_key"
    ON "machine_provisioning_plans"("command_uuid");
CREATE INDEX "machine_provisioning_plans_machine_uuid_status_idx"
    ON "machine_provisioning_plans"("machine_uuid", "status");
CREATE INDEX "machine_provisioning_plans_expires_at_idx"
    ON "machine_provisioning_plans"("expires_at");
