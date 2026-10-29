import { relations } from 'drizzle-orm';
import {
  mysqlTable,
  varchar,
  text,
  int,
  bigint,
  serial,
  decimal,
  boolean,
  timestamp,
  mysqlEnum,
  primaryKey,
} from 'drizzle-orm/mysql-core';

// ==========================================
// 1. Users Table (Auth.js + Custom Fields)
// ==========================================
export const users = mysqlTable('users', {
  id: varchar('id', { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date', fsp: 3 }),
  image: varchar('image', { length: 255 }),
  role: mysqlEnum('role', ['admin', 'user']).notNull().default('user'),
  phone: varchar('phone', { length: 50 }),
  isOnboarded: boolean('is_onboarded').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// Auth.js Accounts Table
export const accounts = mysqlTable(
  'accounts',
  {
    userId: varchar('userId', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('providerAccountId', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: int('expires_at'),
    token_type: varchar('token_type', { length: 255 }),
    scope: varchar('scope', { length: 255 }),
    id_token: text('id_token'),
    session_state: varchar('session_state', { length: 255 }),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

// Auth.js Sessions Table
export const sessions = mysqlTable('sessions', {
  sessionToken: varchar('sessionToken', { length: 255 }).primaryKey().notNull(),
  userId: varchar('userId', { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

// Auth.js Verification Tokens Table
export const verificationTokens = mysqlTable(
  'verificationTokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [
    primaryKey({ columns: [vt.identifier, vt.token] }),
  ]
);

// ==========================================
// 2. Donors Table (Blood Donor CRM)
// ==========================================
export const donors = mysqlTable('donors', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 255 }).references(() => users.id, {
    onDelete: 'set null',
  }),
  addedByUserId: varchar('added_by_user_id', { length: 255 }).references(
    () => users.id,
    { onDelete: 'set null' }
  ),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  bloodGroup: mysqlEnum('blood_group', [
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
  ]).notNull(),
  location: varchar('location', { length: 255 }),
  donationPreference: mysqlEnum('donation_preference', [
    'whole_blood',
    'platelets',
  ])
    .notNull()
    .default('whole_blood'),
  status: mysqlEnum('status', ['available', 'cooling_down'])
    .notNull()
    .default('available'),
  lastDonationDate: timestamp('last_donation_date', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ==========================================
// 3. Donations Table (Donation History & Cooldown)
// ==========================================
export const donations = mysqlTable('donations', {
  id: serial('id').primaryKey(),
  donorId: bigint('donor_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => donors.id, { onDelete: 'cascade' }),
  donationDate: timestamp('donation_date', { mode: 'date' }).notNull(),
  type: mysqlEnum('type', ['whole_blood', 'platelets']).notNull(),
  hospital: varchar('hospital', { length: 255 }),
  nextEligibleDate: timestamp('next_eligible_date', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==========================================
// 4. Fund Tracker Table
// ==========================================
export const fundTracker = mysqlTable('fund_tracker', {
  id: serial('id').primaryKey(),
  totalReceived: decimal('total_received', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  totalSpent: decimal('total_spent', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  targetGoal: decimal('target_goal', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  lastUpdated: timestamp('last_updated').defaultNow().onUpdateNow().notNull(),
});

// ==========================================
// 5. Bank Accounts Table
// ==========================================
export const bankAccounts = mysqlTable('bank_accounts', {
  id: serial('id').primaryKey(),
  bankName: varchar('bank_name', { length: 255 }).notNull(),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  accountNumber: varchar('account_number', { length: 100 }).notNull(),
  branch: varchar('branch', { length: 255 }),
  routingNumber: varchar('routing_number', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ==========================================
// 6. Patient Updates / Blog Table (TinyMCE Content)
// ==========================================
export const updates = mysqlTable('updates', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ==========================================
// Relational Mappings
// ==========================================
export const usersRelations = relations(users, ({ one, many }) => ({
  donorProfile: one(donors, {
    fields: [users.id],
    references: [donors.userId],
    relationName: 'userDonorProfile',
  }),
  referredDonors: many(donors, {
    relationName: 'referredDonors',
  }),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const donorsRelations = relations(donors, ({ one, many }) => ({
  user: one(users, {
    fields: [donors.userId],
    references: [users.id],
    relationName: 'userDonorProfile',
  }),
  referrer: one(users, {
    fields: [donors.addedByUserId],
    references: [users.id],
    relationName: 'referredDonors',
  }),
  donations: many(donations),
}));

export const donationsRelations = relations(donations, ({ one }) => ({
  donor: one(donors, {
    fields: [donations.donorId],
    references: [donors.id],
  }),
}));

// ==========================================
// Type Inferences
// ==========================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Donor = typeof donors.$inferSelect;
export type NewDonor = typeof donors.$inferInsert;

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;

export type FundTracker = typeof fundTracker.$inferSelect;
export type NewFundTracker = typeof fundTracker.$inferInsert;

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;

export type Update = typeof updates.$inferSelect;
export type NewUpdate = typeof updates.$inferInsert;
