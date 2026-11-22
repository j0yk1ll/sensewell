CREATE TABLE "dwell_trigger_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"match" jsonb NOT NULL,
	"condition" jsonb NOT NULL,
	CONSTRAINT "dwell_trigger_events_trigger_id_occurrence_key_unique" UNIQUE("trigger_id","occurrence_key")
);
--> statement-breakpoint
ALTER TABLE "dwell_trigger_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dwell_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"condition" jsonb NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"active_since" timestamp (3) with time zone,
	CONSTRAINT "dwell_triggers_tenant_id_camera_id_id_unique" UNIQUE("tenant_id","camera_id","id")
);
--> statement-breakpoint
ALTER TABLE "dwell_triggers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "camera_recordings" ADD COLUMN "observations" jsonb;--> statement-breakpoint
ALTER TABLE "dwell_trigger_events" ADD CONSTRAINT "dwell_events_trigger_fk" FOREIGN KEY ("tenant_id","camera_id","trigger_id") REFERENCES "public"."dwell_triggers"("tenant_id","camera_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwell_trigger_events" ADD CONSTRAINT "dwell_events_operational_fk" FOREIGN KEY ("tenant_id","id") REFERENCES "public"."operational_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dwell_triggers" ADD CONSTRAINT "dwell_triggers_camera_fk" FOREIGN KEY ("tenant_id","camera_id") REFERENCES "public"."cameras"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dwell_trigger_events_tenant_id_camera_id_occurred_at_index" ON "dwell_trigger_events" USING btree ("tenant_id","camera_id","occurred_at");--> statement-breakpoint
CREATE INDEX "camera_recordings_pending_analysis" ON "camera_recordings" USING btree ("tenant_id","camera_id","started_at") WHERE "camera_recordings"."observations" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dwell_trigger_events" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("dwell_trigger_events"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("dwell_trigger_events"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dwell_triggers" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("dwell_triggers"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("dwell_triggers"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE dwell_triggers, dwell_trigger_events TO sensewell_app;
--> statement-breakpoint
GRANT UPDATE (reviewed, active_since) ON TABLE dwell_triggers TO sensewell_app;
--> statement-breakpoint
GRANT UPDATE (observations) ON TABLE camera_recordings TO sensewell_app;
