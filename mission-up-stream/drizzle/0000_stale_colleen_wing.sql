CREATE TABLE `admin_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_user_id` text NOT NULL,
	`player_id` text,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_player` ON `admin_audit` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `daily_categories` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`metric` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_challenges` (
	`challenge_date` text PRIMARY KEY NOT NULL,
	`category_key` text NOT NULL,
	`selection_mode` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`winner_player_id` text,
	`finalized_at` text,
	FOREIGN KEY (`category_key`) REFERENCES `daily_categories`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_daily_challenges_category` ON `daily_challenges` (`category_key`);--> statement-breakpoint
CREATE TABLE `daily_scores` (
	`challenge_date` text NOT NULL,
	`player_id` text NOT NULL,
	`baseline_value` integer NOT NULL,
	`latest_value` integer NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`challenge_date`, `player_id`),
	FOREIGN KEY (`challenge_date`) REFERENCES `daily_challenges`(`challenge_date`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_daily_scores_rank` ON `daily_scores` (`challenge_date`,`score`);--> statement-breakpoint
CREATE TABLE `player_stats` (
	`player_id` text PRIMARY KEY NOT NULL,
	`cash` integer DEFAULT 0 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`fish_caught` integer DEFAULT 0 NOT NULL,
	`shiny_fish_caught` integer DEFAULT 0 NOT NULL,
	`quests_completed` integer DEFAULT 0 NOT NULL,
	`fish_sold` integer DEFAULT 0 NOT NULL,
	`money_earned` integer DEFAULT 0 NOT NULL,
	`money_spent` integer DEFAULT 0 NOT NULL,
	`orbs_clicked` integer DEFAULT 0 NOT NULL,
	`playtime_seconds` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`status_text` text DEFAULT '' NOT NULL,
	`presence` text DEFAULT 'offline' NOT NULL,
	`last_seen_at` text,
	`daily_medals` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_players_presence` ON `players` (`presence`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trophies` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`tournament_id` text NOT NULL,
	`placement` integer NOT NULL,
	`score` integer,
	`awarded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_trophies_player` ON `trophies` (`player_id`);--> statement-breakpoint
CREATE INDEX `idx_trophies_tournament` ON `trophies` (`tournament_id`);