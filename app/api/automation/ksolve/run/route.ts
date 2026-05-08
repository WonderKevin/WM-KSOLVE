import { NextResponse } from "next/server";
import { runKsolveAutomation } from "@/lib/automation/ksolve-download";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { startDate, endDate } = body;

    await runKsolveAutomation({
      startDate,
      endDate,
    });

    return NextResponse.json({
      ok: true,
      message: "K-Solve automation completed.",
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { ok: false, message: "Automation failed." },
      { status: 500 }
    );
  }
}