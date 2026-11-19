CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "operational_events" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("operational_events"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("operational_events"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO sensewell_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE operational_events TO sensewell_app;
