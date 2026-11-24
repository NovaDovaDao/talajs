-- 0001_init: Tala commerce core schema.
-- Generated from prisma/schema.prisma with `prisma migrate diff`, plus hand-written
-- constraints at the end that Prisma's schema language cannot express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tala";

-- CreateEnum
CREATE TYPE "tala"."member_role" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "tala"."stock_movement_reason" AS ENUM ('SALE', 'VOID', 'REFUND', 'ADJUST', 'RECOUNT', 'RECEIVE');

-- CreateEnum
CREATE TYPE "tala"."order_status" AS ENUM ('OPEN', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "tala"."order_source" AS ENUM ('POS', 'ONLINE', 'ADMIN');

-- CreateEnum
CREATE TYPE "tala"."payment_method" AS ENUM ('CASH', 'CARD', 'CRYPTO');

-- CreateEnum
CREATE TYPE "tala"."payment_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "tala"."refund_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "tala"."payment_account_status" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "tala"."sync_mutation_status" AS ENUM ('APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "tala"."review_kind" AS ENUM ('SYNC_CONFLICT', 'NEGATIVE_STOCK', 'PAYMENT_MISMATCH');

-- CreateEnum
CREATE TYPE "tala"."review_status" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "tala"."tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "default_currency" CHAR(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."store" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT false,
    "next_order_number" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "role" "tala"."member_role" NOT NULL,
    "store_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."terminal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "token_hash" TEXT,
    "pairing_code_hash" TEXT,
    "pairing_expires_at" TIMESTAMPTZ(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."tax_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tax_rate_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."item_category" (
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_category_pkey" PRIMARY KEY ("tenant_id","item_id","category_id")
);

-- CreateTable
CREATE TABLE "tala"."variant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stock_level_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."modifier_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."modifier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL DEFAULT 0,
    "stock_level_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."item_modifier_group" (
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_modifier_group_pkey" PRIMARY KEY ("tenant_id","item_id","group_id")
);

-- CreateTable
CREATE TABLE "tala"."store_item" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "price_override_minor" INTEGER,

    CONSTRAINT "store_item_pkey" PRIMARY KEY ("tenant_id","store_id","item_id")
);

-- CreateTable
CREATE TABLE "tala"."stock_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "track_strictly" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_level_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "tala"."stock_movement_reason" NOT NULL,
    "order_line_id" UUID,
    "sync_mutation_id" UUID,
    "note" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."customer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."customer_note" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."tag" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."customer_tag" (
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "customer_tag_pkey" PRIMARY KEY ("tenant_id","customer_id","tag_id")
);

-- CreateTable
CREATE TABLE "tala"."order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "terminal_id" UUID,
    "customer_id" UUID,
    "number" TEXT NOT NULL,
    "status" "tala"."order_status" NOT NULL DEFAULT 'OPEN',
    "source" "tala"."order_source" NOT NULL,
    "is_tab" BOOLEAN NOT NULL DEFAULT false,
    "tab_name" TEXT,
    "note" TEXT,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" INTEGER NOT NULL DEFAULT 0,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "tip_minor" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "receipt_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "item_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "unit_price_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "modifiers_total_minor" INTEGER NOT NULL DEFAULT 0,
    "line_total_minor" INTEGER NOT NULL,
    "note" TEXT,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" TEXT NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."order_line_modifier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "modifier_id" UUID,
    "group_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL,

    CONSTRAINT "order_line_modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "terminal_id" UUID,
    "method" "tala"."payment_method" NOT NULL,
    "provider" TEXT,
    "status" "tala"."payment_status" NOT NULL DEFAULT 'PENDING',
    "amount_minor" INTEGER NOT NULL,
    "tip_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "external_id" TEXT,
    "asset" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."refund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "tala"."refund_status" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "line_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."payment_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "status" "tala"."payment_account_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."provider_event" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "tenant_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "provider_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."sync_mutation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "client_ts" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "tala"."sync_mutation_status" NOT NULL,
    "result" JSONB,

    CONSTRAINT "sync_mutation_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "tala"."review_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "tala"."review_kind" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "sync_mutation_id" UUID,
    "details" JSONB NOT NULL,
    "status" "tala"."review_status" NOT NULL DEFAULT 'OPEN',
    "resolution" JSONB,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."domain_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "order_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "domain_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tala"."change_log" (
    "seq" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "store_id" UUID,
    "op" TEXT NOT NULL,
    "txid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tala"."tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "store_tenant_id_id_key" ON "tala"."store"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_tenant_id_slug_key" ON "tala"."store"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "membership_subject_idx" ON "tala"."membership"("subject");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_id_key" ON "tala"."membership"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_subject_key" ON "tala"."membership"("tenant_id", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_token_hash_key" ON "tala"."terminal"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_pairing_code_hash_key" ON "tala"."terminal"("pairing_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_tenant_id_id_key" ON "tala"."terminal"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_tenant_id_store_id_code_key" ON "tala"."terminal"("tenant_id", "store_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_tenant_id_id_key" ON "tala"."tax_rate"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_id_key" ON "tala"."category"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_tenant_id_id_key" ON "tala"."item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "item_category_tenant_id_category_id_idx" ON "tala"."item_category"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "variant_tenant_id_item_id_idx" ON "tala"."variant"("tenant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_tenant_id_id_key" ON "tala"."variant"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_tenant_id_sku_key" ON "tala"."variant"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_group_tenant_id_id_key" ON "tala"."modifier_group"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "modifier_tenant_id_group_id_idx" ON "tala"."modifier"("tenant_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_tenant_id_id_key" ON "tala"."modifier"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_level_tenant_id_store_id_idx" ON "tala"."stock_level"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_level_tenant_id_id_key" ON "tala"."stock_level"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_stock_level_id_created_at_idx" ON "tala"."stock_movement"("tenant_id", "stock_level_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_tenant_id_id_key" ON "tala"."stock_movement"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "tala"."customer"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_email_key" ON "tala"."customer"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_phone_key" ON "tala"."customer"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "customer_note_tenant_id_customer_id_created_at_idx" ON "tala"."customer_note"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_note_tenant_id_id_key" ON "tala"."customer_note"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_tenant_id_id_key" ON "tala"."tag"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_tenant_id_name_key" ON "tala"."tag"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customer_tag_tenant_id_tag_id_idx" ON "tala"."customer_tag"("tenant_id", "tag_id");

-- CreateIndex
CREATE INDEX "order_tenant_id_store_id_status_opened_at_idx" ON "tala"."order"("tenant_id", "store_id", "status", "opened_at");

-- CreateIndex
CREATE INDEX "order_tenant_id_customer_id_opened_at_idx" ON "tala"."order"("tenant_id", "customer_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_tenant_id_id_key" ON "tala"."order"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_tenant_id_store_id_number_key" ON "tala"."order"("tenant_id", "store_id", "number");

-- CreateIndex
CREATE INDEX "order_line_tenant_id_order_id_idx" ON "tala"."order_line"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_tenant_id_id_key" ON "tala"."order_line"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "order_line_modifier_tenant_id_order_line_id_idx" ON "tala"."order_line_modifier"("tenant_id", "order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_modifier_tenant_id_id_key" ON "tala"."order_line_modifier"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_order_id_idx" ON "tala"."payment"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_id_key" ON "tala"."payment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_external_id_key" ON "tala"."payment"("provider", "external_id");

-- CreateIndex
CREATE INDEX "refund_tenant_id_payment_id_idx" ON "tala"."refund"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_tenant_id_id_key" ON "tala"."refund"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_account_tenant_id_id_key" ON "tala"."payment_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_account_tenant_id_provider_key" ON "tala"."payment_account"("tenant_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "payment_account_provider_external_account_id_key" ON "tala"."payment_account"("provider", "external_account_id");

-- CreateIndex
CREATE INDEX "provider_event_processed_at_idx" ON "tala"."provider_event"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_event_provider_external_id_key" ON "tala"."provider_event"("provider", "external_id");

-- CreateIndex
CREATE INDEX "sync_mutation_tenant_id_terminal_id_received_at_idx" ON "tala"."sync_mutation"("tenant_id", "terminal_id", "received_at");

-- CreateIndex
CREATE INDEX "review_item_tenant_id_status_created_at_idx" ON "tala"."review_item"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_item_tenant_id_id_key" ON "tala"."review_item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "domain_event_processed_at_created_at_idx" ON "tala"."domain_event"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_tenant_id_id_key" ON "tala"."domain_event"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "change_log_tenant_id_seq_idx" ON "tala"."change_log"("tenant_id", "seq");

-- AddForeignKey
ALTER TABLE "tala"."store" ADD CONSTRAINT "store_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."terminal" ADD CONSTRAINT "terminal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."terminal" ADD CONSTRAINT "terminal_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "tala"."store"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."category" ADD CONSTRAINT "category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."category" ADD CONSTRAINT "category_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "tala"."category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item" ADD CONSTRAINT "item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item" ADD CONSTRAINT "item_tenant_id_tax_rate_id_fkey" FOREIGN KEY ("tenant_id", "tax_rate_id") REFERENCES "tala"."tax_rate"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item_category" ADD CONSTRAINT "item_category_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "tala"."item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item_category" ADD CONSTRAINT "item_category_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "tala"."category"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."variant" ADD CONSTRAINT "variant_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "tala"."item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."variant" ADD CONSTRAINT "variant_tenant_id_stock_level_id_fkey" FOREIGN KEY ("tenant_id", "stock_level_id") REFERENCES "tala"."stock_level"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."modifier_group" ADD CONSTRAINT "modifier_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."modifier" ADD CONSTRAINT "modifier_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "tala"."modifier_group"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."modifier" ADD CONSTRAINT "modifier_tenant_id_stock_level_id_fkey" FOREIGN KEY ("tenant_id", "stock_level_id") REFERENCES "tala"."stock_level"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item_modifier_group" ADD CONSTRAINT "item_modifier_group_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "tala"."item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."item_modifier_group" ADD CONSTRAINT "item_modifier_group_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "tala"."modifier_group"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."store_item" ADD CONSTRAINT "store_item_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "tala"."store"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."store_item" ADD CONSTRAINT "store_item_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "tala"."item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."stock_level" ADD CONSTRAINT "stock_level_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."stock_level" ADD CONSTRAINT "stock_level_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "tala"."store"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_stock_level_id_fkey" FOREIGN KEY ("tenant_id", "stock_level_id") REFERENCES "tala"."stock_level"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "tala"."order_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."customer" ADD CONSTRAINT "customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."customer_note" ADD CONSTRAINT "customer_note_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "tala"."customer"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."tag" ADD CONSTRAINT "tag_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."customer_tag" ADD CONSTRAINT "customer_tag_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "tala"."customer"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."customer_tag" ADD CONSTRAINT "customer_tag_tenant_id_tag_id_fkey" FOREIGN KEY ("tenant_id", "tag_id") REFERENCES "tala"."tag"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "tala"."store"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_tenant_id_terminal_id_fkey" FOREIGN KEY ("tenant_id", "terminal_id") REFERENCES "tala"."terminal"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "tala"."customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order_line" ADD CONSTRAINT "order_line_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "tala"."order"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order_line" ADD CONSTRAINT "order_line_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "tala"."variant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order_line_modifier" ADD CONSTRAINT "order_line_modifier_tenant_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "tala"."order_line"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."order_line_modifier" ADD CONSTRAINT "order_line_modifier_tenant_id_modifier_id_fkey" FOREIGN KEY ("tenant_id", "modifier_id") REFERENCES "tala"."modifier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."payment" ADD CONSTRAINT "payment_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "tala"."order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."payment" ADD CONSTRAINT "payment_tenant_id_terminal_id_fkey" FOREIGN KEY ("tenant_id", "terminal_id") REFERENCES "tala"."terminal"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."refund" ADD CONSTRAINT "refund_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "tala"."payment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."payment_account" ADD CONSTRAINT "payment_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."sync_mutation" ADD CONSTRAINT "sync_mutation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."sync_mutation" ADD CONSTRAINT "sync_mutation_tenant_id_terminal_id_fkey" FOREIGN KEY ("tenant_id", "terminal_id") REFERENCES "tala"."terminal"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."review_item" ADD CONSTRAINT "review_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."review_item" ADD CONSTRAINT "review_item_tenant_id_sync_mutation_id_fkey" FOREIGN KEY ("tenant_id", "sync_mutation_id") REFERENCES "tala"."sync_mutation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tala"."domain_event" ADD CONSTRAINT "domain_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tala"."tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Tala: constraints not expressible in schema.prisma ────────────────────────

ALTER TABLE "tala"."tenant"   ADD CONSTRAINT "tenant_currency_iso"   CHECK ("default_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "tala"."store"    ADD CONSTRAINT "store_currency_iso"    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "tala"."variant"  ADD CONSTRAINT "variant_currency_iso"  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "tala"."order"    ADD CONSTRAINT "order_currency_iso"    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "tala"."payment"  ADD CONSTRAINT "payment_currency_iso"  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "tala"."refund"   ADD CONSTRAINT "refund_currency_iso"   CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "tala"."tax_rate" ADD CONSTRAINT "tax_rate_bps_range" CHECK ("rate_bps" BETWEEN 0 AND 100000);
ALTER TABLE "tala"."variant"  ADD CONSTRAINT "variant_price_nonneg" CHECK ("price_minor" >= 0);
ALTER TABLE "tala"."modifier_group" ADD CONSTRAINT "modifier_group_select_range"
  CHECK ("min_select" >= 0 AND "max_select" >= "min_select");

ALTER TABLE "tala"."customer" ADD CONSTRAINT "customer_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "tala"."order" ADD CONSTRAINT "order_amounts_nonneg"
  CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0 AND "tip_minor" >= 0);
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_completed_at"
  CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_voided_at"
  CHECK ("status" <> 'VOIDED' OR "voided_at" IS NOT NULL);
ALTER TABLE "tala"."order" ADD CONSTRAINT "order_tab_name"
  CHECK (NOT "is_tab" OR "tab_name" IS NOT NULL);

ALTER TABLE "tala"."order_line" ADD CONSTRAINT "order_line_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "tala"."order_line" ADD CONSTRAINT "order_line_amounts_nonneg"
  CHECK ("unit_price_minor" >= 0 AND "line_total_minor" >= 0 AND "tax_rate_bps" BETWEEN 0 AND 100000);

ALTER TABLE "tala"."payment" ADD CONSTRAINT "payment_amounts_nonneg" CHECK ("amount_minor" >= 0 AND "tip_minor" >= 0);
ALTER TABLE "tala"."payment" ADD CONSTRAINT "payment_provider_required"
  CHECK ("method" = 'CASH' OR "provider" IS NOT NULL);
ALTER TABLE "tala"."refund" ADD CONSTRAINT "refund_amount_pos" CHECK ("amount_minor" > 0);

-- Pull feed: page by (txid, seq) per tenant (see the ChangeLog model).
CREATE INDEX "change_log_tenant_id_txid_seq_idx" ON "tala"."change_log" ("tenant_id", "txid", "seq");
