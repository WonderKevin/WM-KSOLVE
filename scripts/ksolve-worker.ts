import { chromium, type Page } from "playwright";
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

function extractBearerToken(authorization: string | undefined) {
  if (!authorization?.toLowerCase().startsWith("bearer ")) return "";
  return authorization.replace(/^bearer\s+/i, "").trim();
}

function addUniqueToken(tokens: string[], token: string | undefined | null) {
  const cleaned = String(token || "").trim();
  if (cleaned && !tokens.includes(cleaned)) {
    tokens.push(cleaned);
  }
}

async function validateKsolveToken(token: string, cookieHeader: string) {
  const response = await fetch(
    "https://connect.kehe.com/ksolve/services/api/ksolve/list/dcs",
    {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${token}`,
        cookie: cookieHeader,
        origin: "https://connect.kehe.com",
        referer: "https://connect.kehe.com/ksolve/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      },
    }
  );

  if (response.ok) return true;

  console.warn(`K-Solve auth validation returned ${response.status}.`);
  return false;
}

async function validateKsolveCookieSession(cookieHeader: string) {
  const response = await fetch(
    "https://connect.kehe.com/ksolve/services/api/ksolve/list/dcs",
    {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        cookie: cookieHeader,
        origin: "https://connect.kehe.com",
        referer: "https://connect.kehe.com/ksolve/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      },
    }
  );

  if (response.ok) return true;

  console.warn(`K-Solve cookie-session validation returned ${response.status}.`);
  return false;
}

async function getBrowserTokenCandidates(page: Page) {
  return page.evaluate(async () => {
    const tokens: string[] = [];
    const tokenHint = /auth|bearer|token|access|credential|session/i;
    const jwtRegex = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

    function addToken(raw: unknown, hint = "") {
      if (typeof raw !== "string") return;

      const cleaned = raw.trim();
      if (cleaned.length < 20) return;
      if (!jwtRegex.test(cleaned) && !tokenHint.test(hint) && !/^eyJ/.test(cleaned)) {
        return;
      }

      if (!tokens.includes(cleaned)) tokens.push(cleaned);
    }

    function walk(value: unknown, hint = "", depth = 0) {
      if (depth > 5 || value === null || value === undefined) return;

      if (typeof value === "string") {
        addToken(value, hint);

        if (/^[\[{]/.test(value.trim())) {
          try {
            walk(JSON.parse(value), hint, depth + 1);
          } catch {
            // Ignore non-JSON storage values.
          }
        }

        return;
      }

      if (typeof value !== "object") return;

      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${hint}.${index}`, depth + 1));
        return;
      }

      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, hint ? `${hint}.${key}` : key, depth + 1);
      }
    }

    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) || "";
        walk(store.getItem(key), key);
      }
    }

    async function readRequest<T>(request: IDBRequest<T>) {
      return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function readStore(db: IDBDatabase, storeName: string) {
      try {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const valuesRequest = store.getAll();
        const keysRequest = store.getAllKeys();

        const [values, keys] = await Promise.all([
          readRequest(valuesRequest).catch(() => []),
          readRequest(keysRequest).catch(() => []),
        ]);

        values.forEach((value, index) => {
          walk(value, `${db.name}.${storeName}.${String(keys[index] || index)}`);
        });
      } catch {
        // Ignore stores that cannot be read.
      }
    }

    if ("databases" in indexedDB) {
      const databases = await indexedDB.databases().catch(() => []);

      for (const database of databases.slice(0, 20)) {
        if (!database.name) continue;

        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(database.name || "");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        });

        if (!db) continue;

        for (const storeName of Array.from(db.objectStoreNames)) {
          await readStore(db, storeName);
          if (tokens.length >= 50) break;
        }

        db.close();
        if (tokens.length >= 50) break;
      }
    }

    return tokens.slice(0, 50);
  });
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

  let ksolveBearerToken = "";
  let fallbackBearerToken = "";

  page.on("request", (request) => {
    const token = extractBearerToken(request.headers()["authorization"]);

    if (!token) return;

    if (request.url().includes("/ksolve/services/api/")) {
      ksolveBearerToken = token;
    } else {
      fallbackBearerToken = token;
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

    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(
      () => null
    );

    const ksolveApiRequest = page
      .waitForRequest(
        (request) =>
          request.url().includes("/ksolve/services/api/") &&
          Boolean(extractBearerToken(request.headers()["authorization"])),
        { timeout: 20000 }
      )
      .catch(() => null);

    await page.goto("https://connect.kehe.com/ksolve/", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    await ksolveApiRequest;

    await page.waitForTimeout(5000);

    const cookies = await context.cookies();

    const cookieHeader = cookies
      .filter((cookie) => cookie.domain.includes("kehe.com"))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    if (!cookieHeader) {
      throw new Error("Login succeeded, but no KeHE cookies were captured.");
    }

    const storageTokens = await getBrowserTokenCandidates(page);

    const bearerCandidates: string[] = [];
    addUniqueToken(bearerCandidates, ksolveBearerToken);
    for (const token of storageTokens) addUniqueToken(bearerCandidates, token);
    addUniqueToken(bearerCandidates, fallbackBearerToken);

    console.log(`K-Solve auth candidates captured: ${bearerCandidates.length}.`);

    let validatedBearerToken = "";

    for (const token of bearerCandidates) {
      if (await validateKsolveToken(token, cookieHeader)) {
        validatedBearerToken = token;
        break;
      }
    }

    const hasCookieSession = validatedBearerToken
      ? false
      : await validateKsolveCookieSession(cookieHeader);

    if (!validatedBearerToken && !hasCookieSession) {
      throw new Error(
        bearerCandidates.length
          ? "Login succeeded, but K-Solve rejected the captured bearer token and cookie session."
          : "Login succeeded, but no K-Solve bearer token or valid cookie session was captured."
      );
    }

    if (validatedBearerToken) {
      process.env.KSOLVE_BEARER_TOKEN = validatedBearerToken;
    } else {
      delete process.env.KSOLVE_BEARER_TOKEN;
    }

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
