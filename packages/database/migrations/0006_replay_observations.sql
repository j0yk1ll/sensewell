CREATE TABLE "replay_observations" (
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"source_ms" integer NOT NULL,
	"people" jsonb NOT NULL,
	CONSTRAINT "replay_observations_tenant_id_camera_id_pass_id_source_ms_pk" PRIMARY KEY("tenant_id","camera_id","pass_id","source_ms"),
	CONSTRAINT "replay_observation_source_ms" CHECK ("replay_observations"."source_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "replay_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "replay_passes_tenant_id_camera_id_index";--> statement-breakpoint
ALTER TABLE "replay_passes" ADD CONSTRAINT "replay_passes_tenant_id_camera_id_id_unique" UNIQUE("tenant_id","camera_id","id");--> statement-breakpoint
ALTER TABLE "replay_observations" ADD CONSTRAINT "replay_observations_pass_fk" FOREIGN KEY ("tenant_id","camera_id","pass_id") REFERENCES "public"."replay_passes"("tenant_id","camera_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "replay_observations" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("replay_observations"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("replay_observations"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE replay_observations TO sensewell_app;
