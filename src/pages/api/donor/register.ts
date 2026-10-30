export const prerender = false;

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { donors, donations, users, accounts, sessions } from '@/db/schema';
import { eq, and, ne, or, inArray } from 'drizzle-orm';
import { calculateCooldown, type DonationPreference } from '@/lib/cooldown';
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

    // 3. Parse date and calculate cooldown
    let lastDate: Date | null = null;
    if (lastDonationDateRaw) {
      const parsed = new Date(lastDonationDateRaw);
      if (!isNaN(parsed.getTime())) {
        lastDate = parsed;
      }
    }

    const cooldown = calculateCooldown(lastDate, donationPreference);

    // 4. Deduplication Check: Query donors table using phoneVariants
    const phoneVariants = getPhoneVariants(phone);

    const [existingDonor] = await db
      .select({
        id: donors.id,
        userId: donors.userId,
        addedByUserId: donors.addedByUserId,
      })
      .from(donors)
      .where(inArray(donors.phone, phoneVariants))
      .limit(1);

    // If self-registering, also check if current user already has a self-donor record
    let selfExistingDonor: { id: number } | null = null;
    if (registrationType === 'self') {
      const [ownDonor] = await db
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId))
        .limit(1);
      selfExistingDonor = ownDonor || null;
    }

    let donorId: number;

    if (existingDonor) {
      // Find candidate users associated with this donor (other than the current user)
      const candidateUserIds = Array.from(
        new Set(
          [existingDonor.userId, existingDonor.addedByUserId].filter(
            (id): id is string => Boolean(id && id !== userId)
          )
        )
      );

      let hasActiveUser = false;
      const zombieUserIds: string[] = [];

      for (const candidateId of candidateUserIds) {
        const [u] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, candidateId))
          .limit(1);

        if (u) {
          const isZombie =
            u.name === 'Anonymous Donor' || Boolean(u.email && u.email.startsWith('deleted_'));
          if (!isZombie) {
            hasActiveUser = true;
            break;
          } else {
            zombieUserIds.push(candidateId);
          }
        }
      }

      if (hasActiveUser) {
        // Condition A (Active User): strictly REJECT the operation. Do not overwrite.
        const targetTab = registrationType === 'self' ? 'profile' : 'referrals';
        const redirectUrl = isEn
          ? `/en/dashboard?error=phone_exists_active&tab=${targetTab}`
          : `/dashboard?error=phone_exists_active&tab=${targetTab}`;
        return redirect(redirectUrl, 303);
      }

      // Condition B (Zombie User or claiming record): ALLOW the operation.
      // Update existing donor record to belong to the current user (taking ownership)
      donorId = existingDonor.id;

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
            status: cooldown.status,
            lastDonationDate: lastDate,
          })
          .where(eq(donors.id, existingDonor.id));

        // If user already had another self-donor record, delete the old duplicate self record
        if (selfExistingDonor && selfExistingDonor.id !== existingDonor.id) {
          await db.delete(donations).where(eq(donations.donorId, selfExistingDonor.id));
          await db.delete(donors).where(eq(donors.id, selfExistingDonor.id));
        }
      } else {
        // Referral: update information and set addedByUserId to current user
        await db
          .update(donors)
          .set({
            userId: null, // transferred away from zombie user to offline referral
            addedByUserId: userId,
            name,
            phone,
            bloodGroup,
            location,
            donationPreference,
            status: cooldown.status,
            lastDonationDate: lastDate,
          })
          .where(eq(donors.id, existingDonor.id));
      }

      // After successful transfer, execute a HARD DELETE on that zombie user record from the users table
      for (const zombieId of zombieUserIds) {
        await db.delete(accounts).where(eq(accounts.userId, zombieId));
        await db.delete(sessions).where(eq(sessions.userId, zombieId));
        await db.delete(users).where(eq(users.id, zombieId));
      }
    } else if (selfExistingDonor) {
      // User is updating their existing self-donor profile with an available phone number
      donorId = selfExistingDonor.id;
      await db
        .update(donors)
        .set({
          name,
          phone,
          bloodGroup,
          location,
          donationPreference,
          status: cooldown.status,
          lastDonationDate: lastDate,
        })
        .where(eq(donors.id, selfExistingDonor.id));
    } else {
      // INSERT: Create new donor record
      const [insertResult] = await db.insert(donors).values({
        userId: registrationType === 'self' ? userId : null,
        addedByUserId: registrationType === 'self' ? null : userId,
        name,
        phone,
        bloodGroup,
        location,
        donationPreference,
        status: cooldown.status,
        lastDonationDate: donationPreference === 'whole_blood' ? lastDate : null,
        plateletDonationDate: donationPreference === 'platelets' ? lastDate : null,
      });

      donorId = Number(insertResult.insertId);
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
