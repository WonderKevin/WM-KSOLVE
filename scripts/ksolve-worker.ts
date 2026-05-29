import { chromium } from "playwright";
import { runKsolveAutomation } from "../lib/automation/ksolve-download";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLast7DaysEndingYesterday() {
  const today = new Date();

  const endDate = new Date(today);
  endDate.setDate(today.getDate() - 1);
  endDate.setHours(0, 0, 0, 0);

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  return {
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
  };
}

function getRunConfig() {
  const manualStartDate = process.env.KSOLVE_START_DATE?.trim();
  const manualEndDate = process.env.KSOLVE_END_DATE?.trim();

  const includeInvoiceSummary =
    process.env.KSOLVE_INCLUDE_INVOICE_SUMMARY !== "false";

  const includeInvoiceFiles =
    process.env.KSOLVE_INCLUDE_INVOICE_FILES !== "false";

  if (manualStartDate && manualEndDate) {
    return {
      startDate: manualStartDate,
      endDate: manualEndDate,
      includeInvoiceSummary,
      includeInvoiceFiles,
      runType: "manual",
    };
  }

  const last7Days = getLast7DaysEndingYesterday();

  return {
    ...last7Days,
    includeInvoiceSummary,
    includeInvoiceFiles,
    runType: "scheduled",
  };
}

async function loginAndGetKsolveAuth() {
  const username = process.env.KSOLVE_USERNAME;
  const password = process.env.KSOLVE_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing KSOLVE_USERNAME or KSOLVE_PASSWORD.");
  }

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let bearerToken = "";

  page.on("request", (request) => {
    const authorization = request.headers()["authorization"];

    if (authorization?.toLowerCase().startsWith("bearer ")) {
      bearerToken = authorization.replace(/^bearer\s+/i, "").trim();
    }
  });

  try {
    await page.goto("https://connect.kehe.com/#/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const emailInput = page
      .locator(
        'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]'
      )
      .first();

    await emailInput.waitFor({ timeout: 30000 });
    await emailInput.fill(username);

    const nextButton = page
      .getByRole("button", { name: /next/i })
      .or(page.locator('button:has-text("Next"), input[value="Next"]').first());

    await nextButton.click();

    const passwordInput = page
      .locator(
        'input[type="password"], input[name*="password" i], input[id*="password" i]'
      )
      .first();

    await passwordInput.waitFor({ timeout: 30000 });
    await passwordInput.fill(password);

    const loginButton = page
      .getByRole("button", { name: /log in|login|sign in/i })
      .or(
        page
          .locator(
            'button:has-text("Log In"), button:has-text("Login"), button:has-text("Sign In"), input[type="submit"]'
          )
          .first()
      );

    await loginButton.click();

    await page
      .waitForLoadState("networkidle", {
        timeout: 60000,
      })
      .catch(() => null);

    await page.goto("https://connect.kehe.com/ksolve/", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    const cookies = await context.cookies();

    const cookieHeader = cookies
      .filter((cookie) => cookie.domain.includes("kehe.com"))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    if (!bearerToken) {
      await page.goto(
        "https://connect.kehe.com/ksolve/services/api/ksolve/list/dcs",
        {
          waitUntil: "networkidle",
          timeout: 60000,
        }
      );

      await page.waitForTimeout(3000);
    }

    if (!bearerToken) {
      throw new Error(
        "Login succeeded, but no K-Solve bearer token was captured."
      );
    }

    if (!cookieHeader) {
      throw new Error("Login succeeded, but no KeHE cookies were captured.");
    }

    process.env.KSOLVE_BEARER_TOKEN = bearerToken;
    process.env.KSOLVE_COOKIE = cookieHeader;

    console.log("K-Solve login completed.");
    console.log("Fresh token and cookies captured.");
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("==================================");
  console.log("K-Solve Worker Started");
  console.log("==================================");

  await loginAndGetKsolveAuth();

  const config = getRunConfig();

  console.log(`Run type: ${config.runType}`);
  console.log(`Date range: ${config.startDate} to ${config.endDate}`);
  console.log(`Include invoice summary: ${config.includeInvoiceSummary}`);
  console.log(`Include invoice files: ${config.includeInvoiceFiles}`);

  const result = await runKsolveAutomation({
    startDate: config.startDate,
    endDate: config.endDate,
    includeInvoiceSummary: config.includeInvoiceSummary,
    includeInvoiceFiles: config.includeInvoiceFiles,
  });

  console.log("K-Solve worker completed.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("K-Solve worker failed:");
  console.error(error);
  process.exit(1);
});