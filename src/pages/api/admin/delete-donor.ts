export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { donors, donations } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, redirect }) => {
  // 1. Verify admin session
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Parse request data (support JSON or form data)
  const contentType = request.headers.get('content-type') || '';
  let donorId: number | null = null;
  let returnJson = false;

  if (contentType.includes('application/json')) {
    returnJson = true;
    try {
      const body = await request.json();
      donorId = Number(body.donorId || body.id);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    try {
      const formData = await request.formData();
      donorId = Number(formData.get('donorId') || formData.get('id'));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!donorId || isNaN(donorId)) {
    return new Response(JSON.stringify({ error: 'Valid donorId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 3. Find target donor
    const [targetDonor] = await db
      .select({
        id: donors.id,
        name: donors.name,
        userId: donors.userId,
      })
      .from(donors)
      .where(eq(donors.id, donorId))
      .limit(1);

    if (!targetDonor) {
      return new Response(JSON.stringify({ error: 'Donor record not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Atomic deletion: first delete all associated donations, then delete donor
    await db.transaction(async (tx) => {
      await tx.delete(donations).where(eq(donations.donorId, donorId));
      await tx.delete(donors).where(eq(donors.id, donorId));
    });

    if (returnJson) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Donor and donation history deleted successfully',
          donorId,
          freedUserId: targetDonor.userId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const referer = request.headers.get('referer') || '/admin/crm';
    const redirectUrl = new URL(referer, request.url);
    redirectUrl.searchParams.set('success', 'donor_deleted');
    return redirect(redirectUrl.pathname + redirectUrl.search);
  } catch (err: any) {
    console.error('Error deleting donor:', err);
    return new Response(
      JSON.stringify({ error: 'Database error deleting donor', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const DELETE = POST;
