# Task A report: OAuth client registration persistence and service

## TDD evidence

### RED

After installing the worktree dependencies, the required focused command was run before the service existed:

```text
pnpm --filter @agent-platform/api exec vitest run src/connectors/oauth-client-registration.service.spec.ts

FAIL src/connectors/oauth-client-registration.service.spec.ts
Failed to load url ./oauth-client-registration.service
```

The test therefore failed for the intended missing production service, rather
than a test setup issue. A second focused RED cycle covered the durable lookup
contract:

```text
service.byId is not a function
```

### GREEN

```text
pnpm db:generate
Generated Prisma Client (v5.22.0)

pnpm --filter @agent-platform/api exec vitest run \
  src/connectors/oauth-client-registration.service.spec.ts \
  src/connectors/oauth-metadata.spec.ts

Test Files  2 passed (2)
Tests       6 passed (6)
```

## Changed files

- `apps/api/prisma/schema.prisma`
  - Added `OAuthClientRegistration` and the optional `OAuthState` registration
    relation.
- `apps/api/prisma/migrations/20260826000000_oauth_client_registrations/migration.sql`
  - Creates the registrations table and compound unique index; adds the nullable
    state foreign key with restrictive deletion.
- `apps/api/src/connectors/oauth-client-registration.service.ts`
  - Finds/reuses registrations, dynamically registers public PKCE clients,
    encrypts non-empty secrets, handles `P2002` races, and supports lookup by ID.
- `apps/api/src/connectors/oauth-client-registration.service.spec.ts`
  - Covers persistence/encryption, registration request payload, reuse, unique
    conflict recovery, and lookup by durable ID.
- `apps/api/src/connectors/oauth-metadata.ts`
  - Adds optional `registration_endpoint` parsing.
- `apps/api/src/connectors/connectors.module.ts`
  - Registers the registration service.

## Verification

```text
pnpm --filter @agent-platform/shared build
PASS

pnpm --filter @agent-platform/api typecheck
PASS

pnpm --filter @agent-platform/api test
Test Files  11 passed | 3 skipped (14)
Tests       29 passed | 14 skipped (43)

git diff --check
PASS
```

The API suite emits pre-existing test warnings for Node's deprecated `punycode`
module and intentionally exercised tool/JSON error paths; it exits successfully.

## Self-review

- The unique database constraint is the cross-process reuse boundary; on a
  conflict, the service reads and returns the winning row.
- Client secrets are never persisted in plaintext and empty secrets remain null.
- The registration service obtains encryption lazily when it needs it, so merely
  booting the connectors module does not newly require an encryption key.
- Request fields are literal RFC 7591 public-PKCE client parameters, tested at
  the HTTP boundary.

## Concerns

None within Task A. Authorization-state linkage and use of the durable client
in authorization, callback, and refresh flows are intentionally deferred to the
subsequent tasks.

## Review fix: relation semantics and registration-response validation

### Changes

- Declared `onDelete: Restrict` explicitly on `OAuthState.registration`, matching
  the migration's `ON DELETE RESTRICT` foreign key.
- Added focused service cases for a non-2xx registration response, absent and
  empty `client_id`, and an empty `client_secret`. The pre-existing persistence
  case continues to verify that a non-empty secret is encrypted and decryptable.

### RED/GREEN evidence

The added tests were first run with their response-validation and empty-secret
behaviors absent. The focused run failed in all intended cases:

```text
expected OAuth client registration failed (503) ... received invalid JSON
expected OAuth client registration response did not include client_id ...
received Cannot read properties of undefined
expected encrypted empty secret to be null ... received encrypted value
```

After restoring the minimal checks and adding the explicit relation action:

```text
pnpm --filter @agent-platform/api exec vitest run \
  src/connectors/oauth-client-registration.service.spec.ts \
  src/connectors/oauth-metadata.spec.ts
Test Files  2 passed (2)
Tests       10 passed (10)

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agent_platform \
  pnpm --filter @agent-platform/api exec prisma validate
The schema at prisma/schema.prisma is valid

pnpm --filter @agent-platform/api typecheck
PASS
```

### Self-review and concerns

- Non-2xx responses are rejected before JSON parsing or persistence.
- An absent/empty client ID cannot reach the Prisma create call.
- Empty secrets remain `null`; the existing non-empty-secret case verifies the
  persisted envelope decrypts to the original secret.
- No concerns within this review-fix scope.
