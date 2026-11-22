ALTER TABLE "cameras" DROP CONSTRAINT "camera_source";--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "camera_source" CHECK (
    ("cameras"."encrypted_stream" is null
      and "cameras"."duration_ms" is not null and "cameras"."start_offset_ms" is not null)
    or (("cameras"."encrypted_stream" is not null) <> ("cameras"."removed_at" is not null)
      and "cameras"."duration_ms" is null and "cameras"."start_offset_ms" is null)
  );--> statement-breakpoint
DROP POLICY "ip_camera_removal" ON "cameras";--> statement-breakpoint
CREATE POLICY "camera_removal" ON "cameras" AS RESTRICTIVE FOR UPDATE TO "sensewell_app" USING ("cameras"."removed_at" is null) WITH CHECK ("cameras"."removed_at" is not null and "cameras"."encrypted_stream" is null);