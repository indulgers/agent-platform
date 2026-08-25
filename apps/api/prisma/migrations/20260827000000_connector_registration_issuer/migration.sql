ALTER TABLE "OAuthClientRegistration" ADD COLUMN "issuer" TEXT;

DROP INDEX "OAuthClientRegistration_providerId_callbackUrl_key";

CREATE UNIQUE INDEX "OAuthClientRegistration_providerId_callbackUrl_issuer_key" ON "OAuthClientRegistration"("providerId", "callbackUrl", "issuer");

ALTER TABLE "Connector" ADD COLUMN "registrationId" TEXT;

ALTER TABLE "Connector" ADD CONSTRAINT "Connector_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OAuthClientRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
