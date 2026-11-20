ALTER TABLE "zone_entry_rules" ADD COLUMN "event_type" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "zone_entry_rules" ADD CONSTRAINT "zone_entry_rule_event_type" CHECK ("zone_entry_rules"."event_type" in ('entry', 'exit', 'both'));
--> statement-breakpoint
GRANT UPDATE (event_type) ON TABLE zone_entry_rules TO sensewell_app;
