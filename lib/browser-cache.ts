"use client";

type BrowserCacheEntry<T> = {
  savedAt: string;
  data: T;
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

export function writeBrowserCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;

  try {
    const entry: BrowserCacheEntry<T> = {
      savedAt: new Date().toISOString(),
      data,
    };

    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Browser storage is best-effort. Fresh Supabase data still loads normally.
  }
}
