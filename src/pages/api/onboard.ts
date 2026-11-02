export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users, donors, accounts, sessions, donations } from '@/db/schema';
import { eq, and, ne, inArray, isNull, desc } from 'drizzle-orm';
import { sanitizePhone, getPhoneVariants } from '@/lib/sanitize';
import { calculateTwoStepCooldown } from '@/lib/cooldown';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request);
  if (!session || !session.user || !session.user.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Please log in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let rawPhone = '';
  let rawBloodGroup = '';
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      rawPhone = body.phone || '';
      rawBloodGroup = body.bloodGroup || body.blood_group || '';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    const formData = await request.formData();
    rawPhone = formData.get('phone')?.toString() || '';
    rawBloodGroup =
      formData.get('bloodGroup')?.toString() ||
      formData.get('blood_group')?.toString() ||
      '';
  }

  // Sanitize input (strip HTML, script tags, whitespace, dashes, and parens)
  const cleanedPhone = sanitizePhone(rawPhone);

  const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
  type BloodGroup = (typeof VALID_BLOOD_GROUPS)[number];
  const cleanedBloodGroup = rawBloodGroup.trim() as BloodGroup;

  const referer = request.headers.get('referer') || '';
  const isEn = referer.includes('/en');

  // Validation: Accept any valid phone number (minimum 8 digits, e.g. BD 11-digit or international)
  if (!cleanedPhone || cleanedPhone.length < 8 || !/^\+?[0-9]{8,18}$/.test(cleanedPhone)) {
    return new Response(
      JSON.stringify({
        error: 'অনুগ্রহ করে একটি সঠিক ও সক্রিয় ফোন নম্বর লিখুন (Please enter a valid phone number)',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validation: Mandatory valid blood group
  if (!VALID_BLOOD_GROUPS.includes(cleanedBloodGroup)) {
    if (contentType.includes('application/json')) {
      return new Response(
        JSON.stringify({
          error: 'অনুগ্রহ করে একটি সঠিক রক্তের গ্রুপ নির্বাচন করুন (Please select a valid blood group)',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    return redirect(
      isEn ? '/en/onboarding?error=invalid_blood_group' : '/onboarding?error=invalid_blood_group',
      303
    );
  }

  const userId = session.user.id;

  try {
    // 1. Check BOTH users and donors tables using phoneVariants
    const phoneVariants = getPhoneVariants(cleanedPhone);

    const duplicateUsers = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(inArray(users.phone, phoneVariants), ne(users.id, userId)));

    // Only check donors where userId is NOT null (registered users).
    // Strictly ignore records where userId is null (guest/referred donors), and do NOT block based on addedByUserId.
    const duplicateDonors = await db
      .select({ id: donors.id, userId: donors.userId })
      .from(donors)
      .where(inArray(donors.phone, phoneVariants));

    const donorAssociatedUserIds = duplicateDonors
      .map((d) => d.userId)
      .filter((id): id is string => Boolean(id && id !== userId));

    const candidateUserIds = Array.from(
      new Set([...duplicateUsers.map((u) => u.id), ...donorAssociatedUserIds])
    );

    let hasActiveUser = false;
    const zombieUserIds: string[] = [];

    for (const candidateId of candidateUserIds) {
      let u = duplicateUsers.find((du) => du.id === candidateId);
      if (!u) {
        const [fetched] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, candidateId))
          .limit(1);
        u = fetched;
      }

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

    // Condition A: If the phone belongs to an active user, reject onboarding request
    if (hasActiveUser) {
      if (contentType.includes('application/json')) {
        return new Response(JSON.stringify({ error: 'phone_exists_active' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return redirect(isEn ? '/en/onboarding?error=phone_exists_active' : '/onboarding?error=phone_exists_active', 303);
    }

    // Condition B: If it belongs to a zombie user, perform zombie cleanup (Hard Delete)
    for (const zombieId of zombieUserIds) {
      // Transfer any zombie-owned donor matching this phone to the new onboarded user
      await db
        .update(donors)
        .set({ userId, addedByUserId: null })
        .where(and(eq(donors.userId, zombieId), inArray(donors.phone, phoneVariants)));

      await db.delete(accounts).where(eq(accounts.userId, zombieId));
      await db.delete(sessions).where(eq(sessions.userId, zombieId));
      await db.delete(users).where(eq(users.id, zombieId));
    }

    // Update the user record in database
    await db
      .update(users)
      .set({
        phone: cleanedPhone,
        isOnboarded: true,
      })
      .where(eq(users.id, userId));

    // Check if user already has a self-donor profile (e.g. from earlier or zombie transfer)
    const [existingSelfDonor] = await db
      .select({ id: donors.id })
      .from(donors)
      .where(eq(donors.userId, userId))
      .limit(1);

    if (existingSelfDonor) {
      await db
        .update(donors)
        .set({
          phone: cleanedPhone,
          bloodGroup: cleanedBloodGroup,
          isGuest: false,
          updatedAt: new Date(),
        })
        .where(eq(donors.id, existingSelfDonor.id));
    } else {
      // Check if a guest donor profile exists for this phone (userId IS NULL)
      const [guestDonor] = await db
        .select({
          id: donors.id,
          name: donors.name,
          lastDonationDate: donors.lastDonationDate,
          plateletDonationDate: donors.plateletDonationDate,
        })
        .from(donors)
        .where(and(inArray(donors.phone, phoneVariants), isNull(donors.userId)))
        .limit(1);

      if (guestDonor) {
        // Auto-merge / Profile Claiming: claim the guest record and preserve its donation history
        const guestDonations = await db
          .select()
          .from(donations)
          .where(eq(donations.donorId, guestDonor.id))
          .orderBy(desc(donations.donationDate));

        const cooldownResult = calculateTwoStepCooldown(
          guestDonor.lastDonationDate,
          guestDonor.plateletDonationDate,
          guestDonations,
          new Date()
        );

        await db
          .update(donors)
          .set({
            userId,
            isGuest: false,
            addedByUserId: null,
            name: session.user.name || guestDonor.name,
            phone: cleanedPhone,
            bloodGroup: cleanedBloodGroup,
            status: cooldownResult.status === 'available' ? 'available' : 'cooling_down',
            updatedAt: new Date(),
          })
          .where(eq(donors.id, guestDonor.id));
      } else {
        // Automatically insert a new record into donors table with user's selected blood group
        await db.insert(donors).values({
          userId,
          name: session.user.name || 'Donor',
          phone: cleanedPhone,
          bloodGroup: cleanedBloodGroup,
          location: null,
          donationPreference: 'whole_blood',
          status: 'available',
          lastDonationDate: null,
          plateletDonationDate: null,
          isGuest: false,
          addedByUserId: null,
        });
      }
    }

    // Redirect to dashboard upon onboarding success with locale preservation
    return redirect(isEn ? '/en/dashboard' : '/dashboard', 303);
  } catch (error) {
    console.error('Error updating onboarding status in database:', error);
    return new Response(
      JSON.stringify({
        error: 'ডাটাবেজে তথ্য সংরক্ষণে ত্রুটি হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
