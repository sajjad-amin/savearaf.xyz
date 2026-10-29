export const prerender = false;

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

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
    const type = formData.get('type')?.toString().trim() || 'referral';
    const donorIdRaw = formData.get('donor_id')?.toString().trim();

    if (type === 'self') {
      // 1. Unpublish self donor profile
      const [selfDonor] = await db
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId))
        .limit(1);

      if (selfDonor) {
        // Remove donation history and donor record (user account remains untouched)
        await db.delete(donations).where(eq(donations.donorId, selfDonor.id));
        await db.delete(donors).where(eq(donors.id, selfDonor.id));
      }

      const redirectUrl = isEn
        ? '/en/dashboard?success=unregistered&tab=profile'
        : '/dashboard?success=unregistered&tab=profile';
      return redirect(redirectUrl, 303);
    }

    // 2. Delete referred donor (Enforce ownership check: addedByUserId === userId)
    const donorId = Number(donorIdRaw);
    if (!donorId || isNaN(donorId)) {
      return new Response(JSON.stringify({ error: 'Invalid donor ID provided.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [donorRecord] = await db
      .select({ id: donors.id })
      .from(donors)
      .where(and(eq(donors.id, donorId), eq(donors.addedByUserId, userId)))
      .limit(1);

    if (!donorRecord) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not have permission to delete this donor.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await db.delete(donations).where(eq(donations.donorId, donorId));
    await db.delete(donors).where(eq(donors.id, donorId));

    const redirectUrl = isEn
      ? '/en/dashboard?success=deleted&tab=referrals'
      : '/dashboard?success=deleted&tab=referrals';
    return redirect(redirectUrl, 303);
  } catch (error) {
    console.error('Error deleting donor record:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error while deleting donor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
