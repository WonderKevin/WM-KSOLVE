"use client";

import { supabase } from "@/lib/supabase/client";

type ReportSnapshotRow<T> = {
  payload: T | null;
  updated_at?: string | null;
  version?: number | null;
};

function isMissingSnapshotTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    String(error.message || "").toLowerCase().includes("report_snapshots")
  );
}

export async function readSharedReportSnapshot<T>(reportKey: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("report_snapshots")
    .select("payload, updated_at, version")
    .eq("report_key", reportKey)
    .maybeSingle();

  if (error) {
    if (!isMissingSnapshotTableError(error)) {
      console.error(`Failed to read shared report snapshot ${reportKey}:`, error);
    }
    return null;
  }

  return ((data as ReportSnapshotRow<T> | null)?.payload ?? null) as T | null;
}

export async function writeSharedReportSnapshot<T>(
  reportKey: string,
  payload: T,
  version = 1,
) {
  const { error } = await supabase.from("report_snapshots").upsert(
    {
      report_key: reportKey,
      payload,
      version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "report_key" },
  );

  if (error) {
    if (!isMissingSnapshotTableError(error)) {
      console.error(`Failed to write shared report snapshot ${reportKey}:`, error);
    }
    return false;
  }

  return true;
}
