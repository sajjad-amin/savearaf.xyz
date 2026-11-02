export const prerender = false;

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { donors, donations, users, accounts, sessions } from '@/db/schema';
import { eq, and, ne, inArray, desc } from 'drizzle-orm';
import { calculateTwoStepCooldown, type DonationPreference } from '@/lib/cooldown';
import {
  sanitizeName,
  sanitizePhone,
  sanitizeLocation,
  getPhoneVariants,
} from '@/lib/sanitize';

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const POST: APIRoute = async ({ request, redirect }) => {
  // 1. Validate session
  const session = await getSession(request);
  if (!session?.user?.id) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: You must be logged in to register donors.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userId = session.user.id;
  const referer = request.headers.get('referer') || '';
  const isEn = referer.includes('/en');

  try {
    const formData = await request.formData();

    // 2. Sanitize and strictly type all user inputs (XSS sanitization)
    const name = sanitizeName(formData.get('name'));
    const phone = sanitizePhone(formData.get('phone'));
    const location = sanitizeLocation(formData.get('location'));
    const bloodGroupRaw = formData.get('blood_group')?.toString().trim();
    const donationPreferenceRaw = formData.get('donation_preference')?.toString().trim();
    const lastDonationDateRaw = formData.get('last_donation_date')?.toString().trim() || null;
    const registrationType = formData.get('registration_type')?.toString().trim() || 'referral';

    if (!name || !phone || !bloodGroupRaw) {
      return new Response(
        JSON.stringify({ error: 'Name, phone number, and blood group are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!VALID_BLOOD_GROUPS.includes(bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number])) {
      return new Response(
        JSON.stringify({ error: 'Invalid blood group provided.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const bloodGroup = bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number];
    const donationPreference: DonationPreference =
      donationPreferenceRaw === 'platelets' ? 'platelets' : 'whole_blood';

    // 3. Parse date
    let lastDate: Date | null = null;
    if (lastDonationDateRaw) {
      const parsed = new Date(lastDonationDateRaw);
      if (!isNaN(parsed.getTime())) {
        lastDate = parsed;
      }
    }

    // 4. Deduplication Check: Query donors table using phoneVariants
    const phoneVariants = getPhoneVariants(phone);

    const [existingDonor] = await db
      .select({
        id: donors.id,
        userId: donors.userId,
        addedByUserId: donors.addedByUserId,
        lastDonationDate: donors.lastDonationDate,
        plateletDonationDate: donors.plateletDonationDate,
      })
      .from(donors)
      .where(inArray(donors.phone, phoneVariants))
      .limit(1);

    // If self-registering, also check if current user already has a self-donor record
    let selfExistingDonor: {
      id: number;
      lastDonationDate: Date | null;
      plateletDonationDate: Date | null;
    } | null = null;
    if (registrationType === 'self') {
      const [ownDonor] = await db
        .select({
          id: donors.id,
          lastDonationDate: donors.lastDonationDate,
          plateletDonationDate: donors.plateletDonationDate,
        })
        .from(donors)
        .where(eq(donors.userId, userId))
        .limit(1);
      selfExistingDonor = ownDonor || null;
    }

    let donorId: number;

    const dateUpdates = lastDate
      ? (donationPreference === 'platelets'
          ? { plateletDonationDate: lastDate }
          : { lastDonationDate: lastDate })
      : {};

    // Helper to calculate two-step cooldown incorporating full donation history
    const getComputedStatus = async (
      targetDonorId: number | null,
      legacyBlood: Date | null,
      legacyPlatelet: Date | null
    ) => {
      let history: any[] = [];
      if (targetDonorId) {
        history = await db
          .select()
          .from(donations)
          .where(eq(donations.donorId, targetDonorId))
          .orderBy(desc(donations.donationDate));
      }

      let effectiveBlood = legacyBlood;
      let effectivePlatelet = legacyPlatelet;
      if (lastDate) {
        if (donationPreference === 'platelets') {
          effectivePlatelet = lastDate;
        } else {
          effectiveBlood = lastDate;
        }
      }

      const twoStep = calculateTwoStepCooldown(
        effectiveBlood,
        effectivePlatelet,
        history,
        new Date()
      );
      return twoStep.status === 'available' ? 'available' : 'cooling_down';
    };

    if (existingDonor) {
      if (existingDonor.userId) {
        // Condition A: Donor is linked to an existing user
        if (existingDonor.userId === userId) {
          // Current user is updating their own record
          donorId = existingDonor.id;
          const status = await getComputedStatus(
            existingDonor.id,
            existingDonor.lastDonationDate,
            existingDonor.plateletDonationDate
          );
          await db
            .update(donors)
            .set({
              name,
              phone,
              bloodGroup,
              location,
              donationPreference,
              status,
              ...dateUpdates,
              isGuest: false,
              updatedAt: new Date(),
            })
            .where(eq(donors.id, existingDonor.id));

          if (registrationType === 'self') {
            await db
              .update(users)
              .set({ name, phone, updatedAt: new Date() })
              .where(eq(users.id, userId));
          }
        } else {
          // Check if candidate user is a zombie/deleted user
          const [u] = await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, existingDonor.userId))
            .limit(1);

          const isZombie =
            u &&
            (u.name === 'Anonymous Donor' || Boolean(u.email && u.email.startsWith('deleted_')));

          if (u && !isZombie) {
            // An active user already has this phone number. Strictly reject duplicate.
            const targetTab = registrationType === 'self' ? 'profile' : 'referrals';
            const redirectUrl = isEn
              ? `/en/dashboard?error=phone_exists_active&tab=${targetTab}`
              : `/dashboard?error=phone_exists_active&tab=${targetTab}`;
            return redirect(redirectUrl, 303);
          }

          // Candidate is a zombie user: take ownership of this donor record
          donorId = existingDonor.id;
          const status = await getComputedStatus(
            existingDonor.id,
            existingDonor.lastDonationDate,
            existingDonor.plateletDonationDate
          );
          if (registrationType === 'self') {
            await db
              .update(donors)
              .set({
                userId,
                addedByUserId: null,
                name,
                phone,
                bloodGroup,
                location,
                donationPreference,
                status,
                ...dateUpdates,
                isGuest: false,
                updatedAt: new Date(),
              })
              .where(eq(donors.id, existingDonor.id));

            await db
              .update(users)
              .set({ name, phone, updatedAt: new Date() })
              .where(eq(users.id, userId));

            if (selfExistingDonor && selfExistingDonor.id !== existingDonor.id) {
              await db.delete(donations).where(eq(donations.donorId, selfExistingDonor.id));
              await db.delete(donors).where(eq(donors.id, selfExistingDonor.id));
            }
          } else {
            // Referral taking over zombie record
            await db
              .update(donors)
              .set({
                userId: null,
                addedByUserId: userId,
                name,
                phone,
                bloodGroup,
                location,
                donationPreference,
                status,
                ...dateUpdates,
                isGuest: true,
                updatedAt: new Date(),
              })
              .where(eq(donors.id, existingDonor.id));
          }

          if (u?.id) {
            await db.delete(accounts).where(eq(accounts.userId, u.id));
            await db.delete(sessions).where(eq(sessions.userId, u.id));
            await db.delete(users).where(eq(users.id, u.id));
          }
        }
      } else {
        // Condition B: existingDonor.userId is null (guest/referred donor)
        if (registrationType === 'self') {
          // AUTO-MERGE / PROFILE CLAIMING:
          // Claim the guest/referred donor record, transfer all history to this user,
          // and detach it from the referrer's dashboard.
          donorId = existingDonor.id;
          const status = await getComputedStatus(
            existingDonor.id,
            existingDonor.lastDonationDate,
            existingDonor.plateletDonationDate
          );
          await db
            .update(donors)
            .set({
              userId,
              isGuest: false,
              addedByUserId: null,
              name,
              phone,
              bloodGroup,
              location,
              donationPreference,
              status,
              ...dateUpdates,
              updatedAt: new Date(),
            })
            .where(eq(donors.id, existingDonor.id));

          await db
            .update(users)
            .set({ name, phone, updatedAt: new Date() })
            .where(eq(users.id, userId));

          // If the user already had another self-donor record, remove the obsolete duplicate
          if (selfExistingDonor && selfExistingDonor.id !== existingDonor.id) {
            await db.delete(donations).where(eq(donations.donorId, selfExistingDonor.id));
            await db.delete(donors).where(eq(donors.id, selfExistingDonor.id));
          }
        } else {
          // registrationType === 'referral'
          if (existingDonor.addedByUserId === userId) {
            // User updating their own referral
            donorId = existingDonor.id;
            const status = await getComputedStatus(
              existingDonor.id,
              existingDonor.lastDonationDate,
              existingDonor.plateletDonationDate
            );
            await db
              .update(donors)
              .set({
                name,
                phone,
                bloodGroup,
                location,
                donationPreference,
                status,
                ...dateUpdates,
                isGuest: true,
                updatedAt: new Date(),
              })
              .where(eq(donors.id, existingDonor.id));
          } else {
            // Already added as a guest/referral by another user or admin
            const redirectUrl = isEn
              ? `/en/dashboard?error=phone_exists_active&tab=referrals`
              : `/dashboard?error=phone_exists_active&tab=referrals`;
            return redirect(redirectUrl, 303);
          }
        }
      }
    } else if (selfExistingDonor && registrationType === 'self') {
      // User is updating their existing self-donor profile with an available phone number
      donorId = selfExistingDonor.id;
      const status = await getComputedStatus(
        selfExistingDonor.id,
        selfExistingDonor.lastDonationDate,
        selfExistingDonor.plateletDonationDate
      );
      await db
        .update(donors)
        .set({
          name,
          phone,
          bloodGroup,
          location,
          donationPreference,
          status,
          ...dateUpdates,
          isGuest: false,
          updatedAt: new Date(),
        })
        .where(eq(donors.id, selfExistingDonor.id));

      await db
        .update(users)
        .set({ name, phone, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      // INSERT: Create new donor record
      const isSelf = registrationType === 'self';
      const status = await getComputedStatus(null, null, null);
      const [insertResult] = await db.insert(donors).values({
        userId: isSelf ? userId : null,
        addedByUserId: isSelf ? null : userId,
        name,
        phone,
        bloodGroup,
        location,
        donationPreference,
        status,
        lastDonationDate: donationPreference === 'platelets' ? null : lastDate,
        plateletDonationDate: donationPreference === 'platelets' ? lastDate : null,
        isGuest: !isSelf,
      });

      donorId = Number(insertResult.insertId);

      if (isSelf) {
        await db
          .update(users)
          .set({ name, phone, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    }

    // 5. Redirect back to dashboard preserving language and active tab
    const targetTab = registrationType === 'self' ? 'profile' : 'referrals';
    const redirectUrl = isEn
      ? `/en/dashboard?success=registered&tab=${targetTab}`
      : `/dashboard?success=registered&tab=${targetTab}`;

    return redirect(redirectUrl, 303);
  } catch (error) {
    console.error('Error registering donor:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error while saving donor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
