export const prerender = false;
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { users, donors, accounts, sessions } from '@/db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { sanitizeName, sanitizePhone, getPhoneVariants } from '@/lib/sanitize';

export const POST: APIRoute = async ({ request, redirect }) => {
  const session = await getSession(request);
  if (!session || !session.user || !session.user.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let rawName = '';
  let rawPhone = '';

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      rawName = body.name || '';
      rawPhone = body.phone || '';
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    const formData = await request.formData();
    rawName = formData.get('name')?.toString() || '';
    rawPhone = formData.get('phone')?.toString() || '';
  }

  // Sanitize inputs (strip HTML/scripts)
  const cleanedName = sanitizeName(rawName);
  const cleanedPhone = sanitizePhone(rawPhone);

  // Name validation
  if (!cleanedName || cleanedName.length < 2) {
    return new Response(
      JSON.stringify({ error: 'অনুগ্রহ করে একটি সঠিক নাম লিখুন (Name required)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Phone validation
  if (!cleanedPhone || cleanedPhone.length < 8 || !/^\+?[0-9]{8,18}$/.test(cleanedPhone)) {
    return new Response(
      JSON.stringify({
        error: 'অনুগ্রহ করে একটি সঠিক ও সক্রিয় ফোন নম্বর লিখুন (Valid phone required)',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userId = session.user.id;
  const referer = request.headers.get('referer') || '';
  const isEn = referer.includes('/en');

  try {
    // 1. Check BOTH users and donors tables using phoneVariants
    const phoneVariants = getPhoneVariants(cleanedPhone);

    const duplicateUsers = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(inArray(users.phone, phoneVariants), ne(users.id, userId)));

    const duplicateDonors = await db
      .select({ id: donors.id, userId: donors.userId, addedByUserId: donors.addedByUserId })
      .from(donors)
      .where(inArray(donors.phone, phoneVariants));

    const donorAssociatedUserIds = duplicateDonors
      .flatMap((d) => [d.userId, d.addedByUserId])
      .filter((id): id is string => Boolean(id && id !== userId));

    const candidateUserIds = Array.from(
      new Set([...duplicateUsers.map((u) => u.id), ...donorAssociatedUserIds])
    );

    let hasActiveUser = false;
    const zombieUserIds: string[] = [];

    for (const candidateId of candidateUserIds) {
      let u = duplicateUsers.find((du) => du.id === candidateId);
      if (!u) {
        const [fetched] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, candidateId))
          .limit(1);
        u = fetched;
      }

      if (u) {
        const isZombie =
          u.name === 'Anonymous Donor' || Boolean(u.email && u.email.startsWith('deleted_'));
        if (!isZombie) {
          hasActiveUser = true;
          break;
        } else {
          zombieUserIds.push(candidateId);
        }
      }
    }

    // Condition A: If the phone belongs to an active user, reject update request
    if (hasActiveUser) {
      if (contentType.includes('application/json')) {
        return new Response(JSON.stringify({ error: 'phone_exists_active' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return redirect(isEn ? '/en/profile?error=phone_exists_active' : '/profile?error=phone_exists_active', 303);
    }

    // Condition B: If it belongs to a zombie user, perform zombie cleanup (Hard Delete)
    for (const zombieId of zombieUserIds) {
      // Transfer any zombie-owned donor matching this phone to the user
      await db
        .update(donors)
        .set({ userId, addedByUserId: null })
        .where(and(eq(donors.userId, zombieId), inArray(donors.phone, phoneVariants)));

      await db.delete(accounts).where(eq(accounts.userId, zombieId));
      await db.delete(sessions).where(eq(sessions.userId, zombieId));
      await db.delete(users).where(eq(users.id, zombieId));
    }

    // Update user profile in database
    await db
      .update(users)
      .set({
        name: cleanedName,
        phone: cleanedPhone,
      })
      .where(eq(users.id, userId));

    // Also sync own donor profile if exists
    await db
      .update(donors)
      .set({
        name: cleanedName,
        phone: cleanedPhone,
      })
      .where(eq(donors.userId, userId));

    const redirectUrl = isEn ? '/en/profile?updated=true' : '/profile?updated=true';
    return redirect(redirectUrl, 303);
  } catch (error) {
    console.error('Error updating profile in database:', error);
    return new Response(
      JSON.stringify({ error: 'ডাটাবেজে তথ্য সংরক্ষণে ত্রুটি হয়েছে।' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
