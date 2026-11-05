ALTER TABLE `campaign_settings` ADD `emergency_text_bn` varchar(500);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `emergency_text_en` varchar(500);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `enable_scrolling` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `scroll_speed` int NOT NULL DEFAULT 20;--> statement-breakpoint
UPDATE `campaign_settings` SET
  `emergency_text_bn` = 'হাসপাতাল কেবিন: ডিএমসিএইচ ১১৪/বি • আজ ৩য় দিনের কেমো চলছে • রক্তের গ্রুপ: B+ (বি পজিটিভ) • জরুরি B+ রক্ত ও প্লাটিলেট (SDP) প্রয়োজন',
  `emergency_text_en` = 'DMCH Cabin 114/B • Day 3 of Intensive Chemotherapy • Blood Group: B+ (Positive) • Urgent need for B+ Blood & SDP Platelets',
  `enable_scrolling` = false,
  `scroll_speed` = 20
WHERE `id` = 1;

