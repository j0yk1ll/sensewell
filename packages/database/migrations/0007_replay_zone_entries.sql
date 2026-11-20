CREATE TABLE "replay_zone_entries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"pass_number" integer NOT NULL,
	"source_ms" integer NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_name" text NOT NULL,
	"zone" jsonb NOT NULL,
	"person_index" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replay_zone_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "zone_entry_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"minimum_confidence" double precision NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "zone_entry_rule_confidence" CHECK ("zone_entry_rules"."minimum_confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "zone_entry_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP INDEX "camera_zones_tenant_id_camera_id_index";
--> statement-breakpoint
ALTER TABLE "replay_observations" ADD COLUMN "event_jpeg" text;
--> statement-breakpoint
CREATE INDEX "zone_entry_rules_tenant_id_camera_id_zone_id_index" ON "zone_entry_rules" USING btree ("tenant_id","camera_id","zone_id");
--> statement-breakpoint
ALTER TABLE "camera_zones" ADD CONSTRAINT "camera_zones_tenant_id_camera_id_id_unique" UNIQUE("tenant_id","camera_id","id");
--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_tenant_id_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "replay_zone_entries" ADD CONSTRAINT "replay_zone_entries_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."operational_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replay_zone_entries" ADD CONSTRAINT "replay_zone_entries_observation_fk" FOREIGN KEY ("tenant_id","camera_id","pass_id","source_ms") REFERENCES "public"."replay_observations"("tenant_id","camera_id","pass_id","source_ms") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "zone_entry_rules" ADD CONSTRAINT "zone_entry_rules_zone_fk" FOREIGN KEY ("tenant_id","camera_id","zone_id") REFERENCES "public"."camera_zones"("tenant_id","camera_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "replay_zone_entries_tenant_id_camera_id_index" ON "replay_zone_entries" USING btree ("tenant_id","camera_id");
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "replay_zone_entries" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("replay_zone_entries"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("replay_zone_entries"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "zone_entry_rules" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("zone_entry_rules"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("zone_entry_rules"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE replay_zone_entries, zone_entry_rules TO sensewell_app;
--> statement-breakpoint
GRANT UPDATE (enabled, revision) ON TABLE zone_entry_rules TO sensewell_app;
