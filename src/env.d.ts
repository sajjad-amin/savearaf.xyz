/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { DefaultSession } from '@auth/core/types';

declare module '@auth/core/types' {
  interface User {
    role?: 'admin' | 'user';
    phone?: string | null;
    isOnboarded?: boolean;
    is_onboarded?: boolean;
  }
  interface Session {
    user: {
      id: string;
      role: 'admin' | 'user';
      phone?: string | null;
      is_onboarded: boolean;
    } & DefaultSession['user'];
  }
}

declare global {
  namespace App {
    interface Locals {
      session: import('@auth/core/types').Session | null;
      user: import('@auth/core/types').Session['user'] | null;
      getSession: () => Promise<import('@auth/core/types').Session | null>;
    }
  }
}
