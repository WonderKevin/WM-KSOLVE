import { NextResponse } from "next/server";
import { runKsolveAutomation } from "@/lib/automation/ksolve-download";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getPreviousMondayToSunday() {
  const today = new Date();
  const day = today.getDay();

  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysSinceMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const previousMonday = new Date(thisMonday);
  previousMonday.setDate(thisMonday.getDate() - 7);

  const previousSunday = new Date(thisMonday);
  previousSunday.setDate(thisMonday.getDate() - 1);

  return {
    startDate: toIsoDate(previousMonday),
    endDate: toIsoDate(previousSunday),
  };
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const { startDate, endDate } = getPreviousMondayToSunday();

    const result = await runKsolveAutomation({
      startDate,
      endDate,
    });

    return NextResponse.json({
      ok: true,
      message: `K-Solve cron completed for previous week: ${startDate} to ${endDate}.`,
      result,
    });
  } catch (error) {
    console.error("K-Solve cron failed:", error);

    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Cron failed.",
      },
      { status: 500 }
    );
  }
}
