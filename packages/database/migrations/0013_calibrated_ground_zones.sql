ALTER TABLE "camera_zones" ADD COLUMN "ground" jsonb;
--> statement-breakpoint
GRANT UPDATE (ground) ON TABLE camera_zones TO sensewell_app;
