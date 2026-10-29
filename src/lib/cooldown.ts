export const COOLDOWN_DAYS = {
  whole_blood: 90,
  platelets: 15,
} as const;

export type DonationPreference = 'whole_blood' | 'platelets';
export type DonorStatus = 'available' | 'cooling_down';

export interface CooldownResult {
  status: DonorStatus;
  nextEligibleDate: Date | null;
  daysRemaining: number;
}

/**
 * Calculates donor cooldown and eligibility status based on medical rules:
 * - Whole Blood: 90 days
 * - Platelets (SDP): 15 days
 */
export function calculateCooldown(
  lastDonationDate: Date | string | null | undefined,
  preference: DonationPreference = 'whole_blood',
  currentDate: Date = new Date()
): CooldownResult {
  if (!lastDonationDate) {
    return {
      status: 'available',
      nextEligibleDate: null,
      daysRemaining: 0,
    };
  }

  const donationDate =
    typeof lastDonationDate === 'string'
      ? new Date(lastDonationDate)
      : new Date(lastDonationDate);

  if (isNaN(donationDate.getTime())) {
    return {
      status: 'available',
      nextEligibleDate: null,
      daysRemaining: 0,
    };
  }

  const cooldownDays = COOLDOWN_DAYS[preference] ?? 90;
  const nextEligibleTime = donationDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000;
  const nextEligibleDate = new Date(nextEligibleTime);

  const diffMs = nextEligibleDate.getTime() - currentDate.getTime();
  if (diffMs > 0) {
    const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return {
      status: 'cooling_down',
      nextEligibleDate,
      daysRemaining,
    };
  }

  return {
    status: 'available',
    nextEligibleDate,
    daysRemaining: 0,
  };
}
