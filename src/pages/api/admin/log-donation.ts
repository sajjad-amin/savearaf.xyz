export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { calculateTwoStepCooldown } from '@/lib/cooldown';
import { eq, desc } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, redirect }) => {
  // 1. Verify admin session
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Parse request data (supports JSON or Form Data)
  const contentType = request.headers.get('content-type') || '';
  let donorId: number | null = null;
  let donationType: 'whole_blood' | 'platelet' | 'platelets' = 'whole_blood';
  let donationDateStr: string = '';
  let notes: string = '';
  let hospital: string = '';
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      donorId = Number(body.donorId);
      donationType = body.donationType || 'whole_blood';
      donationDateStr = body.donationDate || '';
      notes = body.notes || '';
      hospital = body.hospital || '';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    try {
      const formData = await request.formData();
      donorId = Number(formData.get('donorId'));
      donationType = (formData.get('donationType') as any) || 'whole_blood';
      donationDateStr = (formData.get('donationDate') as string) || '';
      notes = (formData.get('notes') as string) || '';
      hospital = (formData.get('hospital') as string) || '';
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

  const dDate = donationDateStr ? new Date(donationDateStr) : new Date();
  if (isNaN(dDate.getTime())) {
    return new Response(JSON.stringify({ error: 'Invalid donation date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedType = donationType.toLowerCase().includes('platelet')
    ? 'platelet'
    : 'whole_blood';

  // Calculate next eligible date
  const cooldownDays = normalizedType === 'whole_blood' ? 90 : 15;
  const nextEligibleDate = new Date(
    dDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000
  );

  try {
    // 4. Verify donor exists
    const [targetDonor] = await db
      .select({
        id: donors.id,
        name: donors.name,
        lastDonationDate: donors.lastDonationDate,
        plateletDonationDate: donors.plateletDonationDate,
      })
      .from(donors)
      .where(eq(donors.id, donorId))
      .limit(1);

    if (!targetDonor) {
      return new Response(JSON.stringify({ error: 'Donor not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Atomic Drizzle Transaction
    let insertedDonationId: number | null = null;
    await db.transaction(async (tx) => {
      // a) Insert into donations table
      const insertResult: any = await tx.insert(donations).values({
        donorId,
        donationDate: dDate,
        donationType: normalizedType,
        type: normalizedType === 'platelet' ? 'platelets' : 'whole_blood',
        notes: notes.trim() || null,
        hospital: hospital.trim() || null,
        nextEligibleDate,
      });

      insertedDonationId = Number(insertResult.insertId || insertResult[0]?.insertId || 0);

      // b) Update date in donors table (always overwrite) and recompute cooldown status
      const updatePayload: Record<string, any> = {
        updatedAt: new Date(),
      };

      const updatedBloodDate = normalizedType === 'whole_blood' ? dDate : targetDonor.lastDonationDate;
      const updatedPlateletDate = normalizedType === 'platelet' ? dDate : targetDonor.plateletDonationDate;

      if (normalizedType === 'whole_blood') {
        updatePayload.lastDonationDate = dDate;
      } else {
        updatePayload.plateletDonationDate = dDate;
      }

      // Re-fetch all donations to compute fresh two-step cooldown status
      const donorDonations = await tx
        .select()
        .from(donations)
        .where(eq(donations.donorId, donorId))
        .orderBy(desc(donations.donationDate));

      const freshCooldown = calculateTwoStepCooldown(
        updatedBloodDate,
        updatedPlateletDate,
        donorDonations,
        new Date()
      );

      updatePayload.status = freshCooldown.status === 'available' ? 'available' : 'cooling_down';

      await tx
        .update(donors)
        .set(updatePayload)
        .where(eq(donors.id, donorId));
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Donation logged successfully',
          donationId: insertedDonationId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Form submit redirect
    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donation_logged');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error in log-donation API:', err);
    return new Response(
      JSON.stringify({ error: 'Database error logging donation', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

