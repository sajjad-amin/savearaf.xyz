import type { AuthConfig } from '@auth/core/types';
import Google from '@auth/core/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from './src/db';
import { users, accounts, sessions, verificationTokens } from './src/db/schema';

export default {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId:
        (typeof import.meta !== 'undefined' && import.meta.env?.GOOGLE_CLIENT_ID) ||
        process.env.GOOGLE_CLIENT_ID ||
        (typeof import.meta !== 'undefined' && import.meta.env?.AUTH_GOOGLE_ID) ||
        process.env.AUTH_GOOGLE_ID ||
        '',
      clientSecret:
        (typeof import.meta !== 'undefined' && import.meta.env?.GOOGLE_CLIENT_SECRET) ||
        process.env.GOOGLE_CLIENT_SECRET ||
        (typeof import.meta !== 'undefined' && import.meta.env?.AUTH_GOOGLE_SECRET) ||
        process.env.AUTH_GOOGLE_SECRET ||
        '',
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? 'user';
        token.is_onboarded = user.isOnboarded ?? false;
        token.phone = user.phone ?? null;
      }
      return token;
    },
    async session({ session, token, user }) {
      if (session.user) {
        const userId = (token?.id as string) || (token?.sub as string) || user?.id;
        if (userId) {
          session.user.id = userId;
        }

        session.user.role =
          (token?.role as 'admin' | 'user') || user?.role || 'user';
        session.user.is_onboarded = Boolean(
          token?.is_onboarded ?? user?.isOnboarded ?? false
        );
        session.user.phone = (token?.phone as string) || user?.phone || null;
      }
      return session;
    },
  },
  basePath: '/api/auth',
  pages: {
    signIn: '/donate-blood',
  },
  trustHost: true,
  secret:
    (typeof import.meta !== 'undefined' && import.meta.env?.AUTH_SECRET) ||
    process.env.AUTH_SECRET ||
    'development_secret_only_change_in_production',
} satisfies AuthConfig;
