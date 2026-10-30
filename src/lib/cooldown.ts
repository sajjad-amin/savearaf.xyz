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

export interface TwoStepCooldownResult {
  status: 'available' | 'blood_cooldown' | 'platelet_cooldown';
  statusLabel: {
    bn: string;
    en: string;
  };
  isBloodEligible: boolean;
  isPlateletEligible: boolean;
  bloodDaysRemaining: number;
  plateletDaysRemaining: number;
  effectiveBloodDate: Date | null;
  effectivePlateletDate: Date | null;
  nextBloodEligibleDate: Date | null;
  nextPlateletEligibleDate: Date | null;
}

export interface RawDonationRecord {
  donationDate: Date | string;
  donationType?: string | null;
  type?: string | null;
  notes?: string | null;
  hospital?: string | null;
}

/**
 * Two-Step Cooldown calculation:
 * Compares legacy dates in `donors` table (`lastDonationDate`, `plateletDonationDate`)
 * with entries in `donations` table, taking the most recent valid date for each type.
 */
export function calculateTwoStepCooldown(
  legacyBloodDate: Date | string | null | undefined,
  legacyPlateletDate: Date | string | null | undefined,
  donationRecords: RawDonationRecord[] = [],
  currentDate: Date = new Date()
): TwoStepCooldownResult {
  // 1. Calculate most recent Whole Blood date
  let latestBloodTime = 0;
  if (legacyBloodDate) {
    const d = new Date(legacyBloodDate);
    if (!isNaN(d.getTime())) latestBloodTime = d.getTime();
  }

  // 2. Calculate most recent Platelet date
  let latestPlateletTime = 0;
  if (legacyPlateletDate) {
    const d = new Date(legacyPlateletDate);
    if (!isNaN(d.getTime())) latestPlateletTime = d.getTime();
  }

  // Check donation history records
  for (const record of donationRecords) {
    const d = new Date(record.donationDate);
    if (isNaN(d.getTime())) continue;

    const recordType = (record.donationType || record.type || '').toLowerCase();
    if (recordType === 'whole_blood' || recordType === 'blood') {
      if (d.getTime() > latestBloodTime) {
        latestBloodTime = d.getTime();
      }
    } else if (recordType === 'platelet' || recordType === 'platelets') {
      if (d.getTime() > latestPlateletTime) {
        latestPlateletTime = d.getTime();
      }
    }
  }

  const effectiveBloodDate = latestBloodTime > 0 ? new Date(latestBloodTime) : null;
  const effectivePlateletDate = latestPlateletTime > 0 ? new Date(latestPlateletTime) : null;

  // 3. Whole Blood Cooldown: 90 days
  let isBloodEligible = true;
  let bloodDaysRemaining = 0;
  let nextBloodEligibleDate: Date | null = null;

  if (effectiveBloodDate) {
    const eligibleTime = effectiveBloodDate.getTime() + 90 * 24 * 60 * 60 * 1000;
    nextBloodEligibleDate = new Date(eligibleTime);
    const diff = eligibleTime - currentDate.getTime();
    if (diff > 0) {
      isBloodEligible = false;
      bloodDaysRemaining = Math.ceil(diff / (24 * 60 * 60 * 1000));
    }
  }

  // 4. Platelet Cooldown: 15 days
  let isPlateletEligible = true;
  let plateletDaysRemaining = 0;
  let nextPlateletEligibleDate: Date | null = null;

  if (effectivePlateletDate) {
    const eligibleTime = effectivePlateletDate.getTime() + 15 * 24 * 60 * 60 * 1000;
    nextPlateletEligibleDate = new Date(eligibleTime);
    const diff = eligibleTime - currentDate.getTime();
    if (diff > 0) {
      isPlateletEligible = false;
      plateletDaysRemaining = Math.ceil(diff / (24 * 60 * 60 * 1000));
    }
  }

  // 5. Determine combined status
  let status: 'available' | 'blood_cooldown' | 'platelet_cooldown' = 'available';
  let bnLabel = 'প্রস্তুত (Available)';
  let enLabel = 'Available';

  if (!isBloodEligible && !isPlateletEligible) {
    status = 'blood_cooldown';
    bnLabel = `রক্ত (${bloodDaysRemaining} দিন) ও প্লাটিলেট (${plateletDaysRemaining} দিন) বাকি`;
    enLabel = `Blood (${bloodDaysRemaining}d) & Platelet (${plateletDaysRemaining}d) CD`;
  } else if (!isBloodEligible) {
    status = 'blood_cooldown';
    bnLabel = `রক্ত কুলডাউন (${bloodDaysRemaining} দিন বাকি)`;
    enLabel = `Blood Cooldown (${bloodDaysRemaining}d left)`;
  } else if (!isPlateletEligible) {
    status = 'platelet_cooldown';
    bnLabel = `প্লাটিলেট কুলডাউন (${plateletDaysRemaining} দিন বাকি)`;
    enLabel = `Platelet Cooldown (${plateletDaysRemaining}d left)`;
  }

  return {
    status,
    statusLabel: {
      bn: bnLabel,
      en: enLabel,
    },
    isBloodEligible,
    isPlateletEligible,
    bloodDaysRemaining,
    plateletDaysRemaining,
    effectiveBloodDate,
    effectivePlateletDate,
    nextBloodEligibleDate,
    nextPlateletEligibleDate,
  };
}
