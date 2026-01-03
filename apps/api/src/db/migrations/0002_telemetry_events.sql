CREATE TABLE "telemetry_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" text,
	"session_id" integer,
	"event_type" text NOT NULL,
	"value" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;
