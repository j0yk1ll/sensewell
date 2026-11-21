ALTER TABLE "replay_zone_entries" ADD COLUMN "object_type" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "zone_entry_rules" ADD COLUMN "object_types" text[] DEFAULT ARRAY['person']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "zone_entry_rules" ADD CONSTRAINT "zone_entry_rule_objects" CHECK (cardinality("zone_entry_rules"."object_types") > 0);
--> statement-breakpoint
GRANT UPDATE (object_types) ON TABLE zone_entry_rules TO sensewell_app;
