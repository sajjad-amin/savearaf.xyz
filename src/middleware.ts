import { defineMiddleware } from 'astro:middleware';
import { getSession, isAdmin } from '@/lib/auth';
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

  // 2. Track/persist language preference via cookie
  const isEnglishPath = pathname === '/en' || pathname.startsWith('/en/');
  if (isEnglishPath) {
    context.cookies.set('app_locale', 'en', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  } else if (!pathname.startsWith('/api/')) {
    context.cookies.set('app_locale', 'bn', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }

  // 3. Retrieve session and inject into Astro.locals
  let session = null;
  try {
    session = await getSession(context.request);
  } catch (err) {
    console.error('Middleware getSession error:', err);
  }

  context.locals.session = session;
  context.locals.user = session?.user ?? null;
  context.locals.getSession = async () => session;

  // 4. Admin routes protection (/admin, /en/admin, /api/admin)
  const isAdminRoute =
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/en/admin' ||
    pathname.startsWith('/en/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/');

  if (isAdminRoute) {
    if (!session || !session.user) {
      if (pathname.startsWith('/api/admin')) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Admin authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect(isEnglishPath ? '/en/donate-blood' : '/donate-blood');
    }

    // Verify admin access strictly by checking user role in session or database
    let userRole = session.user.role;
    if (userRole !== 'admin' && session.user.id) {
      try {
        const [dbUser] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, session.user.id))
          .limit(1);

        if (dbUser?.role === 'admin') {
          userRole = 'admin';
          session.user.role = 'admin';
          if (context.locals.user) {
            context.locals.user.role = 'admin';
          }
        }
      } catch (err) {
        console.error('Middleware DB admin check error:', err);
      }
    }

    if (!isAdmin(userRole)) {
      if (pathname.startsWith('/api/admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden: Admin access only' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect(isEnglishPath ? '/en/dashboard?error=admin_required' : '/dashboard?error=admin_required');
    }
  }

  // 5. User is NOT logged in
  if (!session || !session.user) {
    // Cannot access onboarding, dashboard, or profile without an account
    if (
      pathname === '/onboarding' ||
      pathname === '/en/onboarding' ||
      pathname === '/dashboard' ||
      pathname === '/en/dashboard' ||
      pathname === '/profile' ||
      pathname === '/en/profile'
    ) {
      return context.redirect(isEnglishPath ? '/en/donate-blood' : '/donate-blood');
    }
    return next();
  }

  // 5. User is logged in: verify onboarding status
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
    if (pathname !== '/onboarding' && pathname !== '/en/onboarding') {
      const targetOnboarding = isEnglishPath ? '/en/onboarding' : '/onboarding';
      return context.redirect(targetOnboarding);
    }
    return next();
  }

  // If user is ALREADY onboarded, prevent access to onboarding and donate-blood login pages
  if (
    isOnboarded &&
    (pathname === '/onboarding' ||
      pathname === '/en/onboarding' ||
      pathname === '/donate-blood' ||
      pathname === '/en/donate-blood')
  ) {
    return context.redirect(isEnglishPath ? '/en/dashboard' : '/dashboard');
  }

  return next();
});
