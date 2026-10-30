export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { calculateCooldown, type DonationPreference } from '@/lib/cooldown';
import { eq } from 'drizzle-orm';

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
  let name = '';
  let phone = '';
  let bloodGroup: any = 'B+';
  let location = '';
  let donationPreference: DonationPreference = 'whole_blood';
  let lastDonationDateStr = '';
  let notes = '';
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      name = body.name || '';
      phone = body.phone || '';
      bloodGroup = body.bloodGroup || 'B+';
      location = body.location || '';
      donationPreference = body.donationPreference || 'whole_blood';
      lastDonationDateStr = body.lastDonationDate || '';
      notes = body.notes || '';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    try {
      const formData = await request.formData();
      name = (formData.get('name') as string) || '';
      phone = (formData.get('phone') as string) || '';
      bloodGroup = (formData.get('bloodGroup') as any) || 'B+';
      location = (formData.get('location') as string) || '';
      donationPreference =
        (formData.get('donationPreference') as DonationPreference) || 'whole_blood';
      lastDonationDateStr = (formData.get('lastDonationDate') as string) || '';
      notes = (formData.get('notes') as string) || '';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 3. Validation
  name = name.trim();
  phone = phone.trim().replace(/[\s-]/g, '');

  if (!name || name.length < 2) {
    return new Response(JSON.stringify({ error: 'Name must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!phone || phone.length < 11) {
    return new Response(
      JSON.stringify({ error: 'Valid 11-digit phone number is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const validGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  if (!validGroups.includes(bloodGroup)) {
    return new Response(JSON.stringify({ error: 'Invalid blood group' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse donation date & cooldown
  let lastDate: Date | null = null;
  if (lastDonationDateStr) {
    const parsed = new Date(lastDonationDateStr);
    if (!isNaN(parsed.getTime())) {
      lastDate = parsed;
    }
  }

  const cooldown = calculateCooldown(lastDate, donationPreference);

  try {
    // 4. Check for existing phone duplicate
    const [existingDonor] = await db
      .select({ id: donors.id, name: donors.name })
      .from(donors)
      .where(eq(donors.phone, phone))
      .limit(1);

    if (existingDonor) {
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

    // 5. Insert Guest Donor
    let createdDonorId: number | null = null;
    await db.transaction(async (tx) => {
      const insertResult: any = await tx.insert(donors).values({
        name,
        phone,
        bloodGroup,
        location: location.trim() || null,
        donationPreference,
        status: cooldown.status,
        lastDonationDate: donationPreference === 'whole_blood' ? lastDate : null,
        plateletDonationDate: donationPreference === 'platelets' ? lastDate : null,
        isGuest: true,
        addedByUserId: session.user.id || null,
      });

      createdDonorId = Number(insertResult.insertId || insertResult[0]?.insertId || 0);

      // If initial donation date provided, record initial entry in donations table
      if (lastDate && createdDonorId) {
        await tx.insert(donations).values({
          donorId: createdDonorId,
          donationDate: lastDate,
          donationType: donationPreference === 'platelets' ? 'platelet' : 'whole_blood',
          type: donationPreference,
          notes: notes.trim() ? `[Initial Guest Record] ${notes.trim()}` : '[Initial Guest Record]',
          nextEligibleDate: cooldown.nextEligibleDate,
        });
      }
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Guest donor created successfully',
          donorId: createdDonorId,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donor_created');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error creating guest donor:', err);
    return new Response(
      JSON.stringify({ error: 'Database error adding guest donor', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

