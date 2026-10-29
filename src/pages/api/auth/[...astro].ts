export const prerender = false;
import type { APIRoute } from 'astro';
import { Auth } from '@auth/core';
import authConfig from '../../../../auth.config';

export const ALL: APIRoute = async (context) => {
  const response = await Auth(context.request, authConfig);
  return response as Response;
};

export const GET = ALL;
export const POST = ALL;
