export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, users } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { eq, and, ne, inArray } from 'drizzle-orm';
import {
  sanitizeName,
  sanitizePhone,
  sanitizeLocation,
  getPhoneVariants,
} from '@/lib/sanitize';
import type { DonationPreference } from '@/lib/cooldown';

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const POST: APIRoute = async ({ request, redirect }) => {
  // 1. Verify admin session
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Parse request data
  const contentType = request.headers.get('content-type') || '';
  let donorId: number | null = null;
  let name = '';
  let phone = '';
  let bloodGroupRaw = '';
  let locationRaw: string | null = null;
  let donationPreferenceRaw = 'whole_blood';
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      donorId = Number(body.donorId || body.id);
      name = body.name || '';
      phone = body.phone || '';
      bloodGroupRaw = body.bloodGroup || '';
      locationRaw = body.location || null;
      donationPreferenceRaw = body.donationPreference || 'whole_blood';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    try {
      const formData = await request.formData();
      donorId = Number(formData.get('donorId') || formData.get('id'));
      name = (formData.get('name') as string) || '';
      phone = (formData.get('phone') as string) || '';
      bloodGroupRaw = (formData.get('bloodGroup') as string) || '';
      locationRaw = (formData.get('location') as string) || null;
      donationPreferenceRaw = (formData.get('donationPreference') as string) || 'whole_blood';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 3. Validation
  if (!donorId || isNaN(donorId)) {
    return new Response(JSON.stringify({ error: 'Valid donorId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cleanName = sanitizeName(name);
  const cleanPhone = sanitizePhone(phone);
  const cleanLocation = sanitizeLocation(locationRaw);

  if (!cleanName || cleanName.length < 2) {
    return new Response(JSON.stringify({ error: 'Name must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!cleanPhone || cleanPhone.length < 11) {
    return new Response(
      JSON.stringify({ error: 'Valid phone number is required (min 11 digits)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!VALID_BLOOD_GROUPS.includes(bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number])) {
    return new Response(JSON.stringify({ error: 'Invalid blood group provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bloodGroup = bloodGroupRaw as (typeof VALID_BLOOD_GROUPS)[number];
  const donationPreference: DonationPreference =
    donationPreferenceRaw === 'platelets' ? 'platelets' : 'whole_blood';

  try {
    // 4. Check if target donor exists
    const [targetDonor] = await db
      .select({ id: donors.id, userId: donors.userId, isGuest: donors.isGuest })
      .from(donors)
      .where(eq(donors.id, donorId))
      .limit(1);

    if (!targetDonor) {
      return new Response(JSON.stringify({ error: 'Donor record not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Duplicate check: ensure no OTHER donor has this phone number
    const phoneVariants = getPhoneVariants(cleanPhone);
    const [duplicateDonor] = await db
      .select({ id: donors.id, name: donors.name })
      .from(donors)
      .where(and(inArray(donors.phone, phoneVariants), ne(donors.id, donorId)))
      .limit(1);

    if (duplicateDonor) {
      if (returnJson) {
        return new Response(
          JSON.stringify({ error: 'A donor with this phone number already exists' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const referer = request.headers.get('referer') || '/admin/crm';
      const redirectUrl = new URL(referer, request.url);
      redirectUrl.searchParams.set('error', 'phone_exists');
      return redirect(redirectUrl.pathname + redirectUrl.search);
    }

    // 6. Update donor record and sync name with users table if tied to registered user
    await db.transaction(async (tx) => {
      await tx
        .update(donors)
        .set({
          name: cleanName,
          phone: cleanPhone,
          bloodGroup,
          location: cleanLocation,
          donationPreference,
          updatedAt: new Date(),
        })
        .where(eq(donors.id, donorId));

      if (targetDonor.userId) {
        await tx
          .update(users)
          .set({
            name: cleanName,
            phone: cleanPhone,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetDonor.userId));
      }
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Donor updated successfully',
          donor: {
            id: donorId,
            name: cleanName,
            phone: cleanPhone,
            bloodGroup,
            location: cleanLocation,
            donationPreference,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donor_updated');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error updating donor:', err);
    return new Response(
      JSON.stringify({ error: 'Database error updating donor', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
