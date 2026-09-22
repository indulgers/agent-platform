# Notion MCP dynamic client registration

## Goal

Let the Notion remote-MCP connector register and reuse its OAuth client
automatically, without requiring a manually configured `NOTION_MCP_CLIENT_ID`
or a Notion REST API client secret.

## Scope

This design applies to remote MCP providers that advertise an RFC 7591
`registration_endpoint`. The first provider is Notion at
`https://mcp.notion.com/mcp`.

It does not add a direct Notion REST API connector and does not use credentials
created for `https://api.notion.com/v1/oauth/*`.

## Data model

Add `OAuthClientRegistration` with:

- `id`: opaque primary key.
- `providerId` and `callbackUrl`: jointly unique identity of a registered
  public OAuth client. A changed callback URL creates a separate registration.
- `clientId`: registration result required by authorization and token exchange.
- `clientSecretEncrypted`: optional AES-256-GCM envelope using the existing
  `CONNECTOR_ENCRYPTION_KEY`; no plaintext client secret is persisted.
- `createdAt` and `updatedAt`: audit and lifecycle timestamps.

Registrations are shared by all users. User-specific authorization state and
access/refresh tokens remain in `OAuthState` and `Connector`, respectively.

## Registration flow

`ConnectorsService.startAuthorization` will:

1. Resolve the provider and callback URL.
2. Discover OAuth metadata.
3. Find a registration for the provider and callback URL.
4. If absent, POST to `metadata.registration_endpoint` with a public PKCE
   client descriptor: the callback URL, authorization-code and refresh-token
   grants, `code` response type, and `token_endpoint_auth_method: none`.
5. Persist the result, using the database unique constraint as the cross-process
   reuse boundary. On a concurrent create conflict, read and use the winner.
6. Create encrypted per-user PKCE state and return the authorization URL using
   the stored client ID.

If discovery does not advertise a registration endpoint, authorization fails
with a clear configuration error rather than falling back to a manually supplied
client ID.

## Callback and token lifecycle

`OAuthState` records the registration identity when authorization starts. The
callback and refresh flows read that registration so the original client ID and
optional client secret are used even if a deployment later changes its callback
URL.

Token exchange remains form-encoded. It sends `client_id`; if dynamic
registration returned a client secret, it also sends it in the form body, which
matches the registered token-endpoint authentication method selected at
registration time.

## Security and operations

- `CONNECTOR_ENCRYPTION_KEY` remains required before any credential or OAuth
  state is persisted.
- Do not add the supplied Notion REST API secret to `.env`; it is incompatible
  with the MCP client flow and should be rotated after having been shared.
- Remove `NOTION_MCP_CLIENT_ID` from required connector configuration examples.
- A fresh database registers once at the first user connection; a deployed API
  applies the schema migration before serving requests.

## Tests

- Unit-test metadata parsing and registration request/response handling with a
  mocked HTTP boundary.
- Service tests cover first registration, reuse, and a concurrent unique-key
  conflict.
- Regression-test that authorization uses the registered client ID and callback
  flow retrieves the registration identified by OAuth state.
- Verify the existing API suite, typecheck, Prisma migration status, and a
  local authenticated authorization request.
