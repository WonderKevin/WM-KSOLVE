import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const DOWNLOAD_DIR = 'downloads';
const MANIFEST_FILE = 'download-manifest.json';

function parseDate(value: string): Date | null {
  const clean = value.trim();
  const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);

  if (year < 100) year += 2000;

  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  return parsed;
}

function getLastWeekRange() {
  const today = new Date();
  const day = today.getDay();
  const normalizedDay = day === 0 ? 7 : day;

  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - normalizedDay - 6);
  lastMonday.setHours(0, 0, 0, 0);

  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);

  return { lastMonday, lastSunday };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US');
}

function loadManifest(): Set<string> {
  if (!fs.existsSync(MANIFEST_FILE)) return new Set();

  try {
    return new Set(JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveManifest(keys: Set<string>) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify([...keys], null, 2));
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const downloadedKeys = loadManifest();
  const { lastMonday, lastSunday } = getLastWeekRange();

  console.log(`Filtering Check Date from ${formatDate(lastMonday)} → ${formatDate(lastSunday)}`);

  await page.goto('https://connect.kehe.com/#/dashboard');

  console.log('Log in and navigate to K-Solve table, then press Enter.');
  await new Promise(resolve => process.stdin.once('data', resolve));

  console.log('Waiting for K-Solve grid rows...');
  await page.waitForTimeout(3000);

  const rows = page.locator('.k-grid-content tr');
  const rowCount = await rows.count();

  console.log(`Found ${rowCount} rows.`);

  if (rowCount === 0) {
    throw new Error('No K-Solve rows found. Make sure you are on the table page and rows are visible.');
  }

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);

    const rowText = await row.innerText({ timeout: 5000 }).catch(() => '');

    const values = rowText
      .split('\t')
      .map(v => v.trim());

    if (values.length < 9) {
      console.log(`Skipping row ${i}: malformed`, values);
      continue;
    }

    const invoice = values[0];
    const invoiceDateText = values[1];
    const checkNumber = values[7];
    const checkDateText = values[8];

    const checkDate = parseDate(checkDateText);

    if (!checkDate) {
      console.log(`Skipping ${invoice}: no check date`);
      continue;
    }

    if (checkDate < lastMonday || checkDate > lastSunday) {
      console.log(`Skipping ${invoice}: ${checkDateText} not in last week`);
      continue;
    }

    const uniqueKey = `${invoice}|${invoiceDateText}|${checkNumber}|${checkDateText}`;

    if (downloadedKeys.has(uniqueKey)) {
      console.log(`Skipping duplicate: ${uniqueKey}`);
      continue;
    }

    const downloadIcon = row.locator('[title="Download Documents"]:visible');

    if ((await downloadIcon.count()) === 0) {
      console.log(`Skipping ${invoice}: no visible download icon`);
      continue;
    }

    console.log(`Downloading ${uniqueKey}`);

    try {
      await downloadIcon.first().click();

      const downloadButton = page.getByRole('link', { name: 'Download' });
      await downloadButton.waitFor({ timeout: 10000 });

      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();

      const download = await downloadPromise;

      const finalFileName = safeName(
        `${invoice}_${invoiceDateText}_${checkNumber}_${checkDateText}_${download.suggestedFilename()}`
      );

      const savePath = path.join(process.cwd(), DOWNLOAD_DIR, finalFileName);

      await download.saveAs(savePath);

      downloadedKeys.add(uniqueKey);
      saveManifest(downloadedKeys);

      console.log(`Downloaded: ${finalFileName}`);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } catch (err) {
      console.log(`Failed on ${invoice}, skipping...`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      continue;
    }
  }

  console.log('Done.');
  await browser.close();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});