export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { users, donors, donations, accounts, sessions } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { desc, eq, like, or, inArray, count } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// GET: List users with pagination and search
// -----------------------------------------------------------------------------
export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const searchParam = url.searchParams.get('search')?.trim() || '';
  const pageParam = Number(url.searchParams.get('page')) || 1;
  const limitParam = Number(url.searchParams.get('limit')) || 100;
  const limit = Math.min(500, Math.max(5, limitParam));

  try {
    const searchCondition = searchParam
      ? or(
          like(users.name, `%${searchParam}%`),
          like(users.email, `%${searchParam}%`),
          like(users.phone, `%${searchParam}%`)
        )
      : undefined;

    // Fetch total count matching condition
    const [totalResult] = await db
      .select({ count: count() })
      .from(users)
      .where(searchCondition);
    const totalCount = totalResult ? Number(totalResult.count) : 0;

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const page = Math.min(Math.max(1, pageParam), totalPages);
    const offset = (page - 1) * limit;

    // Fetch paginated users
    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        image: users.image,
        role: users.role,
        isOnboarded: users.isOnboarded,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(searchCondition)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch linked donor profiles for these users
    const userIds = userRows.map((u) => u.id);
    const linkedDonorsMap = new Map<string, typeof donors.$inferSelect>();

    if (userIds.length > 0) {
      const linkedDonors = await db
        .select()
        .from(donors)
        .where(inArray(donors.userId, userIds));

      for (const d of linkedDonors) {
        if (d.userId) {
          linkedDonorsMap.set(d.userId, d);
        }
      }
    }

    const enrichedUsers = userRows.map((u) => {
      const donor = linkedDonorsMap.get(u.id) || null;
      return {
        ...u,
        hasDonorProfile: Boolean(donor),
        donorId: donor ? donor.id : null,
        donorBloodGroup: donor ? donor.bloodGroup : null,
        donorPhone: donor ? donor.phone : null,
      };
    });

    // Compute aggregate stats across all users
    const [totalUsersRes] = await db.select({ count: count() }).from(users);
    const [totalAdminsRes] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, 'admin'));

    const stats = {
      totalUsers: totalUsersRes ? Number(totalUsersRes.count) : 0,
      totalAdmins: totalAdminsRes ? Number(totalAdminsRes.count) : 0,
      matchedCount: totalCount,
    };

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
        },
        users: enrichedUsers,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error fetching admin users:', err);
    return new Response(
      JSON.stringify({ error: 'Database error fetching users', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// -----------------------------------------------------------------------------
// PATCH / PUT: Update user role
// -----------------------------------------------------------------------------
export const PATCH: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const userId = body.userId?.trim();
    const newRole = body.role?.trim();

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (newRole !== 'admin' && newRole !== 'user') {
      return new Response(
        JSON.stringify({ error: "Invalid role. Must be 'admin' or 'user'." }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Security safeguard: Do not allow demoting one's own admin account
    if (userId === session.user.id && newRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Cannot demote your own admin account.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const [targetUser] = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.update(users).set({ role: newRole }).where(eq(users.id, userId));

    return new Response(
      JSON.stringify({
        success: true,
        message: `User role successfully updated to ${newRole}`,
        userId,
        role: newRole,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error updating user role:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to update user role', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PUT = PATCH;

// -----------------------------------------------------------------------------
// DELETE: Permanently delete a user account and cascade dependencies
// -----------------------------------------------------------------------------
export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const userId = body.userId?.trim();
    const confirmText = body.confirmText?.trim();

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (confirmText !== 'CONFIRM') {
      return new Response(
        JSON.stringify({ error: "Confirmation failed. Must type 'CONFIRM'." }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Security safeguard: Do not allow deleting own account
    if (userId === session.user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot delete your own admin account.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const [targetUser] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Perform atomic cascading delete
    await db.transaction(async (tx) => {
      // 1. Find all donor profiles owned by this user
      const ownedDonors = await tx
        .select({ id: donors.id })
        .from(donors)
        .where(eq(donors.userId, userId));

      for (const od of ownedDonors) {
        // Delete all donations logged for this donor
        await tx.delete(donations).where(eq(donations.donorId, od.id));
        // Delete the donor profile
        await tx.delete(donors).where(eq(donors.id, od.id));
      }

      // 2. For referred donors added by this user, unlink addedByUserId
      await tx
        .update(donors)
        .set({ addedByUserId: null })
        .where(eq(donors.addedByUserId, userId));

      // 3. Delete Auth.js sessions & accounts
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(accounts).where(eq(accounts.userId, userId));

      // 4. Finally delete user from users table
      await tx.delete(users).where(eq(users.id, userId));
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'User account and all associated data permanently deleted.',
        deletedUserId: userId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to delete user account', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// -----------------------------------------------------------------------------
// POST: Flexible fallback delegating to DELETE or PATCH based on body/method
// -----------------------------------------------------------------------------
export const POST: APIRoute = async (context) => {
  const req = context.request;
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const cloned = req.clone();
      const body = await cloned.json();
      if (body._method === 'DELETE' || body.action === 'delete') {
        return DELETE(context);
      }
      return PATCH(context);
    } catch {
      return PATCH(context);
    }
  }
  return PATCH(context);
};
