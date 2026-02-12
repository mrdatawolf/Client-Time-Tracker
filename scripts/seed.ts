/**
 * Seed script - creates initial admin users, job types, and rate tiers
 * from the Excel Options sheet data.
 *
 * Usage: npx tsx scripts/seed.ts
 */
import { getDb } from '../packages/shared/src/db/index';
import { users, jobTypes, rateTiers, partnerSplits } from '../packages/shared/src/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'changeme';

async function seed() {
  console.log('Seeding database...');
  console.log('NOTE: Stop the dev server first (PGlite is single-connection).');
  const db = await getDb();

  // Create admin users (partners)
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  await db.insert(users).values({
    username: 'patrick',
    displayName: 'Patrick',
    passwordHash,
    role: 'admin',
  }).onConflictDoNothing();

  await db.insert(users).values({
    username: 'anthony',
    displayName: 'Anthony',
    passwordHash,
    role: 'admin',
  }).onConflictDoNothing();

  await db.insert(users).values({
    username: 'robert',
    displayName: 'Robert',
    passwordHash,
    role: 'basic',
  }).onConflictDoNothing();

  // Query back to get IDs reliably
  const patrick = await db.query.users.findFirst({ where: eq(users.username, 'patrick') });
  const anthony = await db.query.users.findFirst({ where: eq(users.username, 'anthony') });

  console.log('Users created (password for all: "changeme")');

  // Job types from the Excel Options sheet
  const jobTypeNames = [
    'Accounting Comp', 'Aldelo issues', 'Blocked Emails', 'Check-in',
    'Consulting', 'Dead batteries', 'Docusign', 'Email Issue',
    'Epicor issues', 'Hardware', 'Hosting', 'License Renewal',
    'Malware', 'Misc', 'Monitoring', 'Nas replacement',
    'Nas/Backup', 'Networking', 'New Comp Build', 'New Comp Setup',
    'Onboarding', 'Printer', 'Quickbooks', 'RDP',
    'Restore backup', 'Security', 'Server', 'Server Migration',
    'Software Issue', 'Software', 'SSL', 'VPN',
    'Website', 'Windows Update', 'Phone',
  ];

  for (const name of jobTypeNames) {
    await db.insert(jobTypes).values({ name }).onConflictDoNothing();
  }
  console.log(`${jobTypeNames.length} job types created`);

  // Rate tiers from the Excel Options sheet
  const rates = [10, 40, 70, 82.5, 92.5, 100, 110, 145, 165, 185, 265];

  for (const amount of rates) {
    await db.insert(rateTiers).values({
      amount: String(amount),
      label: `$${amount}`,
    }).onConflictDoNothing();
  }
  console.log(`${rates.length} rate tiers created`);

  // Partner splits (from Excel: 0.73 / 0.27)
  if (patrick && anthony) {
    await db.insert(partnerSplits).values([
      {
        partnerId: patrick.id,
        splitPercent: '0.7300',
        effectiveFrom: '2024-01-01',
      },
      {
        partnerId: anthony.id,
        splitPercent: '0.2700',
        effectiveFrom: '2024-01-01',
      },
    ]).onConflictDoNothing();
    console.log('Partner splits created (73% / 27%)');
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
