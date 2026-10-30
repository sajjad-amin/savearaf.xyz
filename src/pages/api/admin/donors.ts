export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { calculateTwoStepCooldown } from '@/lib/cooldown';
import { desc, eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ request }) => {
  // 1. Verify admin access
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const singleDonorId = url.searchParams.get('donorId');

  try {
    // If requesting history for a single donor
    if (singleDonorId) {
      const donorIdNum = Number(singleDonorId);
      if (isNaN(donorIdNum)) {
        return new Response(JSON.stringify({ error: 'Invalid donorId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const history = await db
        .select()
        .from(donations)
        .where(eq(donations.donorId, donorIdNum))
        .orderBy(desc(donations.donationDate));

      return new Response(JSON.stringify({ success: true, history }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch all donors
    const allDonors = await db
      .select()
      .from(donors)
      .orderBy(desc(donors.createdAt));

    // 3. Fetch all donations history records
    const allDonations = await db
      .select()
      .from(donations)
      .orderBy(desc(donations.donationDate));

    // Map donations by donorId
    const donationsByDonorId = new Map<number, typeof allDonations>();
    for (const d of allDonations) {
      const list = donationsByDonorId.get(d.donorId) || [];
      list.push(d);
      donationsByDonorId.set(d.donorId, list);
    }

    const now = new Date();

    // 4. Calculate two-step cooldown for each donor
    const enrichedDonors = allDonors.map((d) => {
      const donorHistory = donationsByDonorId.get(d.id) || [];
      const cooldown = calculateTwoStepCooldown(
        d.lastDonationDate,
        d.plateletDonationDate,
        donorHistory,
        now
      );

      return {
        ...d,
        cooldown,
        donationCount: donorHistory.length,
        recentDonations: donorHistory.slice(0, 5),
      };
    });

    // 5. Compute summary stats
    const stats = {
      total: enrichedDonors.length,
      available: enrichedDonors.filter((d) => d.cooldown.status === 'available').length,
      bloodCooldown: enrichedDonors.filter((d) => !d.cooldown.isBloodEligible).length,
      plateletCooldown: enrichedDonors.filter((d) => !d.cooldown.isPlateletEligible).length,
      guestDonors: enrichedDonors.filter((d) => d.isGuest).length,
    };

    return new Response(
      JSON.stringify({ success: true, stats, donors: enrichedDonors }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error fetching admin donors:', err);
    return new Response(
      JSON.stringify({ error: 'Database error fetching donors', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

