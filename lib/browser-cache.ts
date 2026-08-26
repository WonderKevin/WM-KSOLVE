"use client";

import { getSharedReportKeyForBrowserCache } from "@/lib/report-cache-registry";
import { writeSharedReportSnapshot } from "@/lib/report-snapshots";

type BrowserCacheEntry<T> = {
  savedAt: string;
  data: T;
};

type WriteBrowserCacheOptions = {
  mirrorShared?: boolean;
};

export function readBrowserCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as BrowserCacheEntry<T>;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserCache<T>(
  key: string,
  data: T,
  options: WriteBrowserCacheOptions = {}
) {
  if (typeof window === "undefined") return;

  try {
    const entry: BrowserCacheEntry<T> = {
      savedAt: new Date().toISOString(),
      data,
    };

    window.localStorage.setItem(key, JSON.stringify(entry));

    if (options.mirrorShared !== false) {
      const reportKey = getSharedReportKeyForBrowserCache(key);

      if (reportKey) {
        void writeSharedReportSnapshot<T>(reportKey, data, 1);
      }
    }
  } catch {
    // Browser storage is best-effort. Fresh Supabase data still loads normally.
  }
}
