export const prerender = false;

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { calculateCooldown, type DonationPreference } from '@/lib/cooldown';

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

  try {
    const formData = await request.formData();
    const name = formData.get('name')?.toString().trim();
    const phone = formData.get('phone')?.toString().trim();
    const bloodGroupRaw = formData.get('blood_group')?.toString().trim();
    const location = formData.get('location')?.toString().trim() || null;
    const donationPreferenceRaw = formData.get('donation_preference')?.toString().trim();
    const lastDonationDateRaw = formData.get('last_donation_date')?.toString().trim() || null;
    const registrationType = formData.get('registration_type')?.toString().trim() || 'referral';

    // 2. Validate required inputs
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

    // 4. Handle self-registration vs offline referral
    if (registrationType === 'self') {
      // Check if user already has a self-registered donor profile
      const [existingDonor] = await db
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId))
        .limit(1);

      let donorId: number;

      if (existingDonor) {
        // Update existing donor profile
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
          .where(eq(donors.id, existingDonor.id));

        donorId = existingDonor.id;
      } else {
        // Insert new self-registered donor profile
        const [insertResult] = await db.insert(donors).values({
          userId,
          addedByUserId: null,
          name,
          phone,
          bloodGroup,
          location,
          donationPreference,
          status: cooldown.status,
          lastDonationDate: lastDate,
        });
        donorId = Number(insertResult.insertId);
      }

      // If last donation date provided and cooling down, record in donations history table
      if (lastDate && cooldown.nextEligibleDate && donorId) {
        try {
          await db.insert(donations).values({
            donorId,
            donationDate: lastDate,
            type: donationPreference,
            nextEligibleDate: cooldown.nextEligibleDate,
          });
        } catch (donErr) {
          console.warn('Could not record initial donation log:', donErr);
        }
      }
    } else {
      // Offline referral added by current user
      const [insertResult] = await db.insert(donors).values({
        userId: null,
        addedByUserId: userId,
        name,
        phone,
        bloodGroup,
        location,
        donationPreference,
        status: cooldown.status,
        lastDonationDate: lastDate,
      });

      const donorId = Number(insertResult.insertId);

      // Record in donations table if last donation date was given
      if (lastDate && cooldown.nextEligibleDate && donorId) {
        try {
          await db.insert(donations).values({
            donorId,
            donationDate: lastDate,
            type: donationPreference,
            nextEligibleDate: cooldown.nextEligibleDate,
          });
        } catch (donErr) {
          console.warn('Could not record initial donation log for referral:', donErr);
        }
      }
    }

    // 5. Redirect back to dashboard preserving language and active tab
    const referer = request.headers.get('referer') || '';
    const isEn = referer.includes('/en');
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
