import { chromium } from "@playwright/test";

type RunKsolveAutomationInput = {
  startDate: string;
  endDate: string;
};

export async function runKsolveAutomation({
  startDate,
  endDate,
}: RunKsolveAutomationInput) {
  const browser = await chromium.launch({
    headless: false, // keep visible for manual login while testing
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  try {
    await page.goto("https://connect.kehe.com/#/dashboard", {
      waitUntil: "domcontentloaded",
    });

    console.log("Manual step required: login + navigate to K-Solve");
    console.log(`Selected check date range: ${startDate} to ${endDate}`);

    // TEMP: pause so you can login manually and navigate to K-Solve
    await page.waitForTimeout(60000);

    console.log("K-Solve automation placeholder running...");
    console.log(`Use these dates in Playwright: ${startDate} to ${endDate}`);
  } finally {
    await browser.close();
  }
}