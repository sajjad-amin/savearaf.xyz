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
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      donationId = Number(body.donationId || body.id);
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
    const isPlatelet =
      (targetDonation.donationType || targetDonation.type || '')
        .toLowerCase()
        .includes('platelet');

    // 4. Perform atomic deletion & rollback
    let rolledBackBloodDate: Date | null = null;
    let rolledBackPlateletDate: Date | null = null;
    let freshStatus: 'available' | 'cooling_down' = 'available';

    await db.transaction(async (tx) => {
      // a) Delete target donation
      await tx.delete(donations).where(eq(donations.id, donationId));

      // b) Query all remaining donations for this donor
      const remainingDonations = await tx
        .select()
        .from(donations)
        .where(eq(donations.donorId, donorId))
        .orderBy(desc(donations.donationDate));

      // c) Separate records by type to find the next most recent dates
      const remainingBlood = remainingDonations.filter(
        (d) => !(d.donationType?.toLowerCase().includes('platelet') || d.type?.toLowerCase().includes('platelet'))
      );
      const remainingPlatelets = remainingDonations.filter(
        (d) => (d.donationType?.toLowerCase().includes('platelet') || d.type?.toLowerCase().includes('platelet'))
      );

      rolledBackBloodDate = remainingBlood.length > 0 ? remainingBlood[0].donationDate : null;
      rolledBackPlateletDate = remainingPlatelets.length > 0 ? remainingPlatelets[0].donationDate : null;

      // d) Compute fresh cooldown status
      const freshCooldown = calculateTwoStepCooldown(
        rolledBackBloodDate,
        rolledBackPlateletDate,
        remainingDonations,
        new Date()
      );

      freshStatus = freshCooldown.status === 'available' ? 'available' : 'cooling_down';

      // e) Rollback donors table
      const updatePayload: Record<string, any> = {
        status: freshStatus,
        updatedAt: new Date(),
      };

      if (isPlatelet) {
        updatePayload.plateletDonationDate = rolledBackPlateletDate;
      } else {
        updatePayload.lastDonationDate = rolledBackBloodDate;
      }

      await tx.update(donors).set(updatePayload).where(eq(donors.id, donorId));
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Donation deleted and donor cooldown rolled back successfully',
          rolledBackBloodDate,
          rolledBackPlateletDate,
          status: freshStatus,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donation_deleted');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error deleting donation:', err);
    return new Response(
      JSON.stringify({ error: 'Database error deleting donation', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const DELETE = POST;

