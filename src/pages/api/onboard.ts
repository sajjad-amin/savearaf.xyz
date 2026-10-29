export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request);
  if (!session || !session.user || !session.user.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Please log in.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let phone = '';
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      phone = (body.phone || '').trim();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    const formData = await request.formData();
    phone = (formData.get('phone')?.toString() || '').trim();
  }

  // Normalize phone number (strip whitespace, dashes, parens)
  const cleanedPhone = phone.replace(/[\s\-()]/g, '');

  // Validation: Accept any valid phone number (minimum 8 digits, e.g. BD 11-digit or international)
  if (!cleanedPhone || cleanedPhone.length < 8 || !/^\+?[0-9]{8,18}$/.test(cleanedPhone)) {
    return new Response(
      JSON.stringify({
        error: 'অনুগ্রহ করে একটি সঠিক ও সক্রিয় ফোন নম্বর লিখুন (Please enter a valid phone number)',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Update the user record in database
    await db
      .update(users)
      .set({
        phone: cleanedPhone,
        isOnboarded: true,
      })
      .where(eq(users.id, session.user.id));

    // Redirect to home upon success (303 for clean form submission)
    return redirect('/', 303);
  } catch (error) {
    console.error('Error updating onboarding status in database:', error);
    return new Response(
      JSON.stringify({
        error: 'ডাটাবেজে তথ্য সংরক্ষণে ত্রুটি হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
