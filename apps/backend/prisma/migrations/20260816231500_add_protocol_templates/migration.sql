ALTER TABLE "nodes"
    ADD COLUMN "protocol_settings" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "desired_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "applied_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "certificate_mode" VARCHAR(32),
    ADD COLUMN "certificate_status" VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN "certificate_expires_at" TIMESTAMP(3),
    ADD COLUMN "certificate_blocked_at" TIMESTAMP(3),
    ADD CONSTRAINT "nodes_revision_check" CHECK ("desired_revision" >= 0 AND "applied_revision" >= 0 AND "applied_revision" <= "desired_revision"),
    ADD CONSTRAINT "nodes_certificate_mode_check" CHECK ("certificate_mode" IS NULL OR "certificate_mode" IN ('HTTP_01', 'IMPORT_EXISTING')),
    ADD CONSTRAINT "nodes_certificate_status_check" CHECK ("certificate_status" IN ('NOT_REQUIRED', 'PENDING', 'ISSUING', 'VALID', 'RENEWING', 'FAILED'));

ALTER TABLE "hosts"
    ADD COLUMN "reality_public_key" VARCHAR(128),
    ADD COLUMN "reality_short_id" VARCHAR(16),
    ADD CONSTRAINT "hosts_reality_short_id_check" CHECK ("reality_short_id" IS NULL OR "reality_short_id" ~ '^[0-9a-f]{2,16}$');

ALTER TABLE "config_profiles"
    ADD COLUMN "template_key" VARCHAR(32),
    ADD COLUMN "template_version" INTEGER,
    ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "is_immutable" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "config_profiles_template_identity_check" CHECK (
        ("template_key" IS NULL AND "template_version" IS NULL AND "is_system" = false AND "is_immutable" = false)
        OR
        ("template_key" IN ('VLESS_REALITY', 'VLESS_TLS_VISION', 'HYSTERIA2') AND "template_version" > 0 AND "is_system" = true AND "is_immutable" = true)
    );

CREATE UNIQUE INDEX "config_profiles_template_key_template_version_key"
    ON "config_profiles"("template_key", "template_version");

ALTER TABLE "machine_commands"
    ADD COLUMN "queue_sequence" BIGSERIAL NOT NULL;

CREATE INDEX "machine_commands_machine_uuid_status_queue_sequence_idx"
    ON "machine_commands"("machine_uuid", "status", "queue_sequence");
