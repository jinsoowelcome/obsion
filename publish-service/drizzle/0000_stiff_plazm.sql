CREATE TABLE `publish_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `published_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
