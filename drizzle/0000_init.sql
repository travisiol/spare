CREATE TABLE "adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"roundup_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"authorized_cents" integer NOT NULL,
	"instrument_symbol" text NOT NULL,
	"funding_connection_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"statement" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"env" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"external_ref" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "demo_provider_ops" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"final_status" text NOT NULL,
	"polls_left" integer NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"env" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"journal_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"batch_id" uuid,
	"account" text NOT NULL,
	"unit" text NOT NULL,
	"amount" numeric(60, 0) NOT NULL,
	"memo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"env" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"instrument_symbol" text NOT NULL,
	"notional_cents" integer NOT NULL,
	"status" text NOT NULL,
	"filled_qty" text,
	"fill_price" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"instrument_symbol" text,
	"weekly_cap_cents" integer NOT NULL,
	"cap_confirmed_at" timestamp with time zone,
	"approval_acknowledged_at" timestamp with time zone,
	"tracking_activated_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"demo_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"pending_external_id" text,
	"merchant" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"instrument_symbol" text NOT NULL,
	"price" text NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roundup_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" uuid,
	"carried_from_batch_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"destination" text NOT NULL,
	"instrument_symbol" text NOT NULL,
	"qty" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"env" text NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'received' NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"env" text NOT NULL,
	"wallet_address" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"eligibility_attested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"env" text NOT NULL,
	"week_start" text NOT NULL,
	"timezone" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'tracking' NOT NULL,
	"instrument_symbol" text,
	"total_cents" integer,
	"fee_cents" integer,
	"authorized_cents" integer,
	"snapshot_hash" text,
	"frozen_at" timestamp with time zone,
	"approve_by" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_funding_connection_id_connections_id_fk" FOREIGN KEY ("funding_connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_provider_ops" ADD CONSTRAINT "demo_provider_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_attempts" ADD CONSTRAINT "funding_attempts_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roundup_entries" ADD CONSTRAINT "roundup_entries_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roundup_entries" ADD CONSTRAINT "roundup_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_batch_id_weekly_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."weekly_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_batches" ADD CONSTRAINT "weekly_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adjustments_purchase" ON "adjustments" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_batch" ON "approvals" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "audit_created" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_provider_ref" ON "connections" USING btree ("provider","external_ref");--> statement-breakpoint
CREATE INDEX "connections_user" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_attempts_key" ON "funding_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_attempts_one_live" ON "funding_attempts" USING btree ("batch_id") WHERE status <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_key" ON "jobs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_journal_line" ON "ledger_entries" USING btree ("journal_key","account","unit");--> statement-breakpoint
CREATE INDEX "ledger_user" ON "ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_key" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_live" ON "orders" USING btree ("batch_id") WHERE status <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_provider_external" ON "purchases" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_provider_pending" ON "purchases" USING btree ("provider","pending_external_id");--> statement-breakpoint
CREATE INDEX "purchases_user" ON "purchases" USING btree ("user_id","authorized_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roundup_entries_purchase" ON "roundup_entries" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "roundup_entries_batch" ON "roundup_entries" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_order" ON "settlements" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_key" ON "settlements" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_provider_ref" ON "settlements" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_events_provider_event" ON "transaction_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_env_wallet" ON "users" USING btree ("env","wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_batches_user_week" ON "weekly_batches" USING btree ("user_id","week_start");