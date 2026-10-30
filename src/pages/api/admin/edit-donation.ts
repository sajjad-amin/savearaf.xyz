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

  // 2. Parse request data
  const contentType = request.headers.get('content-type') || '';
  let donationId: number | null = null;
  let donationType: string = 'whole_blood';
  let donationDateStr: string = '';
  let notes: string = '';
  let hospital: string = '';
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      donationId = Number(body.donationId || body.id);
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
      donationId = Number(formData.get('donationId') || formData.get('id'));
      donationType = (formData.get('donationType') as string) || 'whole_blood';
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

  if (!donationId || isNaN(donationId)) {
    return new Response(JSON.stringify({ error: 'Valid donationId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const newDate = donationDateStr ? new Date(donationDateStr) : new Date();
  if (isNaN(newDate.getTime())) {
    return new Response(JSON.stringify({ error: 'Invalid donation date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedType = donationType.toLowerCase().includes('platelet')
    ? 'platelet'
    : 'whole_blood';

  const cooldownDays = normalizedType === 'whole_blood' ? 90 : 15;
  const nextEligibleDate = new Date(
    newDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000
  );

  try {
    // 3. Find target donation
    const [targetDonation] = await db
      .select()
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);

    if (!targetDonation) {
      return new Response(JSON.stringify({ error: 'Donation record not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const donorId = targetDonation.donorId;

    // 4. Update donation & resynchronize donor cooldown
    let freshStatus: 'available' | 'cooling_down' = 'available';

    await db.transaction(async (tx) => {
      // a) Update donation record
      await tx
        .update(donations)
        .set({
          donationDate: newDate,
          donationType: normalizedType,
          type: normalizedType === 'platelet' ? 'platelets' : 'whole_blood',
          notes: notes.trim() || null,
          hospital: hospital.trim() || null,
          nextEligibleDate,
        })
        .where(eq(donations.id, donationId));

      // b) Query all donations for this donor
      const allDonorDonations = await tx
        .select()
        .from(donations)
        .where(eq(donations.donorId, donorId))
        .orderBy(desc(donations.donationDate));

      const bloodRecords = allDonorDonations.filter(
        (d) => !(d.donationType?.toLowerCase().includes('platelet') || d.type?.toLowerCase().includes('platelet'))
      );
      const plateletRecords = allDonorDonations.filter(
        (d) => (d.donationType?.toLowerCase().includes('platelet') || d.type?.toLowerCase().includes('platelet'))
      );

      const latestBloodDate = bloodRecords.length > 0 ? bloodRecords[0].donationDate : null;
      const latestPlateletDate = plateletRecords.length > 0 ? plateletRecords[0].donationDate : null;

      const freshCooldown = calculateTwoStepCooldown(
        latestBloodDate,
        latestPlateletDate,
        allDonorDonations,
        new Date()
      );

      freshStatus = freshCooldown.status === 'available' ? 'available' : 'cooling_down';

      // c) Resync donor record
      await tx
        .update(donors)
        .set({
          lastDonationDate: latestBloodDate,
          plateletDonationDate: latestPlateletDate,
          status: freshStatus,
          updatedAt: new Date(),
        })
        .where(eq(donors.id, donorId));
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Donation updated and donor cooldown synchronized',
          status: freshStatus,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donation_updated');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error updating donation:', err);
    return new Response(
      JSON.stringify({ error: 'Database error updating donation', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

