# Project Architecture Profile

> Copy this template to the target repository as .architecture/PROJECT_PROFILE.md only after read-only discovery and user approval. Replace every placeholder with verified information. Mark unknowns explicitly. Do not invent intended architecture.

## 1. Project identity

- Project name:
- Purpose:
- Repository:
- Current baseline branch/commit:
- Profile version/date:
- Profile evidence owner:

## 2. Technology and runtime inventory

| Area | Verified technology/version | Evidence | Unknowns |
|---|---|---|---|
| Languages | | | |
| Frameworks/runtimes | | | |
| Build systems/toolchains | | | |
| Databases/storage | | | |
| Messaging/networking | | | |
| Deployment/hosting | | | |
| Operating systems/architectures | | | |

## 3. Component map

| Component | Responsibility | Runtime boundary | Dependencies | State/data owned |
|---|---|---|---|---|
| | | | | |

## 4. Execution and integration flows

Describe important end-to-end flows, including entry points, component transitions, persistence, external calls, errors, retries, timeouts, and shutdown.

## 5. Data ownership and persistence

- Authoritative sources of truth:
- Mutable state owners:
- Transaction boundaries:
- Schema/migration ownership:
- Cache and invalidation rules:
- Messaging/queue delivery guarantees:
- Data retention and audit requirements:

## 6. Security boundaries

- Trust boundaries:
- Authentication/authorization owners:
- Secret storage:
- Input validation boundaries:
- Network exposure:
- Fail-open/fail-closed requirements:
- Audit and incident response:

## 7. Concurrency and performance

- Thread/task/process ownership:
- Hot paths:
- Synchronization and queueing:
- Backpressure and overload behavior:
- Known performance budgets and measurements:

## 8. Protected paths and prohibited operations

- Vendor/submodule/generated paths:
- Sensitive configuration:
- Database restrictions:
- Native/binary restrictions:
- Deployment restrictions:
- Git operations requiring separate approval:

## 9. Build and verification

| Verification layer | Command/procedure | What it proves | What it does not prove |
|---|---|---|---|
| Static analysis | | | |
| Build | | | |
| Unit tests | | | |
| Integration tests | | | |
| System tests | | | |
| Runtime/manual tests | | | |

## 10. Architecture invariants

List only verified or explicitly approved invariants. Label each as CONFIRMED_IN_CODE, CONFIRMED_BY_TEST, CONFIRMED_AT_RUNTIME, or USER_APPROVED_REQUIREMENT.

## 11. Known risks, contradictions, and unknowns

| Item | Evidence | Confidence | Required follow-up |
|---|---|---|---|
| | | | |

## 12. Architectural decisions

Link to decision records. Do not silently rewrite historical decisions; supersede them with a dated decision and rationale.
