// app/api/automation/ksolve/run/route.ts

import { NextResponse } from "next/server";
import { runKsolveAutomation } from "@/lib/automation/ksolve-download";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const startDate = String(body?.startDate || "").trim();
    const endDate = String(body?.endDate || "").trim();

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          ok: false,
          message: "Start date and end date are required.",
        },
        { status: 400 }
      );
    }

    const result = await runKsolveAutomation({
      startDate,
      endDate,
    });

    return NextResponse.json({
      ok: true,
      message: `K-Solve automation completed for ${startDate} to ${endDate}.`,
      result,
    });
  } catch (error) {
    console.error("K-Solve automation failed:", error);

    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Automation failed.",
      },
      { status: 500 }
    );
  }
}