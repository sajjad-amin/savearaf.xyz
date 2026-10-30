import { Auth } from '@auth/core';
import type { Session } from '@auth/core/types';
import authConfig from '../../auth.config';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Fetches the current user session using Auth.js
 */
export async function getSession(request: Request): Promise<Session | null> {
  try {
    const url = new URL('/api/auth/session', request.url);
    const sessionReq = new Request(url.toString(), {
      headers: request.headers,
    });

    const response = (await Auth(sessionReq, authConfig)) as Response;
    if (response && response.status === 200) {
      const data = await response.json();
      if (data && Object.keys(data).length > 0) {
        return data as Session;
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching Auth.js session:', error);
    return null;
  }
}

/**
 * Checks whether a user has administrator privileges strictly based on database/session role.
 */
export function isAdmin(emailOrRole?: string | null, role?: string | null): boolean {
  if (role === 'admin') return true;
  if (emailOrRole === 'admin') return true;
  return false;
}

/**
 * Validates admin access for API routes or page requests strictly based on database role.
 * Returns the session if authorized, otherwise null.
 */
export async function requireAdminSession(request: Request): Promise<Session | null> {
  const session = await getSession(request);
  if (!session?.user) return null;

  // 1. Direct session check
  if (session.user.role === 'admin') {
    return session;
  }

  // 2. Query database strictly in case role was updated in DB
  if (session.user.id) {
    try {
      const [dbUser] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (dbUser?.role === 'admin') {
        session.user.role = 'admin';
        return session;
      }
    } catch (err) {
      console.error('Error verifying admin role in DB:', err);
    }
  }

  return null;
}
