import { chromium } from "@playwright/test";

export async function runKsolveAutomation() {
  const browser = await chromium.launch({
    headless: false, // keep visible for now
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  await page.goto("https://connect.kehe.com/#/dashboard");

  console.log("Manual step required: login + navigate to K-Solve");

  // TEMP: pause so you can login manually
  await page.waitForTimeout(60000);

  console.log("Automation placeholder running...");

  await browser.close();
}
