export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { calculateTwoStepCooldown } from '@/lib/cooldown';
import { desc, eq, like, or } from 'drizzle-orm';

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
  const searchParam = url.searchParams.get('search')?.trim() || '';

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

    // 2. Fetch donors (optionally filtered by SQL LIKE)
    const searchCondition = searchParam
      ? or(
          like(donors.name, `%${searchParam}%`),
          like(donors.phone, `%${searchParam}%`),
          like(donors.location, `%${searchParam}%`)
        )
      : undefined;

    const allDonors = await db
      .select()
      .from(donors)
      .where(searchCondition)
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

    // 6. Server-Side Pagination
    const pageParam = Number(url.searchParams.get('page')) || 1;
    const limitParam = Number(url.searchParams.get('limit')) || 100;
    const limit = Math.min(500, Math.max(5, limitParam));
    const totalCount = enrichedDonors.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const page = Math.min(Math.max(1, pageParam), totalPages);

    const offset = (page - 1) * limit;
    const paginatedDonors = enrichedDonors.slice(offset, offset + limit);

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
        },
        donors: paginatedDonors,
      }),
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

