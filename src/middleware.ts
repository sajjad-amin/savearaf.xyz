import { defineMiddleware } from 'astro:middleware';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Always allow static assets and auth API endpoints
  if (
    pathname.startsWith('/_') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/favicon') ||
    pathname === '/api/onboard' ||
    /\.(png|svg|ico|jpg|jpeg|webp|css|js|woff|woff2|ttf)$/.test(pathname)
  ) {
    return next();
  }

  // 2. Retrieve session and inject into Astro.locals
  let session = null;
  try {
    session = await getSession(context.request);
  } catch (err) {
    console.error('Middleware getSession error:', err);
  }

  context.locals.session = session;
  context.locals.user = session?.user ?? null;

  // 3. User is NOT logged in
  if (!session || !session.user) {
    // Cannot access onboarding without an account
    if (pathname === '/onboarding') {
      return context.redirect('/');
    }
    return next();
  }

  // 4. User is logged in: verify onboarding status
  let isOnboarded = session.user.is_onboarded;

  // If session says not onboarded, query the database once to confirm it wasn't just updated
  if (!isOnboarded && session.user.id) {
    try {
      const [dbUser] = await db
        .select({
          isOnboarded: users.isOnboarded,
          role: users.role,
          phone: users.phone,
        })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (dbUser) {
        isOnboarded = dbUser.isOnboarded;
        session.user.is_onboarded = dbUser.isOnboarded;
        session.user.role = dbUser.role;
        session.user.phone = dbUser.phone;
        context.locals.user = session.user;
      }
    } catch {
      // In case database is temporarily slow, rely on session token value
    }
  }

  // If user is NOT onboarded, enforce onboarding redirection (prevent redirect loop)
  if (!isOnboarded) {
    if (pathname !== '/onboarding') {
      return context.redirect('/onboarding');
    }
    return next();
  }

  // If user is ALREADY onboarded, prevent access to onboarding page
  if (isOnboarded && pathname === '/onboarding') {
    return context.redirect('/');
  }

  return next();
});
