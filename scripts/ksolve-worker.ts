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

function isKeheIdentityLoginUrl(url: string) {
  return /connect-identity-server\.kehe\.com\/Account\/Login/i.test(url);
}

function getKsolveValidationHeaders({
  cookieHeader,
  token,
  capturedHeaders = {},
}: {
  cookieHeader: string;
  token?: string;
  capturedHeaders?: Record<string, string>;
}) {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    cookie: cookieHeader,
    origin: "https://connect.kehe.com",
    referer: "https://connect.kehe.com/ksolve/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
  };

  for (const [key, value] of Object.entries(capturedHeaders)) {
    if (value) headers[key.toLowerCase()] = value;
  }

  headers.cookie = cookieHeader;

  if (token) {
    headers.authorization = `bearer ${token}`;
  }

  const xsrfToken = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => /^x(?:srf|csrf)-token=/i.test(part))
    ?.split("=")
    .slice(1)
    .join("=");

  if (xsrfToken && !headers["x-xsrf-token"]) {
    headers["x-xsrf-token"] = decodeURIComponent(xsrfToken);
  }

  return headers;
}

async function validateKsolveToken(
  token: string,
  cookieHeader: string,
  capturedHeaders: Record<string, string>
) {
  const response = await fetch(
    "https://connect.kehe.com/ksolve/services/api/ksolve/list/dcs",
    {
      method: "GET",
      headers: getKsolveValidationHeaders({ cookieHeader, token, capturedHeaders }),
    }
  );

  if (response.ok) return true;

  console.warn(`K-Solve auth validation returned ${response.status}.`);
  return false;
}

async function validateKsolveCookieSession(
  cookieHeader: string,
  capturedHeaders: Record<string, string>
) {
  const response = await fetch(
    "https://connect.kehe.com/ksolve/services/api/ksolve/list/dcs",
    {
      method: "GET",
      headers: getKsolveValidationHeaders({ cookieHeader, capturedHeaders }),
    }
  );

  if (response.ok) return true;

  console.warn(`K-Solve cookie-session validation returned ${response.status}.`);
  return false;
}

async function getBrowserTokenCandidates(page: Page) {
  const browserTokenScript = String.raw`
  (async () => {
    const tokens = [];
    const tokenHint = /auth|bearer|token|access|credential|session/i;
    const jwtRegex = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

    function addToken(raw, hint = "") {
      if (typeof raw !== "string") return;

      const cleaned = raw.trim();
      if (cleaned.length < 20) return;
      if (!jwtRegex.test(cleaned) && !tokenHint.test(hint) && !/^eyJ/.test(cleaned)) {
        return;
      }

      if (!tokens.includes(cleaned)) tokens.push(cleaned);
    }

    function walk(value, hint = "", depth = 0) {
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
        value.forEach((item, index) => walk(item, hint + "." + index, depth + 1));
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        walk(child, hint ? hint + "." + key : key, depth + 1);
      }
    }

    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) || "";
        walk(store.getItem(key), key);
      }
    }

    async function readRequest(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function readStore(db, storeName) {
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
          walk(value, db.name + "." + storeName + "." + String(keys[index] || index));
        });
      } catch {
        // Ignore stores that cannot be read.
      }
    }

    if ("databases" in indexedDB) {
      const databases = await indexedDB.databases().catch(() => []);

      for (const database of databases.slice(0, 20)) {
        if (!database.name) continue;

        const db = await new Promise((resolve) => {
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
  })()
  `;

  return (await page.evaluate(browserTokenScript)) as string[];
}

async function getKsolvePageDiagnostics(page: Page) {
  return page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || "";
    return {
      url: window.location.href,
      title: document.title || "",
      textLength: text.length,
      hasAccessDenied: /access\s*denied|not\s*authorized|authorization\s+has\s+been\s+denied/.test(text),
      hasInvalidCredentials: /invalid|incorrect|failed|try\s+again/.test(text),
      hasLogin: /log\s*in|login|sign\s*in/.test(text),
      hasMfa: /multi-factor|mfa|verification|verify\s+your|authenticator/.test(text),
      hasKsolveText: /k-?solve|invoice|deduction/.test(text),
    };
  });
}

async function probeKsolveInBrowser(page: Page) {
  return page.evaluate(async () => {
    try {
      const response = await fetch("/ksolve/services/api/ksolve/list/dcs", {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*",
        },
      });

      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        contentType: "",
        errorName: error instanceof Error ? error.name : "UnknownError",
      };
    }
  });
}

function getCapturedKsolveHeaders(headers: Record<string, string>) {
  const captured: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const headerName = key.toLowerCase();
    if (!value) continue;
    if (
      headerName === "accept" ||
      headerName === "accept-language" ||
      headerName === "authorization" ||
      headerName === "origin" ||
      headerName === "referer" ||
      headerName === "user-agent" ||
      headerName === "cookie" ||
      headerName.startsWith("sec-ch-") ||
      headerName.startsWith("sec-fetch-") ||
      headerName.startsWith("x-")
    ) {
      captured[headerName] = value;
    }
  }

  return captured;
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
  let capturedKsolveHeaders: Record<string, string> = {};
  const ksolveApiEvents: string[] = [];

  page.on("request", (request) => {
    const token = extractBearerToken(request.headers()["authorization"]);

    if (request.url().includes("/ksolve/services/api/")) {
      capturedKsolveHeaders = getCapturedKsolveHeaders(request.headers());
      if (token) ksolveBearerToken = token;
    } else if (token) {
      fallbackBearerToken = token;
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/ksolve/services/api/")) return;

    const pathname = new URL(url).pathname.replace("/ksolve/services/api", "");
    ksolveApiEvents.push(`${response.status()} ${pathname}`);
    if (ksolveApiEvents.length > 10) ksolveApiEvents.shift();
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

    await Promise.all([
      page
        .waitForURL((url) => !isKeheIdentityLoginUrl(url.href), {
          timeout: 60000,
        })
        .catch(() => null),
      loginButton.click(),
    ]);

    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(
      () => null
    );

    const postLoginDiagnostics = await getKsolvePageDiagnostics(page);
    console.log(
      `KeHE post-login diagnostics: ${JSON.stringify(postLoginDiagnostics)}`
    );

    if (isKeheIdentityLoginUrl(postLoginDiagnostics.url)) {
      throw new Error(
        postLoginDiagnostics.hasMfa
          ? "KeHE login requires MFA or verification before K-Solve automation can run."
          : postLoginDiagnostics.hasInvalidCredentials
            ? "KeHE login was rejected. Update the KSOLVE_USERNAME/KSOLVE_PASSWORD GitHub secrets."
            : "KeHE login did not leave the sign-in page. Check the KSOLVE_USERNAME/KSOLVE_PASSWORD GitHub secrets and any KeHE login prompts."
      );
    }

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
    const cookieNames = cookies
      .filter((cookie) => cookie.domain.includes("kehe.com"))
      .map((cookie) => cookie.name)
      .sort();

    const cookieHeader = cookies
      .filter((cookie) => cookie.domain.includes("kehe.com"))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    if (!cookieHeader) {
      throw new Error("Login succeeded, but no KeHE cookies were captured.");
    }

    const storageTokens = await getBrowserTokenCandidates(page);
    const pageDiagnostics = await getKsolvePageDiagnostics(page);
    const browserProbe = await probeKsolveInBrowser(page);

    const bearerCandidates: string[] = [];
    addUniqueToken(bearerCandidates, ksolveBearerToken);
    for (const token of storageTokens) addUniqueToken(bearerCandidates, token);
    addUniqueToken(bearerCandidates, fallbackBearerToken);

    console.log(
      `K-Solve page diagnostics: ${JSON.stringify(pageDiagnostics)}`
    );
    console.log(
      `K-Solve browser probe: ${JSON.stringify(browserProbe)}`
    );
    console.log(
      `K-Solve API events: ${ksolveApiEvents.length ? ksolveApiEvents.join(", ") : "none"}`
    );
    console.log(
      `KeHE cookie names captured: ${cookieNames.length ? cookieNames.join(", ") : "none"}`
    );
    console.log(
      `Captured K-Solve header names: ${
        Object.keys(capturedKsolveHeaders).length
          ? Object.keys(capturedKsolveHeaders).sort().join(", ")
          : "none"
      }`
    );
    console.log(`K-Solve auth candidates captured: ${bearerCandidates.length}.`);

    let validatedBearerToken = "";

    for (const token of bearerCandidates) {
      if (await validateKsolveToken(token, cookieHeader, capturedKsolveHeaders)) {
        validatedBearerToken = token;
        break;
      }
    }

    const hasCookieSession = validatedBearerToken
      ? false
      : await validateKsolveCookieSession(cookieHeader, capturedKsolveHeaders);

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

    if (Object.keys(capturedKsolveHeaders).length) {
      process.env.KSOLVE_CAPTURED_HEADERS = JSON.stringify(capturedKsolveHeaders);
    } else {
      delete process.env.KSOLVE_CAPTURED_HEADERS;
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
