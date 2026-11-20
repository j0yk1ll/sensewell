ALTER TABLE "replay_zone_entries" ADD COLUMN "direction" text DEFAULT 'entry' NOT NULL;--> statement-breakpoint
ALTER TABLE "replay_zone_entries" ADD CONSTRAINT "replay_zone_entry_direction" CHECK ("replay_zone_entries"."direction" in ('entry', 'exit'));
--> statement-breakpoint
GRANT UPDATE (zone_id, name, minimum_confidence), DELETE ON TABLE zone_entry_rules TO sensewell_app;
