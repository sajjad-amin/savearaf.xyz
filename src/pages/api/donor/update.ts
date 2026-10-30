export const prerender = false;

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { donors, donations, users, accounts, sessions } from '@/db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { calculateCooldown, type DonationPreference } from '@/lib/cooldown';
import {
  sanitizeName,
  sanitizePhone,
  sanitizeLocation,
  getPhoneVariants,
} from '@/lib/sanitize';

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = session.user.id;
  const referer = request.headers.get('referer') || '';
  const isEn = referer.includes('/en');

  try {
    const formData = await request.formData();
    const donorIdRaw = formData.get('donor_id')?.toString().trim();

    // Sanitize all inputs
    const name = sanitizeName(formData.get('name'));
    const phone = sanitizePhone(formData.get('phone'));
    const location = sanitizeLocation(formData.get('location'));
    const bloodGroupRaw = formData.get('blood_group')?.toString().trim();
    const donationPreferenceRaw = formData.get('donation_preference')?.toString().trim();
    const lastDonationDateRaw = formData.get('last_donation_date')?.toString().trim() || null;
    const type = formData.get('type')?.toString().trim() || 'referral';

    const donorId = Number(donorIdRaw);
    if (!donorId || isNaN(donorId) || !name || !phone || !bloodGroupRaw) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid required fields (id, name, phone, blood group).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!VALID_BLOOD_GROUPS.includes(bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number])) {
      return new Response(JSON.stringify({ error: 'Invalid blood group provided.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bloodGroup = bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number];
    const donationPreference: DonationPreference =
      donationPreferenceRaw === 'platelets' ? 'platelets' : 'whole_blood';

    // Verify ownership: logged in user must either own the donor profile (self) or have added it (referral)
    const [donorRecord] = await db
      .select({ id: donors.id, userId: donors.userId, addedByUserId: donors.addedByUserId })
      .from(donors)
      .where(
        and(
          eq(donors.id, donorId),
          type === 'self' ? eq(donors.userId, userId) : eq(donors.addedByUserId, userId)
        )
      )
      .limit(1);

    if (!donorRecord) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not have permission to modify this donor.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Deduplication check during update: check if another donor record already has this phone number
    const targetTab = type === 'self' ? 'profile' : 'referrals';
    const phoneVariants = getPhoneVariants(phone);
    const [duplicateDonor] = await db
      .select({
        id: donors.id,
        userId: donors.userId,
        addedByUserId: donors.addedByUserId,
      })
      .from(donors)
      .where(and(inArray(donors.phone, phoneVariants), ne(donors.id, donorId)))
      .limit(1);

    if (duplicateDonor) {
      // Find candidate users associated with this donor (other than the current user)
      const candidateUserIds = Array.from(
        new Set(
          [duplicateDonor.userId, duplicateDonor.addedByUserId].filter(
            (id): id is string => Boolean(id && id !== userId)
          )
        )
      );

      let hasActiveUser = false;
      const zombieUserIds: string[] = [];

      // If duplicate donor is directly associated with current user (e.g. user trying to duplicate phone on another record)
      if (duplicateDonor.userId === userId || duplicateDonor.addedByUserId === userId) {
        hasActiveUser = true;
      }

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
        // Condition A (Active User): strictly REJECT. Do not overwrite.
        const redirectUrl = isEn
          ? `/en/dashboard?error=phone_exists_active&tab=${targetTab}`
          : `/dashboard?error=phone_exists_active&tab=${targetTab}`;
        return redirect(redirectUrl, 303);
      }

      // Condition B (Zombie User): ALLOW the operation.
      // Remove the orphaned duplicate record from the zombie user
      await db.delete(donations).where(eq(donations.donorId, duplicateDonor.id));
      await db.delete(donors).where(eq(donors.id, duplicateDonor.id));

      // After successful transfer, execute a HARD DELETE on that zombie user record from the users table
      for (const zombieId of zombieUserIds) {
        await db.delete(accounts).where(eq(accounts.userId, zombieId));
        await db.delete(sessions).where(eq(sessions.userId, zombieId));
        await db.delete(users).where(eq(users.id, zombieId));
      }
    }

    // Parse date and calculate cooldown
    let lastDate: Date | null = null;
    if (lastDonationDateRaw) {
      const parsed = new Date(lastDonationDateRaw);
      if (!isNaN(parsed.getTime())) {
        lastDate = parsed;
      }
    }

    const cooldown = calculateCooldown(lastDate, donationPreference);

    // Update donor record ONLY (do not touch donations table)
    const updatePayload: Record<string, any> = {
      name,
      phone,
      bloodGroup,
      location,
      donationPreference,
      status: cooldown.status,
      updatedAt: new Date(),
    };

    if (donationPreference === 'platelets') {
      updatePayload.plateletDonationDate = lastDate;
    } else {
      updatePayload.lastDonationDate = lastDate;
    }

    await db
      .update(donors)
      .set(updatePayload)
      .where(eq(donors.id, donorId));

    const redirectUrl = isEn
      ? `/en/dashboard?success=updated&tab=${targetTab}`
      : `/dashboard?success=updated&tab=${targetTab}`;

    return redirect(redirectUrl, 303);
  } catch (error) {
    console.error('Error updating donor record:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error while updating donor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
