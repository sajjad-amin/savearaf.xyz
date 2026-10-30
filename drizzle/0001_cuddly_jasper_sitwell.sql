ALTER TABLE `donations` MODIFY COLUMN `type` enum('whole_blood','platelet','platelets') NOT NULL DEFAULT 'whole_blood';--> statement-breakpoint
ALTER TABLE `donations` MODIFY COLUMN `next_eligible_date` timestamp;--> statement-breakpoint
ALTER TABLE `donations` ADD `donation_type` enum('whole_blood','platelet','platelets') DEFAULT 'whole_blood' NOT NULL;--> statement-breakpoint
ALTER TABLE `donations` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `donors` ADD `platelet_donation_date` timestamp;--> statement-breakpoint
ALTER TABLE `donors` ADD `is_guest` boolean DEFAULT false NOT NULL;