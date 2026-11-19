CREATE TABLE "camera_recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "camera_recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "synthetic_cameras" ALTER COLUMN "duration_ms" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "synthetic_cameras" ALTER COLUMN "start_offset_ms" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "synthetic_cameras" ADD COLUMN "encrypted_stream" text;
--> statement-breakpoint
ALTER TABLE "synthetic_cameras" ADD COLUMN "removed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "camera_recordings" ADD CONSTRAINT "camera_recordings_camera_fk" FOREIGN KEY ("tenant_id","camera_id") REFERENCES "public"."synthetic_cameras"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "camera_recordings_tenant_id_camera_id_started_at_index" ON "camera_recordings" USING btree ("tenant_id","camera_id","started_at");
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "camera_recordings" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("camera_recordings"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("camera_recordings"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE synthetic_cameras RENAME TO cameras;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE camera_recordings TO sensewell_app;
--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "camera_source" CHECK (
    ("cameras"."encrypted_stream" is null and "cameras"."removed_at" is null
      and "cameras"."duration_ms" is not null and "cameras"."start_offset_ms" is not null)
    or (("cameras"."encrypted_stream" is not null) <> ("cameras"."removed_at" is not null)
      and "cameras"."duration_ms" is null and "cameras"."start_offset_ms" is null)
  );
--> statement-breakpoint
CREATE POLICY "ip_camera_removal" ON "cameras" AS RESTRICTIVE FOR UPDATE TO "sensewell_app" USING ("cameras"."encrypted_stream" is not null) WITH CHECK ("cameras"."removed_at" is not null and "cameras"."encrypted_stream" is null);
--> statement-breakpoint
GRANT UPDATE (removed_at, encrypted_stream) ON TABLE cameras TO sensewell_app;
