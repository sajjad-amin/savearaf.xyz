ALTER TABLE `campaign_settings` ADD `fund_updated_at` timestamp;--> statement-breakpoint
UPDATE `campaign_settings` SET `fund_updated_at` = '2026-11-02 00:00:00' WHERE `id` = 1;

