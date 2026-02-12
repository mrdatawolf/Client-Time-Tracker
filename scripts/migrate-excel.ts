/**
 * One-time Excel data migration script.
 * Imports all time entries from Examples/Work times.xlsx into the database.
 *
 * Prerequisites: Run `npx tsx scripts/seed.ts` first to create users, job types,
 * and rate tiers. This script only imports time entries and clients.
 *
 * Usage: npx tsx scripts/migrate-excel.ts
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { getDb } from '../packages/shared/src/db/index';
import { users, clients, jobTypes, rateTiers, timeEntries } from '../packages/shared/src/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = resolve(__dirname, '..', 'Examples', 'Work times.xlsx');

// Sheets that are NOT client data
const SKIP_SHEETS = new Set(['Options', 'Template', 'breakdowns', 'Summary']);

/**
 * Convert Excel serial date to ISO date string (YYYY-MM-DD).
 * Excel epoch: 1900-01-01, with the bug that it treats 1900 as a leap year.
 */
function excelDateToISO(serial: number): string | null {
  if (!serial || typeof serial !== 'number' || serial < 1) return null;
  // Excel epoch is 1899-12-30 (accounting for the 1900 leap year bug)
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + serial * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function migrate() {
  console.log('Starting Excel migration...');
  console.log('NOTE: Stop the dev server first (PGlite is single-connection).');
  console.log(`Reading: ${EXCEL_PATH}`);

  const wb = XLSX.readFile(EXCEL_PATH);
  const db = await getDb();

  // --- Build lookup maps from existing DB data ---

  const allUsers = await db.query.users.findMany();
  const userMap = new Map<string, string>(); // displayName (lowercase) -> id
  for (const u of allUsers) {
    userMap.set(u.displayName.toLowerCase(), u.id);
  }
  console.log(`Found ${allUsers.length} users in DB: ${allUsers.map(u => u.displayName).join(', ')}`);

  const allJobTypes = await db.query.jobTypes.findMany();
  const jobTypeMap = new Map<string, string>(); // name (lowercase trimmed) -> id
  for (const jt of allJobTypes) {
    jobTypeMap.set(jt.name.toLowerCase().trim(), jt.id);
  }
  console.log(`Found ${allJobTypes.length} job types in DB`);

  const allRateTiers = await db.query.rateTiers.findMany();
  const rateMap = new Map<string, string>(); // amount string -> id
  for (const rt of allRateTiers) {
    rateMap.set(String(parseFloat(rt.amount)), rt.id);
  }
  console.log(`Found ${allRateTiers.length} rate tiers in DB`);

  // --- Process each client sheet ---

  const clientSheets = wb.SheetNames.filter(name => !SKIP_SHEETS.has(name));
  console.log(`\nProcessing ${clientSheets.length} client sheets...`);

  let totalEntries = 0;
  let skippedEntries = 0;
  let newJobTypes = 0;
  let newRates = 0;

  for (const sheetName of clientSheets) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 3) {
      console.log(`  ${sheetName}: skipped (too few rows)`);
      continue;
    }

    // Extract account holder from row 0, col 16
    const accountHolder = String(rows[0][16] || 'Neither').trim();

    // Create or get client
    let existingClient = await db.query.clients.findFirst({
      where: eq(clients.name, sheetName),
    });

    if (!existingClient) {
      const [created] = await db.insert(clients).values({
        name: sheetName,
        accountHolder: accountHolder === 'Neither' ? null : accountHolder,
      }).returning();
      existingClient = created;
      console.log(`  Created client: ${sheetName} (holder: ${accountHolder})`);
    } else {
      console.log(`  Client exists: ${sheetName}`);
    }

    const clientId = existingClient.id;

    // Parse data rows (row 3 onward)
    // Group entries by date+notes for groupId linking
    const dateNoteGroups = new Map<string, string[]>(); // "date|notes" -> entry IDs
    let sheetEntries = 0;

    for (let i = 3; i < rows.length; i++) {
      const row = rows[i] as (string | number | boolean)[];

      // Skip empty rows
      const jobName = String(row[0] || '').trim();
      const hours = Number(row[1]) || 0;
      const rate = Number(row[2]) || 0;
      const techName = String(row[7] || '').trim();
      const dateRaw = row[8];

      // Skip if no job, no hours, or no tech
      if (!jobName || hours <= 0 || !techName) continue;

      // Resolve tech
      const techId = userMap.get(techName.toLowerCase());
      if (!techId) {
        console.log(`    Row ${i}: Unknown tech "${techName}", skipping`);
        skippedEntries++;
        continue;
      }

      // Resolve date
      const dateStr = typeof dateRaw === 'number' ? excelDateToISO(dateRaw) : null;
      if (!dateStr) {
        // Some entries don't have dates
        skippedEntries++;
        continue;
      }

      // Resolve or create job type
      let jobTypeId = jobTypeMap.get(jobName.toLowerCase().trim());
      if (!jobTypeId) {
        const [newJT] = await db.insert(jobTypes).values({ name: jobName }).returning();
        jobTypeId = newJT.id;
        jobTypeMap.set(jobName.toLowerCase().trim(), jobTypeId);
        newJobTypes++;
      }

      // Resolve or create rate tier
      const rateKey = String(rate);
      let rateTierId = rateMap.get(rateKey);
      if (!rateTierId) {
        const [newRT] = await db.insert(rateTiers).values({
          amount: rateKey,
          label: `$${rate}`,
        }).returning();
        rateTierId = newRT.id;
        rateMap.set(rateKey, rateTierId);
        newRates++;
      }

      // Billing status
      const isBilled = row[4] === true || row[4] === 'TRUE' || row[4] === 1;
      const isPaid = row[5] === true || row[5] === 'TRUE' || row[5] === 1;

      // Notes
      const notes = String(row[9] || '').trim() || null;

      // Insert entry
      const [entry] = await db.insert(timeEntries).values({
        clientId,
        techId,
        jobTypeId,
        rateTierId,
        date: dateStr,
        hours: String(hours),
        notes,
        isBilled,
        isPaid,
      }).returning();

      // Track for groupId assignment
      const groupKey = `${dateStr}|${notes || ''}`;
      if (!dateNoteGroups.has(groupKey)) {
        dateNoteGroups.set(groupKey, []);
      }
      dateNoteGroups.get(groupKey)!.push(entry.id);

      sheetEntries++;
      totalEntries++;
    }

    // Assign groupIds where multiple techs worked the same job
    for (const [, entryIds] of dateNoteGroups) {
      if (entryIds.length > 1) {
        const groupId = randomUUID();
        for (const id of entryIds) {
          await db.update(timeEntries)
            .set({ groupId })
            .where(eq(timeEntries.id, id));
        }
      }
    }

    console.log(`    ${sheetEntries} entries imported`);
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total entries imported: ${totalEntries}`);
  console.log(`Entries skipped: ${skippedEntries}`);
  console.log(`New job types created: ${newJobTypes}`);
  console.log(`New rate tiers created: ${newRates}`);
  console.log('Migration complete!');

  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
