import type { donors, donations } from '@/db/schema';
import type { TwoStepCooldownResult } from '@/lib/cooldown';

type DonorSelect = typeof donors.$inferSelect;
type DonationSelect = typeof donations.$inferSelect;

export type EnrichedDonor = DonorSelect & {
  cooldown: TwoStepCooldownResult;
  history: DonationSelect[];
  historyCount: number;
  addedByUserName: string | null;
};

export interface CRMStats {
  total: number;
  available: number;
  bloodCooldown: number;
  plateletCooldown: number;
  guests: number;
}
