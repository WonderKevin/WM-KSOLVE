import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const DAY_TO_CRON_DAY: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function toUtcCron(day: string, time: string) {
  const cronDay = DAY_TO_CRON_DAY[day.toLowerCase()];

  if (cronDay === undefined) {
    throw new Error("Invalid schedule day.");
  }

  const [hourText, minuteText] = time.split(":");
  const localHour = Number(hourText);
  const localMinute = Number(minuteText);

  if (
    Number.isNaN(localHour) ||
    Number.isNaN(localMinute) ||
    localHour < 0 ||
    localHour > 23 ||
    localMinute < 0 ||
    localMinute > 59
  ) {
    throw new Error("Invalid schedule time.");
  }

  // Eastern Time approximation.
  // During daylight saving time: ET = UTC-4.
  // Example: Saturday 1:00 AM ET = Saturday 5:00 AM UTC.
  const utcHourRaw = localHour + 4;
  const utcHour = utcHourRaw % 24;
  const dayOffset = utcHourRaw >= 24 ? 1 : 0;
  const utcDay = (cronDay + dayOffset) % 7;

  return `${localMinute} ${utcHour} * * ${utcDay}`;
}

function getWorkflowFile({
  workflowName,
  cron,
  includeInvoiceSummary,
  includeInvoiceFiles,
}: {
  workflowName: string;
  cron: string;
  includeInvoiceSummary: boolean;
  includeInvoiceFiles: boolean;
}) {
  return `name: ${workflowName}

on:
  schedule:
    - cron: "${cron}"
  workflow_dispatch:

jobs:
  run-ksolve:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run K-Solve worker
        run: npx tsx scripts/ksolve-worker.ts
        env:
          NEXT_PUBLIC_SUPABASE_URL: \${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_STORAGE_BUCKET: \${{ secrets.SUPABASE_STORAGE_BUCKET }}
          KSOLVE_USERNAME: \${{ secrets.KSOLVE_USERNAME }}
          KSOLVE_PASSWORD: \${{ secrets.KSOLVE_PASSWORD }}
          KSOLVE_INCLUDE_INVOICE_SUMMARY: "${includeInvoiceSummary}"
          KSOLVE_INCLUDE_INVOICE_FILES: "${includeInvoiceFiles}"
`;
}

async function getExistingFileSha({
  owner,
  repo,
  path,
  githubToken,
}: {
  owner: string;
  repo: string;
  path: string;
  githubToken: string;
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Failed reading workflow file (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  return data.sha as string;
}

async function upsertWorkflowFile({
  owner,
  repo,
  path,
  content,
  message,
  githubToken,
}: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  githubToken: string;
}) {
  const sha = await getExistingFileSha({
    owner,
    repo,
    path,
    githubToken,
  });

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: "main",
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Failed updating workflow file (${response.status}): ${errorText}`
    );
  }
}

async function saveScheduleToSupabase({
  scheduleId,
  day,
  time,
  includeInvoiceSummary,
  includeInvoiceFiles,
}: {
  scheduleId: string;
  day: string;
  time: string;
  includeInvoiceSummary: boolean;
  includeInvoiceFiles: boolean;
}) {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("ksolve_schedules").upsert({
    id: scheduleId,
    run_day: day,
    run_time: time,
    include_invoice_summary: includeInvoiceSummary,
    include_invoice_files: includeInvoiceFiles,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed saving schedule: ${error.message}`);
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("ksolve_schedules")
      .select("*");

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      schedules: data || [],
    });
  } catch (error) {
    console.error("K-Solve schedule load failed:", error);

    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed loading schedules.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const day = String(body?.day || "").trim().toLowerCase();
    const time = String(body?.time || "").trim();

    const includeInvoiceSummary = Boolean(body?.includeInvoiceSummary);
    const includeInvoiceFiles = Boolean(body?.includeInvoiceFiles);

    if (!day || !time) {
      return NextResponse.json(
        {
          ok: false,
          message: "Schedule day and time are required.",
        },
        { status: 400 }
      );
    }

    if (!includeInvoiceSummary && !includeInvoiceFiles) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select Invoice Summary or Invoice File.",
        },
        { status: 400 }
      );
    }

    const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
    const owner = process.env.GITHUB_REPO_OWNER || "WonderKevin";
    const repo = process.env.GITHUB_REPO_NAME || "WM-KSOLVE";

    if (!githubToken) {
      return NextResponse.json(
        {
          ok: false,
          message: "Missing GITHUB_ACTIONS_TOKEN.",
        },
        { status: 500 }
      );
    }

    const cron = toUtcCron(day, time);
    const isSummaryOnly = includeInvoiceSummary && !includeInvoiceFiles;

    const scheduleId = isSummaryOnly ? "invoice-summary" : "invoice-file";

    const workflowPath = isSummaryOnly
      ? ".github/workflows/ksolve-invoice-summary.yml"
      : ".github/workflows/ksolve-invoice-file.yml";

    const workflowName = isSummaryOnly
      ? "K-Solve Scheduled Invoice Summary"
      : "K-Solve Scheduled Invoice File";

    const content = getWorkflowFile({
      workflowName,
      cron,
      includeInvoiceSummary,
      includeInvoiceFiles,
    });

    await upsertWorkflowFile({
      owner,
      repo,
      path: workflowPath,
      content,
      message: `Update ${workflowName} schedule`,
      githubToken,
    });

    await saveScheduleToSupabase({
      scheduleId,
      day,
      time,
      includeInvoiceSummary,
      includeInvoiceFiles,
    });

    return NextResponse.json({
      ok: true,
      message: `${workflowName} scheduled for every ${day} at ${time}. It will process the last 7 days ending yesterday.`,
      cron,
      workflowPath,
      schedule: {
        id: scheduleId,
        run_day: day,
        run_time: time,
        include_invoice_summary: includeInvoiceSummary,
        include_invoice_files: includeInvoiceFiles,
      },
    });
  } catch (error) {
    console.error("K-Solve schedule update failed:", error);

    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update K-Solve schedule.",
      },
      { status: 500 }
    );
  }
}