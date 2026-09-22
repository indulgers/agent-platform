CREATE TABLE "OAuthClientRegistration" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "callbackUrl" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientSecretEncrypted" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthClientRegistration_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OAuthState" ADD COLUMN "registrationId" TEXT;

CREATE UNIQUE INDEX "OAuthClientRegistration_providerId_callbackUrl_key" ON "OAuthClientRegistration"("providerId", "callbackUrl");

ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OAuthClientRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
