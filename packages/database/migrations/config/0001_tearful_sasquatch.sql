PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
        `key` text PRIMARY KEY NOT NULL,
        `value` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("key", "value") SELECT "key", coalesce("value", '') FROM `settings`;
--> statement-breakpoint
DROP TABLE `settings`;
--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
