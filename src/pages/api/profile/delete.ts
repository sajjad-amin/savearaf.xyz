export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users, accounts, sessions, donors } from '@/db/schema';
import { eq, or } from 'drizzle-orm';

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
    // 1. Query the donors table to check for existing relational data (self or referrals)
    const [relationalDonor] = await db
      .select({ id: donors.id })
      .from(donors)
      .where(or(eq(donors.userId, userId), eq(donors.addedByUserId, userId)))
      .limit(1);

    if (relationalDonor) {
      // Relational donor/donation data exists: perform SOFT DELETE to preserve donation history
      const freedEmail = `deleted_${Date.now()}_${userId}@savearaf.xyz`;
      await db
        .update(users)
        .set({
          name: 'Anonymous Donor',
          phone: null,
          image: null,
          isOnboarded: false,
          email: freedEmail,
        })
        .where(eq(users.id, userId));

      // Revoke OAuth account and session records
      await db.delete(accounts).where(eq(accounts.userId, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
    } else {
      // User has NEVER added a donor profile (self or referral): perform complete HARD DELETE
      await db.delete(accounts).where(eq(accounts.userId, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }

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
