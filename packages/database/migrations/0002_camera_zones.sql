CREATE TABLE "camera_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"name" text NOT NULL,
	"points" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "camera_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "camera_zones" ADD CONSTRAINT "camera_zones_camera_fk" FOREIGN KEY ("tenant_id","camera_id") REFERENCES "public"."synthetic_cameras"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "camera_zones_tenant_id_camera_id_index" ON "camera_zones" USING btree ("tenant_id","camera_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "camera_zones" AS PERMISSIVE FOR ALL TO "sensewell_app" USING ("camera_zones"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid) WITH CHECK ("camera_zones"."tenant_id" = nullif(current_setting('sensewell.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE camera_zones TO sensewell_app;
