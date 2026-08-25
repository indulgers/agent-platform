# Notion MCP Dynamic Client Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Notion remote-MCP connector to discover, dynamically register, and durably reuse a PKCE OAuth client without a manually configured client ID.

**Architecture:** Persist one `OAuthClientRegistration` per provider and callback URL, encrypted with the existing connector key when a registration response contains a secret. `ConnectorsService` delegates discovery registration and token-client lookup to a focused registration service, and each OAuth state records the registration that initiated it so callback and refresh exchange credentials consistently.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vitest, native `fetch`, AES-256-GCM via `TokenCrypto`.

**Spec:** `docs/superpowers/specs/2026-08-25-notion-mcp-dynamic-client-registration-design.md`

## Global Constraints

- Use Notion MCP OAuth discovery and RFC 7591 dynamic registration; do not use the supplied Notion REST API OAuth secret.
- Keep all persisted client secrets encrypted with `CONNECTOR_ENCRYPTION_KEY`; do not log or commit them.
- Share registrations by exact `providerId + callbackUrl`; user grants remain in `OAuthState` and `Connector`.
- Keep `OAuthState.registrationId` nullable for migration safety; new authorization states must set it and callbacks without one must fail safely.
- Use test-first red-green cycles for every production behavior change.

---

### Task 1: Persist OAuth client registrations

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260826000000_oauth_client_registrations/migration.sql`
- Test: `apps/api/src/connectors/oauth-client-registration.service.spec.ts`

**Interfaces:**
- Produces Prisma model `OAuthClientRegistration` with `providerId`, `callbackUrl`, `clientId`, optional `clientSecretEncrypted`, timestamps, and unique `[providerId, callbackUrl]`.
- Produces optional `OAuthState.registrationId` and relation `OAuthState.registration`.

- [ ] **Step 1: Write the failing persistence test**

Create the test fixture for the registration service with a fake Prisma delegate. Assert that the service stores the dynamic client ID, encrypts a returned secret, and writes the exact provider/callback identity:

```ts
await service.getOrCreate('notion', 'http://localhost:3000/api/connectors/callback/notion', metadata)
expect(prisma.oAuthClientRegistration.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    providerId: 'notion',
    callbackUrl: 'http://localhost:3000/api/connectors/callback/notion',
    clientId: 'registered-client',
  }),
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/oauth-client-registration.service.spec.ts`

Expected: FAIL because `OAuthClientRegistrationService` and its Prisma delegate do not exist.

- [ ] **Step 3: Add the schema and migration**

Add these models and fields:

```prisma
model OAuthClientRegistration {
  id                    String   @id @default(cuid())
  providerId            String
  callbackUrl           String
  clientId              String
  clientSecretEncrypted String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  oauthStates           OAuthState[]

  @@unique([providerId, callbackUrl])
}

model OAuthState {
  // existing fields
  registrationId String?
  registration   OAuthClientRegistration? @relation(fields: [registrationId], references: [id])
}
```

Create SQL that creates `OAuthClientRegistration`, its compound unique index, adds nullable `registrationId` to `OAuthState`, and adds the foreign key with `ON DELETE RESTRICT`.

- [ ] **Step 4: Run Prisma generation and the persistence test**

Run: `pnpm db:generate && pnpm --filter @agent-platform/api exec vitest run src/connectors/oauth-client-registration.service.spec.ts`

Expected: the test still fails only because the service has not been implemented.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260826000000_oauth_client_registrations/migration.sql apps/api/src/connectors/oauth-client-registration.service.spec.ts
git commit -m "feat: persist OAuth client registrations"
```

### Task 2: Register and reuse dynamic OAuth clients

**Files:**
- Create: `apps/api/src/connectors/oauth-client-registration.service.ts`
- Modify: `apps/api/src/connectors/oauth-metadata.ts`
- Modify: `apps/api/src/connectors/connectors.module.ts`
- Modify: `apps/api/src/connectors/oauth-client-registration.service.spec.ts`

**Interfaces:**
- Consumes `OAuthMetadata.registration_endpoint?: string`, `PrismaService`, and `TokenCrypto`.
- Produces `OAuthClientRegistrationService.getOrCreate(providerId, callbackUrl, metadata): Promise<{ id: string; clientId: string; clientSecret?: string }>`.
- Produces `OAuthClientRegistrationService.byId(id): Promise<{ id: string; clientId: string; clientSecret?: string }>`.

- [ ] **Step 1: Extend the failing test for registration and reuse**

Add two cases:

```ts
it('registers a public PKCE client when no durable registration exists', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client' }), { status: 201 })))
  await service.getOrCreate('notion', 'http://localhost:3000/api/connectors/callback/notion', metadata)
  expect(fetch).toHaveBeenCalledWith('https://mcp.notion.com/register', expect.objectContaining({ method: 'POST' }))
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    client_name: 'agent-platform',
    redirect_uris: ['http://localhost:3000/api/connectors/callback/notion'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
})

it('reuses a durable registration without calling the registration endpoint', async () => {
  prisma.oAuthClientRegistration.findUnique.mockResolvedValue({ id: 'registration-1', providerId: 'notion', callbackUrl: 'http://localhost:3000/api/connectors/callback/notion', clientId: 'registered-client', clientSecretEncrypted: null })
  await expect(service.getOrCreate('notion', 'http://localhost:3000/api/connectors/callback/notion', metadata)).resolves.toMatchObject({ id: 'registration-1', clientId: 'registered-client' })
  expect(fetch).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/oauth-client-registration.service.spec.ts`

Expected: FAIL because metadata does not expose `registration_endpoint` and no registration service exists.

- [ ] **Step 3: Implement metadata and registration service**

Extend `OAuthMetadata` with `registration_endpoint?: string`. In the service:

```ts
const request = {
  client_name: 'agent-platform',
  redirect_uris: [callbackUrl],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
}
```

POST JSON to `metadata.registration_endpoint`; reject non-2xx responses and responses without `client_id`. Encrypt only a non-empty `client_secret`. If `create` hits Prisma `P2002`, read the already-created row and return it. Register this service in `ConnectorsModule`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/oauth-client-registration.service.spec.ts src/connectors/oauth-metadata.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/connectors/oauth-client-registration.service.ts apps/api/src/connectors/oauth-client-registration.service.spec.ts apps/api/src/connectors/oauth-metadata.ts apps/api/src/connectors/connectors.module.ts
git commit -m "feat: dynamically register Notion MCP OAuth clients"
```

### Task 3: Bind authorizations and token exchange to their registration

**Files:**
- Modify: `apps/api/src/connectors/connectors.service.ts`
- Create: `apps/api/src/connectors/connectors.service.spec.ts`
- Modify: `apps/api/src/connectors/oauth-client-registration.service.ts`

**Interfaces:**
- Consumes `OAuthClientRegistrationService` through constructor injection.
- `startAuthorization` stores `registrationId` on the new `OAuthState` and uses the registration client ID.
- `finishAuthorization` reads `saved.registrationId`, exchanges with that client, and fails with `OAuth state has no client registration` if absent.
- `refresh` loads the registration selected by the connector's provider and current callback URL before exchanging the refresh token.

- [ ] **Step 1: Write the failing authorization-flow tests**

Create a `ConnectorsService` fixture that mocks only Prisma persistence and the registration service. Assert:

```ts
await service.startAuthorization('user-1', 'notion')
expect(prisma.oAuthState.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ registrationId: 'registration-1' }),
})

prisma.oAuthState.findUnique.mockResolvedValue({ state: 'old-state', providerId: 'notion', registrationId: null })
await expect(service.finishAuthorization('notion', 'old-state', 'code')).rejects.toThrow('OAuth state has no client registration')
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/connectors.service.spec.ts`

Expected: FAIL because the service constructor has no registration dependency and OAuth state records no registration ID.

- [ ] **Step 3: Implement the registration-bound flow**

Inject `OAuthClientRegistrationService`. During start, resolve callback URL, discover metadata, get or create the registration, and persist its ID with the PKCE state. During callback, include `registration` when reading OAuth state and pass that registration's `clientId` and optional secret into the token exchange. During refresh, retrieve or create the registration for the provider/current callback URL before exchange.

Change `exchange` to receive `{ clientId, clientSecret? }` and append `client_id`; append `client_secret` only when present. Retain form URL encoding and existing invalid-grant revocation handling.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/connectors.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/connectors/connectors.service.ts apps/api/src/connectors/connectors.service.spec.ts apps/api/src/connectors/oauth-client-registration.service.ts
git commit -m "feat: bind connector grants to dynamic OAuth clients"
```

### Task 4: Remove manual MCP client configuration and verify deployment

**Files:**
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `DEPLOY.md`
- Modify: `apps/api/src/config/env.ts`
- Test: `apps/api/src/connectors/connectors.service.spec.ts`

**Interfaces:**
- Removes `NOTION_MCP_CLIENT_ID` from environment parsing and documentation.
- Keeps `CONNECTOR_CALLBACK_URL` and `CONNECTOR_ENCRYPTION_KEY` as required operational settings for the connector flow.

- [ ] **Step 1: Write the failing configuration expectation**

Add a service test that starts authorization with a registration returned from the dynamic-registration service and no `NOTION_MCP_CLIENT_ID` in the process environment. Assert the generated URL contains the dynamically registered `client_id`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @agent-platform/api exec vitest run src/connectors/connectors.service.spec.ts`

Expected: FAIL while configuration still requires the manual client-ID path.

- [ ] **Step 3: Remove the manual client-ID configuration**

Delete `NOTION_MCP_CLIENT_ID` from the Zod schema and both environment examples. Update deployment guidance: only the callback URL and a base64-encoded 32-byte `CONNECTOR_ENCRYPTION_KEY` are configured manually; Notion MCP client registration runs automatically on first connection.

- [ ] **Step 4: Apply and verify the migration locally**

Run:

```bash
pnpm db:deploy
pnpm --filter @agent-platform/api exec prisma migrate status --schema=prisma/schema.prisma
```

Expected: the registration migration applies once and status reports the database schema is up to date.

- [ ] **Step 5: Run complete validation**

Run:

```bash
pnpm --filter @agent-platform/api typecheck
pnpm --filter @agent-platform/api test
docker build --file deploy/Dockerfile.api --tag agent-platform-api:dynamic-oauth-check .
```

Then start the API with a valid locally generated connector encryption key, invoke authenticated `POST /api/connectors/notion/authorize`, and assert a 201 response whose URL uses the dynamically registered client ID and Notion MCP authorization endpoint.

- [ ] **Step 6: Commit**

```bash
git add .env.example .env.production.example DEPLOY.md apps/api/src/config/env.ts apps/api/src/connectors/connectors.service.spec.ts
git commit -m "docs: configure automatic Notion MCP registration"
```
