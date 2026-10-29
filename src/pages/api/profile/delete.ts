export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users, accounts, sessions } from '@/db/schema';
import { eq } from 'drizzle-orm';

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
    // 1. Soft-delete user personal data (preserve user ID so donation records remain intact)
    await db
      .update(users)
      .set({
        name: 'Anonymous Donor',
        phone: null,
        image: null,
        isOnboarded: false,
      })
      .where(eq(users.id, userId));

    // 2. Revoke OAuth and session links
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(sessions).where(eq(sessions.userId, userId));

    // 3. Clear all Auth.js session cookies
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

    // 4. Redirect to home page
    return redirect('/?deleted=true', 303);
  } catch (error) {
    console.error('Error performing soft-delete on user:', error);
    return new Response(
      JSON.stringify({ error: 'অ্যাকাউন্ট অপসারণে ত্রুটি হয়েছে।' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
