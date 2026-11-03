---
name: high-performance-backend-architecture
description: Apply architecture-first design and implementation standards for backend, database, networking, concurrency, security, distributed systems, and native integrations. Use when designing or changing production-like software behavior.
---

# High-Performance Backend Architecture

## Mission

Design the simplest correct, secure, efficient, observable, and maintainable solution that fits the existing system. Performance is a requirement, not an excuse to weaken correctness or security.

## Architecture-first workflow

Before implementation:
1. Read repository instructions and the approved project profile.
2. Understand the current component boundaries and trace the full execution path.
3. State the problem in observable terms and distinguish evidence from assumptions.
4. Identify ownership of state, resources, transactions, and lifecycle.
5. Evaluate correctness, failure behavior, security, performance, compatibility, operability, and rollback.
6. Compare viable designs and explain trade-offs.
7. Define acceptance criteria and verification before coding.
8. In Planning Mode or for breaking architectural changes, obtain explicit user approval. In Execution Mode, proceed autonomously to implementation once acceptance criteria are defined.

Never begin implementation without clear acceptance criteria and verification.

## Universal design principles

- Single authoritative owner for each mutable domain state.
- Explicit contracts between components; avoid leaking infrastructure through abstractions.
- Dependency direction should reflect ownership and stable interfaces.
- Keep domain logic separate from transport, persistence, UI, and process orchestration where the existing system benefits from those boundaries.
- Avoid both god objects and fragmentation into excessive tiny modules.
- Prefer cohesive modules and explicit lifecycle boundaries.
- Preserve existing external contracts unless a breaking change is approved.
- Make failure, timeout, cancellation, retry, and shutdown behavior explicit.
- Observability must not silently alter business behavior or become an unbounded workload.

## Database and data integrity

For every persistence change, determine:
- Source of truth and ownership.
- Schema and migration lifecycle.
- Transaction boundaries and isolation requirements.
- Unique constraints and idempotency keys.
- Locking and contention behavior.
- Atomicity of claim/update/ack workflows.
- Retry and duplicate-delivery behavior.
- Consistency between in-memory and persistent state.
- Rollback and recovery behavior.

Do not infer that a queue claim is atomic from a locking hint alone. Inspect the complete transaction and status transition. Do not introduce migrations or execute them without explicit authorization.

## Async, concurrency, and performance

- Establish actual concurrency before declaring a race.
- Identify thread/task ownership, synchronization, cancellation, backpressure, and resource disposal.
- Do not assume ConcurrentDictionary makes multi-step business operations atomic.
- Avoid sync-over-async in latency-sensitive paths when the call chain can be made asynchronous safely; trace the entire call chain first.
- Use bounded queues for work that can accumulate. Define overflow, backpressure, durability, ordering, retries, and shutdown flushing.
- Measure or derive cost from query count, payload size, allocation rate, lock duration, and scheduling behavior.
- Do not prescribe Channels, pooling layers, caches, or batching solely because they are absent.
- Distinguish logical connection objects from physical connection pooling and transport reuse.

## Networking and distributed systems

- Document process topology separately from module/DLL boundaries.
- Identify trust boundaries, authentication and admission stages, protocol ownership, ordering, timeout, reconnect, replay, and message-delivery guarantees.
- Define what happens during partial outages and restarts.
- Treat transport success as distinct from application-level acknowledgement.
- Preserve protocol compatibility and versioning.

## Security

- Treat security as an end-to-end flow with explicit trust boundaries.
- Prefer server-authoritative decisions and fail-closed behavior where required by the threat model.
- Validate all untrusted inputs at the owning boundary.
- Protect secrets; do not assume a client-held secret remains secret.
- Ensure authentication, authorization, revocation, replay prevention, rate limits, and audit semantics are coherent.
- Avoid security-by-obscurity as the sole control.
- Never weaken an existing control to make a test pass without explicit approval and threat-model analysis.

## Native and mixed-language systems

When a project contains native code or mixed runtimes:
- Establish process topology and actual load boundaries.
- Verify architecture/bitness, ABI, calling conventions, structure layout, object lifetime, ownership, and exception boundaries.
- Identify thread affinity and whether callbacks may block.
- Verify memory protections, expected original bytes, instruction-cache handling, and rollback.
- Do not invent offsets, addresses, opcodes, signatures, or binary layouts.
- Treat build success as distinct from runtime verification in the target process.

## Implementation discipline

After plan approval:
- Re-check working-tree state and protect unrelated modifications.
- Implement only the approved scope.
- Prefer cohesive, incremental changes.
- Add tests for behavior and failure paths.
- Update documentation only with verified facts.
- Do not perform Git history operations, database writes, deployment, or destructive actions without separate authorization.
- Stop and request clarification when source evidence contradicts the plan.

## Definition of done

A change is not complete until:
- The intended behavior and acceptance criteria are demonstrated.
- Relevant tests are run and their actual scope is stated.
- Integration and runtime checks are performed when necessary, or explicitly marked unverified.
- Security, concurrency, performance, and compatibility implications are reviewed.
- The independent reviewer has returned a verdict.
- Remaining risks and rollback steps are documented.
