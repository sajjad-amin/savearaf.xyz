CREATE TABLE `campaign_settings` (
	`id` int NOT NULL,
	`hospital_cabin` varchar(255),
	`treatment_phase` varchar(255),
	`doctor_name` varchar(255),
	`daily_update_text` text,
	`platelets` varchar(100),
	`wbc` varchar(100),
	`hb` varchar(100),
	`blast` varchar(100),
	`creatinine` varchar(100),
	`uric_acid` varchar(100),
	`alt` varchar(100),
	`anc` varchar(100),
	`fund_target` int,
	`fund_raised` int,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_settings_id` PRIMARY KEY(`id`)
);
