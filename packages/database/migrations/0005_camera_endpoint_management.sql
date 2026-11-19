CREATE TABLE "camera_endpoint_administrators" (
	"user_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "camera_endpoint_import" (
	"id" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "camera_endpoint_import_singleton" CHECK ("camera_endpoint_import"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "camera_endpoints" (
	"endpoint" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "camera_endpoint_administrators" ADD CONSTRAINT "camera_endpoint_administrators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "camera_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "camera_endpoint_read" ON "camera_endpoints" AS PERMISSIVE FOR SELECT TO "sensewell_app" USING (true);--> statement-breakpoint
CREATE POLICY "camera_endpoint_add" ON "camera_endpoints" AS PERMISSIVE FOR INSERT TO "sensewell_app" WITH CHECK (exists (
  select from "camera_endpoint_administrators"
  where user_id = nullif(current_setting('sensewell.tenant_id', true), '')::uuid
));--> statement-breakpoint
CREATE POLICY "camera_endpoint_remove" ON "camera_endpoints" AS PERMISSIVE FOR DELETE TO "sensewell_app" USING (exists (
  select from "camera_endpoint_administrators"
  where user_id = nullif(current_setting('sensewell.tenant_id', true), '')::uuid
));
--> statement-breakpoint
GRANT SELECT ON TABLE camera_endpoint_administrators TO sensewell_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE camera_endpoints TO sensewell_app;
