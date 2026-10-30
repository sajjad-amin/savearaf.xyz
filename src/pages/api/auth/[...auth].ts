export const prerender = false;
import type { APIRoute } from 'astro';
import { Auth } from '@auth/core';
import authConfig from '../../../../auth.config';

export const ALL: APIRoute = async (context) => {
  const authUrl = process.env.AUTH_URL || import.meta.env.AUTH_URL;
  let req = context.request;

  if (authUrl) {
    try {
      const publicBase = new URL(authUrl);
      const incomingUrl = new URL(context.request.url);
      const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, publicBase.origin);
      req = new Request(targetUrl.toString(), context.request);
    } catch {
      // fallback to original request
    }
  } else {
    const proto = context.request.headers.get('x-forwarded-proto') || 'https';
    const host = context.request.headers.get('x-forwarded-host') || context.request.headers.get('host');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const incomingUrl = new URL(context.request.url);
      const targetUrl = new URL(`${proto}://${host}${incomingUrl.pathname}${incomingUrl.search}`);
      req = new Request(targetUrl.toString(), context.request);
    }
  }

  const response = await Auth(req, authConfig);
  return response as Response;
};

export const GET = ALL;
export const POST = ALL;
