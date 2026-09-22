CREATE TYPE "ConnectorStatus" AS ENUM ('active', 'revoked');

CREATE TABLE "Connector" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "status" "ConnectorStatus" NOT NULL DEFAULT 'active',
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OAuthState" (
  "state" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "pkceVerifierEncrypted" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);
CREATE UNIQUE INDEX "Connector_userId_providerId_key" ON "Connector"("userId", "providerId");
CREATE INDEX "Connector_userId_status_idx" ON "Connector"("userId", "status");
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
