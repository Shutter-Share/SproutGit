PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_hook_dependencies` (
	`hook_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`hook_id`, `depends_on_id`),
	FOREIGN KEY (`hook_id`) REFERENCES `hook_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `hook_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_hook_dependencies`("hook_id", "depends_on_id") SELECT "hook_id", "depends_on_id" FROM `hook_dependencies`;--> statement-breakpoint
DROP TABLE `hook_dependencies`;--> statement-breakpoint
ALTER TABLE `__new_hook_dependencies` RENAME TO `hook_dependencies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;