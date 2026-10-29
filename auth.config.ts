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
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
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

        const adminEmails = (process.env.ADMIN_EMAILS || '')
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);

        if (user.email && adminEmails.includes(user.email.toLowerCase())) {
          token.role = 'admin';
        }
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

        const adminEmails = (process.env.ADMIN_EMAILS || '')
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);

        if (session.user.email && adminEmails.includes(session.user.email.toLowerCase())) {
          session.user.role = 'admin';
        }
      }
      return session;
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET || 'development_secret_only_change_in_production',
} satisfies AuthConfig;
