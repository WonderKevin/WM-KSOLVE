import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const startDate = String(body?.startDate || "").trim();
    const endDate = String(body?.endDate || "").trim();

    const includeInvoiceSummary = Boolean(body?.includeInvoiceSummary);
    const includeInvoiceFiles = Boolean(body?.includeInvoiceFiles);

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          ok: false,
          message: "Start date and end date are required.",
        },
        { status: 400 }
      );
    }

    const startTime = new Date(`${startDate}T00:00:00`).getTime();
    const endTime = new Date(`${endDate}T00:00:00`).getTime();

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Enter valid start and end dates.",
        },
        { status: 400 }
      );
    }

    if (startTime > endTime) {
      return NextResponse.json(
        {
          ok: false,
          message: "Start date must be before end date.",
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
    const workflowFile = "ksolve-weekly.yml";

    if (!githubToken) {
      return NextResponse.json(
        {
          ok: false,
          message: "Missing GITHUB_ACTIONS_TOKEN.",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            startDate,
            endDate,
            includeInvoiceSummary: String(includeInvoiceSummary),
            includeInvoiceFiles: String(includeInvoiceFiles),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Failed triggering GitHub Action (${response.status}): ${errorText}`
      );
    }

    return NextResponse.json({
      ok: true,
      message: `K-Solve automation was triggered for ${startDate} to ${endDate}. Historical ranges are split into safe K-Solve search batches in GitHub Actions.`,
    });
  } catch (error) {
    console.error("K-Solve manual trigger failed:", error);

    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Manual automation trigger failed.",
      },
      { status: 500 }
    );
  }
}
