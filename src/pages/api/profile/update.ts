export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request);
  if (!session || !session.user || !session.user.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let name = '';
  let phone = '';

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      name = (body.name || '').trim();
      phone = (body.phone || '').trim();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    const formData = await request.formData();
    name = (formData.get('name')?.toString() || '').trim();
    phone = (formData.get('phone')?.toString() || '').trim();
  }

  // Name validation
  if (!name || name.length < 2) {
    return new Response(
      JSON.stringify({ error: 'অনুগ্রহ করে একটি সঠিক নাম লিখুন (Name required)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Phone validation
  const cleanedPhone = phone.replace(/[\s\-()]/g, '');
  if (!cleanedPhone || cleanedPhone.length < 8 || !/^\+?[0-9]{8,18}$/.test(cleanedPhone)) {
    return new Response(
      JSON.stringify({
        error: 'অনুগ্রহ করে একটি সঠিক ও সক্রিয় ফোন নম্বর লিখুন (Valid phone required)',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    await db
      .update(users)
      .set({
        name,
        phone: cleanedPhone,
      })
      .where(eq(users.id, session.user.id));

    return redirect('/profile?updated=true', 303);
  } catch (error) {
    console.error('Error updating profile in database:', error);
    return new Response(
      JSON.stringify({ error: 'ডাটাবেজে তথ্য সংরক্ষণে ত্রুটি হয়েছে।' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
