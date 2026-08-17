-- Preserve a short-lived, non-secret enrollment response so an Agent can
-- safely retry after an ambiguous network failure without rotating its token.
ALTER TABLE "machines"
    ADD COLUMN "enrollment_replay_token_hash" VARCHAR(128),
    ADD COLUMN "enrollment_attempt_id" UUID,
    ADD COLUMN "enrollment_csr_fingerprint" VARCHAR(64),
    ADD COLUMN "enrollment_response" JSONB,
    ADD COLUMN "enrollment_replay_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "machines_enrollment_replay_token_hash_key"
    ON "machines"("enrollment_replay_token_hash");
