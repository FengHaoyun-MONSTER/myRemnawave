-- Create the physical machine control-plane tables.
CREATE TABLE "machines" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'XX',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "note" VARCHAR(255),
    "agent_version" VARCHAR(64),
    "agent_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "agent_connected_at" TIMESTAMP(3),
    "agent_last_seen_at" TIMESTAMP(3),
    "system_info" JSONB,
    "enrollment_token_hash" VARCHAR(128),
    "enrollment_expires_at" TIMESTAMP(3),
    "enrollment_used_at" TIMESTAMP(3),
    "client_cert_serial" VARCHAR(128),
    "client_cert_fingerprint" VARCHAR(128),
    "client_cert_expires_at" TIMESTAMP(3),
    "warp_status" VARCHAR(32) NOT NULL DEFAULT 'DISABLED',
    "warp_proxy_port" INTEGER,
    "warp_last_checked" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "machines_pkey" PRIMARY KEY ("uuid"),
    CONSTRAINT "machines_status_check" CHECK ("status" IN ('DRAFT', 'ENROLLING', 'PROVISIONING', 'CONNECTED', 'CONFIG_VALIDATED', 'PUBLISHED', 'DEGRADED', 'FAILED', 'DRAINING', 'DISABLED', 'ARCHIVED')),
    CONSTRAINT "machines_warp_status_check" CHECK ("warp_status" IN ('DISABLED', 'INSTALLING', 'CONNECTING', 'CONNECTED', 'DEGRADED', 'FAILED')),
    CONSTRAINT "machines_warp_proxy_port_check" CHECK ("warp_proxy_port" IS NULL OR "warp_proxy_port" BETWEEN 1 AND 65535)
);

CREATE UNIQUE INDEX "machines_name_key" ON "machines"("name");
CREATE UNIQUE INDEX "machines_address_key" ON "machines"("address");
CREATE UNIQUE INDEX "machines_enrollment_token_hash_key" ON "machines"("enrollment_token_hash");
CREATE UNIQUE INDEX "machines_client_cert_serial_key" ON "machines"("client_cert_serial");
CREATE UNIQUE INDEX "machines_client_cert_fingerprint_key" ON "machines"("client_cert_fingerprint");
CREATE INDEX "machines_status_idx" ON "machines"("status");
CREATE INDEX "machines_agent_last_seen_at_idx" ON "machines"("agent_last_seen_at");

-- Re-identify upstream nodes as logical protocol instances.
DROP INDEX "nodes_address_key";
ALTER TABLE "nodes"
    ADD COLUMN "machine_uuid" UUID,
    ADD COLUMN "endpoint_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "protocol_key" VARCHAR(32),
    ADD COLUMN "lifecycle_state" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "external_port" INTEGER,
    ADD COLUMN "external_network" VARCHAR(3);

ALTER TABLE "nodes"
    ADD CONSTRAINT "nodes_lifecycle_state_check" CHECK ("lifecycle_state" IN ('DRAFT', 'ENROLLING', 'PROVISIONING', 'CONNECTED', 'CONFIG_VALIDATED', 'PUBLISHED', 'DEGRADED', 'FAILED', 'DRAINING', 'DISABLED', 'ARCHIVED')),
    ADD CONSTRAINT "nodes_protocol_key_check" CHECK ("protocol_key" IS NULL OR "protocol_key" IN ('VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2')),
    ADD CONSTRAINT "nodes_external_port_check" CHECK ("external_port" IS NULL OR "external_port" BETWEEN 1 AND 65535),
    ADD CONSTRAINT "nodes_external_network_check" CHECK ("external_network" IS NULL OR "external_network" IN ('tcp', 'udp')),
    ADD CONSTRAINT "nodes_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machines"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "nodes_endpoint_uuid_key" ON "nodes"("endpoint_uuid");
CREATE UNIQUE INDEX "nodes_machine_uuid_protocol_key_key" ON "nodes"("machine_uuid", "protocol_key");
CREATE INDEX "nodes_machine_uuid_idx" ON "nodes"("machine_uuid");

-- Commands are durable, replay-safe desired-state operations for the Agent.
CREATE TABLE "machine_commands" (
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "machine_uuid" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error_code" VARCHAR(64),
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "machine_commands_pkey" PRIMARY KEY ("uuid"),
    CONSTRAINT "machine_commands_status_check" CHECK ("status" IN ('QUEUED', 'SENT', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT "machine_commands_machine_uuid_fkey" FOREIGN KEY ("machine_uuid") REFERENCES "machines"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "machine_commands_idempotency_key_key" ON "machine_commands"("idempotency_key");
CREATE INDEX "machine_commands_machine_uuid_status_idx" ON "machine_commands"("machine_uuid", "status");
CREATE INDEX "machine_commands_deadline_at_idx" ON "machine_commands"("deadline_at");

-- Node authorization is now explicit and no longer derived from config tags.
CREATE TABLE "internal_squad_nodes" (
    "internal_squad_uuid" UUID NOT NULL,
    "node_uuid" UUID NOT NULL,
    CONSTRAINT "internal_squad_nodes_pkey" PRIMARY KEY ("internal_squad_uuid", "node_uuid"),
    CONSTRAINT "internal_squad_nodes_internal_squad_uuid_fkey" FOREIGN KEY ("internal_squad_uuid") REFERENCES "internal_squads"("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_squad_nodes_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "internal_squad_nodes_node_uuid_idx" ON "internal_squad_nodes"("node_uuid");

-- Tags only need to be unique inside one reusable profile.
DROP INDEX "config_profile_inbounds_tag_key";
CREATE UNIQUE INDEX "config_profile_inbounds_profile_uuid_tag_key" ON "config_profile_inbounds"("profile_uuid", "tag");
