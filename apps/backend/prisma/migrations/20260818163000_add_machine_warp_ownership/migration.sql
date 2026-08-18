ALTER TABLE "machines"
ADD COLUMN "warp_ownership" VARCHAR(32) NOT NULL DEFAULT 'UNASSESSED';

ALTER TABLE "machines"
ADD CONSTRAINT "machines_warp_ownership_check"
CHECK ("warp_ownership" IN ('UNASSESSED', 'ABSENT', 'EXTERNAL', 'MANAGED', 'ADOPTED', 'CONFLICT'));
