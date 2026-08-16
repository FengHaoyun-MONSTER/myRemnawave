# ADR-003: Machine plus logical node instances

Status: accepted

Date: 2026-08-16

## Context

Upstream Remnawave makes `Nodes.address` globally unique and uses config-profile
inbounds as both runtime configuration and squad authorization. That cannot
represent multiple independent protocols on one physical server and causes
shared configuration to leak access across nodes.

## Decision

- Add `Machines` as physical hosts.
- Retain `Nodes` as logical Node Instances during the transition, remove address
  identity semantics, and link each node to one Machine.
- Add a stable protocol/endpoint identity independent from Xray tags.
- Authorize `InternalSquads` directly to Nodes through an explicit join table.
- Make the runtime user set and subscription host set derive from the same
  effective node-access query.
- Add versioned protocol templates and compile node-specific parameters at
  dispatch time.

This is a fresh-install target. No legacy production data migration is promised,
but migrations must still produce a valid empty database and preserve database
constraints.

## Consequences

Existing profile/inbound authorization queries must be replaced together rather
than partially adapted. Host exclusions remain presentation controls and cannot
grant runtime access.
