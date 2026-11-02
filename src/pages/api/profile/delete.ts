export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users, accounts, sessions, donors, donations } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const session = await getSession(request);
  if (!session || !session.user || !session.user.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = session.user.id;

  try {
    // 1. Permanently delete all associated donors records, donation history, and user data in a single transaction
    await db.transaction(async (tx) => {
      // Find all self-donor profiles belonging to this user
      const selfDonors = await tx
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId));

      const donorIds = selfDonors.map((d) => d.id);

      // Permanently delete donation history for this user's self-donor profile(s)
      if (donorIds.length > 0) {
        await tx.delete(donations).where(inArray(donations.donorId, donorIds));
      }

      // Permanently delete self-donor profile(s) from donors table to prevent PII leak
      await tx.delete(donors).where(eq(donors.userId, userId));

      // For any guest referrals added by this user, safely unassign addedByUserId
      await tx
        .update(donors)
        .set({ addedByUserId: null })
        .where(eq(donors.addedByUserId, userId));

      // Permanently delete user authentication accounts, active sessions, and user record
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });

    // 2. Clear all Auth.js session cookies
    const cookieNames = [
      'authjs.session-token',
      '__Secure-authjs.session-token',
      'authjs.csrf-token',
      '__Host-authjs.csrf-token',
      'authjs.callback-url',
      'next-auth.session-token',
      '__Secure-next-auth.session-token',
    ];
    for (const cookieName of cookieNames) {
      cookies.delete(cookieName, { path: '/' });
    }

    // 3. Redirect to home page with locale preservation
    const referer = request.headers.get('referer') || '';
    const isEn = referer.includes('/en');
    const redirectUrl = isEn ? '/en?deleted=true' : '/?deleted=true';
    return redirect(redirectUrl, 303);
  } catch (error) {
    console.error('Error in profile delete handler:', error);
    return new Response(
      JSON.stringify({ error: 'অ্যাকাউন্ট অপসারণে ত্রুটি হয়েছে।' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
