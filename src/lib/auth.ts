import { Auth } from '@auth/core';
import type { Session } from '@auth/core/types';
import authConfig from '../../auth.config';

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
