import type { donors, donations } from '@/db/schema';
import type { calculateTwoStepCooldown } from '@/lib/cooldown';

export type DonorRecord = typeof donors.$inferSelect;
export type DonationRecord = typeof donations.$inferSelect;

export type SelfDonor = DonorRecord | null;

export interface SelfCooldown {
  status: 'available' | 'cooling_down';
  nextEligibleDate: Date | null;
  daysRemaining: number;
  raw: ReturnType<typeof calculateTwoStepCooldown>;
}

export type ReferredDonor = DonorRecord & {
  computedStatus: 'available' | 'cooling_down';
  nextEligibleDate: Date | null;
  daysRemaining: number;
  history: DonationRecord[];
  historyCount: number;
  cooldown: ReturnType<typeof calculateTwoStepCooldown>;
};

export type DonationItem = DonationRecord;
