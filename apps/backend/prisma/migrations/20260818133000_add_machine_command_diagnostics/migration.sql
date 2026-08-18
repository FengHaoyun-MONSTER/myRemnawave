-- Persist bounded, redacted control-plane diagnostics for operators.
ALTER TABLE "machine_commands"
    ADD COLUMN "error_message" VARCHAR(1024);

ALTER TABLE "machines"
    ADD COLUMN "last_error_code" VARCHAR(64),
    ADD COLUMN "last_status_message" VARCHAR(1024);

ALTER TABLE "nodes"
    ADD COLUMN "last_error_code" VARCHAR(64);
