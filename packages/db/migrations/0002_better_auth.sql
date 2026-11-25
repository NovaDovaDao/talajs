-- 0002_better_auth: invitations, member names and PINs, the audit log, and the tables for
-- built-in sign-in (@talajs/auth, Better Auth). People, sessions and accounts aren't tenant data,
-- so they live in their own schema, "tala_auth".
-- Generated from prisma/schema.prisma with `prisma migrate diff`, plus hand-written
-- constraints at the end that Prisma's schema language cannot express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tala_auth";

-- AlterTable
ALTER TABLE "tala"."membership" ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "pin_digest" TEXT,
ADD COLUMN     "pin_set_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "tala"."tenant" ADD COLUMN     "pin_length" SMALLINT NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "tala"."terminal" ADD COLUMN     "pin_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_locked_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "tala"."invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "tala"."member_role" NOT NULL,
    "store_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "invited_by" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala_auth"."user" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala_auth"."session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala_auth"."account" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala_auth"."verification" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala_auth"."rate_limit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "tala"."invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "tala"."invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tenant_id_id_key" ON "tala"."invitation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "tala"."audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_tenant_id_id_key" ON "tala"."audit_log"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "tala_auth"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "tala_auth"."session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "tala_auth"."session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "tala_auth"."account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_id_account_id_key" ON "tala_auth"."account"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "tala_auth"."verification"("identifier");

-- AddForeignKey
ALTER TABLE "tala"."invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala_auth"."session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tala_auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala_auth"."account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tala_auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Tala: constraints not expressible in schema.prisma ────────────────────────

ALTER TABLE "tala"."tenant" ADD CONSTRAINT "tenant_pin_length_range" CHECK ("pin_length" BETWEEN 4 AND 6);
ALTER TABLE "tala"."membership" ADD CONSTRAINT "membership_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "tala"."invitation" ADD CONSTRAINT "invitation_email_lowercase" CHECK ("email" = lower("email"));

-- At most one pending invitation per email in a tenant.
CREATE UNIQUE INDEX "invitation_pending_email_key" ON "tala"."invitation" ("tenant_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Registers learn about people through the sync feed's "staff" entity; announce existing members.
INSERT INTO "tala"."change_log" ("tenant_id", "entity", "entity_id", "op")
SELECT "tenant_id", 'staff', "id", CASE WHEN "revoked_at" IS NULL THEN 'upsert' ELSE 'archive' END
FROM "tala"."membership";
