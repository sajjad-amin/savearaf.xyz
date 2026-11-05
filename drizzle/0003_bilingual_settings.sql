ALTER TABLE `campaign_settings` ADD `hospital_cabin_bn` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `hospital_cabin_en` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `treatment_phase_bn` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `treatment_phase_en` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `doctor_name_bn` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `doctor_name_en` varchar(255);--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `daily_update_text_bn` text;--> statement-breakpoint
ALTER TABLE `campaign_settings` ADD `daily_update_text_en` text;--> statement-breakpoint
UPDATE `campaign_settings` SET
  `hospital_cabin_bn` = IFNULL(`hospital_cabin`, 'ডিএমসিএইচ ১১৪/বি'),
  `hospital_cabin_en` = 'DMCH Cabin 114/B',
  `treatment_phase_bn` = IFNULL(`treatment_phase`, 'আজ ৩য় দিনের কেমো চলছে'),
  `treatment_phase_en` = 'Day 3 of Intensive Chemotherapy',
  `doctor_name_bn` = IFNULL(`doctor_name`, 'ডা. হুমায়রা নাজনীন'),
  `doctor_name_en` = 'Dr. Humayra Nazneen',
  `daily_update_text_bn` = IFNULL(`daily_update_text`, 'আজ আরাফের ৩য় দিনের কেমোথেরাপির জটিল চক্র চলছে। সেন্ট্রাল ভেনাস লাইন (সিভি লাইন)-এর মাধ্যমে একটানা উচ্চমাত্রার কেমো এবং ওষুধ চলায় ওর শরীর প্রচণ্ড দুর্বল। রক্তের প্লাটিলেট ও প্রয়োজনীয় সেল বারবার আশঙ্কাজনকভাবে কমে যাচ্ছে। সার্বক্ষণিক B+ হোল ব্লাড ও সিঙ্গেল ডোনার প্লাটিলেট (SDP) ব্যাকআপে রাখা অত্যন্ত জরুরি।'),
  `daily_update_text_en` = 'Araf is currently on Day 3 of his intensive chemotherapy cycle. Continuous high-dose chemo and medications through his Central Venous (CV) line have made him extremely frail. His blood platelets and essential cells are rapidly falling to critical thresholds. Maintaining an immediate standby of B+ Whole Blood and Single Donor Platelets (SDP) is life-critical.'
WHERE `id` = 1;--> statement-breakpoint
ALTER TABLE `campaign_settings` DROP COLUMN `hospital_cabin`;--> statement-breakpoint
ALTER TABLE `campaign_settings` DROP COLUMN `treatment_phase`;--> statement-breakpoint
ALTER TABLE `campaign_settings` DROP COLUMN `doctor_name`;--> statement-breakpoint
ALTER TABLE `campaign_settings` DROP COLUMN `daily_update_text`;
