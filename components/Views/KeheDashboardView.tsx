"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TabKey = "analytics" | "velocity" | "pullout";
type FillRateSubTabKey = "retailer" | "area";
type VelocitySubTabKey =
  | "best-selling-store"
  | "total-cases-per-month"
  | "overall-average-cakes-per-week";
type PulloutSubTabKey = "by-retailer-area" | "by-retailer-store" | "by-dc";
type PeriodMode = "lastMonth" | "custom" | "past6Months" | "past12Months";
type AnalyticsDateMode = "thisMonth" | "lastMonth" | "past6Months" | "custom";
type TopN = 5 | 10 | 15 | 20;
type AnalyticsSection =
  | "summary"
  | "pull-rate"
  | "fill-rate"
  | "win-back"
  | "declining";

type VelocityRow = {
  id?: string;
  month: string;
  retailer_area: string;
  customer: string;
  upc: string;
  description: string;
  cases: number;
  eaches: number;
  retailer: string;
  fill_rate?: number | string | null;
  source_file_name?: string;
  period_type?: "monthly" | "weekly" | string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
};

type LocationRow = {
  customer?: unknown;
  retailer_name?: unknown;
  location_name?: unknown;
  retailer_area?: unknown;
  area?: unknown;
  region?: unknown;
  dc?: unknown;
  distribution_center?: unknown;
};

type LocationDcEntry = {
  customer: string;
  retailerArea: string;
  dc: string;
  storeCode: string;
};

type LocationDcLookup = {
  exact: Map<string, string>;
  entries: LocationDcEntry[];
};

type FillRatePeriodColumn = {
  key: string;
  label: string;
  month?: string;
  kind: "month" | "past-weeks" | "last-week" | "mtd";
};

type FillRatePeriodStats = {
  sum: number;
  count: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeMonthLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/['`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeLocationMatch(value: unknown) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[#]/g, "")
    .replace(/[-_/(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function compactLocationMatch(value: unknown) {
  return normalizeLocationMatch(value).replace(/\s+/g, "");
}
function locationTextLooksLikeMatch(a: unknown, b: unknown) {
  const normalizedA = normalizeLocationMatch(a);
  const normalizedB = normalizeLocationMatch(b);
  const compactA = compactLocationMatch(a);
  const compactB = compactLocationMatch(b);

  if (!normalizedA || !normalizedB) return false;

  return (
    normalizedA === normalizedB ||
    compactA === compactB ||
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA) ||
    compactA.includes(compactB) ||
    compactB.includes(compactA)
  );
}
function getLocationStoreCode(value: unknown) {
  const match = normalizeLocationMatch(value).match(/\b0*(\d{2,5})\b/);
  return match?.[1] || "";
}
function getLocationKey(customer: unknown, retailerArea: unknown) {
  const normalizedCustomer = normalizeLocationMatch(customer);
  const normalizedArea = normalizeLocationMatch(retailerArea);
  return normalizedCustomer && normalizedArea
    ? `${normalizedArea}__${normalizedCustomer}`
    : "";
}
function getLocationCustomer(row: LocationRow) {
  return row.customer || row.retailer_name || row.location_name || "";
}
function getLocationArea(row: LocationRow) {
  return row.retailer_area || row.area || row.region || "";
}
function getLocationDc(row: LocationRow) {
  return String(row.dc || row.distribution_center || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function getDcForVelocityRow(row: VelocityRow, locationDcLookup: LocationDcLookup) {
  const key = getLocationKey(row.customer, row.retailer_area);
  const exactDc = key ? locationDcLookup.exact.get(key) : "";
  if (exactDc) return exactDc;

  const fuzzyMatch = locationDcLookup.entries.find(
    (entry) =>
      locationTextLooksLikeMatch(row.customer, entry.customer) &&
      locationTextLooksLikeMatch(row.retailer_area, entry.retailerArea),
  );
  if (fuzzyMatch) return fuzzyMatch.dc;

  const storeCode = getLocationStoreCode(row.customer);
  const storeCodeMatch = storeCode
    ? locationDcLookup.entries.find(
        (entry) =>
          entry.storeCode === storeCode &&
          locationTextLooksLikeMatch(row.retailer_area, entry.retailerArea),
      )
    : null;

  return storeCodeMatch?.dc || "Unassigned DC";
}
function getCakeSeriesName(d: string) {
  return String(d || "")
    .replace(/\u00a0/g, " ")
    .trim();
}
function getCakeSortWeight(d: string) {
  const t = getCakeSeriesName(d).toUpperCase();
  if (t.startsWith("NSA")) return 1;
  if (t.startsWith("HP")) return 2;
  return 99;
}
function getMonthSortValue(value: string) {
  const m = normalizeMonthLabel(value).match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!m) return -Infinity;
  const idx = new Date(`${m[1]} 1, 2000`).getMonth();
  if (Number.isNaN(idx)) return -Infinity;
  return (2000 + Number(m[2])) * 100 + (idx + 1);
}
function compareMonthLabelsAsc(a: string, b: string) {
  return getMonthSortValue(a) - getMonthSortValue(b);
}
function monthLabelFromDate(date: Date) {
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(date.getFullYear()).slice(-2)}`;
}
function getCurrentMonthInputValue() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function getCurrentMonthLabel() {
  const n = new Date();
  return monthLabelFromDate(new Date(n.getFullYear(), n.getMonth(), 1));
}
function getLastMonthInputValue() {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function getPastMonthsInputValue(back: number) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function getLastMonthLabel() {
  const n = new Date();
  return monthLabelFromDate(new Date(n.getFullYear(), n.getMonth() - 1, 1));
}
function buildMonthRange(from: string, to: string) {
  const result: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return result;
  let c = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm - 1, 1);
  while (c <= end) {
    result.push(monthLabelFromDate(c));
    c = new Date(c.getFullYear(), c.getMonth() + 1, 1);
  }
  return result;
}
function buildPastNMonthsRange(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) =>
    monthLabelFromDate(
      new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1),
    ),
  );
}
function truncateLabel(value: string, max = 42) {
  const t = String(value || "");
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function getRetailerChartColor(name: string, index: number) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  const fixed: Record<string, string> = {
    kroger: "#123f73",
    "fresh thyme": "#f59e0b",
    "infra & others": "#60c7df",
    heb: "#16a34a",
  };

  if (fixed[normalized]) return fixed[normalized];

  const palette = [
    "#7c3aed",
    "#10b981",
    "#ef4444",
    "#8b5cf6",
    "#14b8a6",
    "#f97316",
    "#3b82f6",
    "#a855f7",
    "#22c55e",
    "#eab308",
  ];

  return palette[index % palette.length];
}

function sortRetailersForChart(a: string, b: string) {
  const preferred = ["Kroger", "Fresh Thyme", "INFRA & Others", "HEB"];
  const ai = preferred.findIndex(
    (p) =>
      p.toLowerCase() ===
      String(a || "")
        .trim()
        .toLowerCase(),
  );
  const bi = preferred.findIndex(
    (p) =>
      p.toLowerCase() ===
      String(b || "")
        .trim()
        .toLowerCase(),
  );

  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }

  return String(a || "").localeCompare(String(b || ""));
}

function parseFillRateValue(value: VelocityRow["fill_rate"]) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) <= 1 ? value * 100 : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const hasPercentSign = raw.includes("%");
  const parsed = Number(raw.replace(/[%,$,]/g, "").trim());
  if (Number.isNaN(parsed)) return null;

  return !hasPercentSign && Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function formatFillRate(value: number | null) {
  if (value === null) return "N/A";
  return `${value.toFixed(2)}%`;
}

function getFillRateTone(value: number | null) {
  if (value === null) return "text-slate-400";
  if (value >= 95) return "text-emerald-700";
  if (value >= 80) return "text-amber-700";
  return "text-red-700";
}

function averageFillRate(sum: number, count: number) {
  return count > 0 ? sum / count : null;
}

function formatDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function parseIsoDateOnly(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateFromMonthLabel(value: string) {
  const match = normalizeMonthLabel(value).match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!match) return null;
  const monthIndex = new Date(`${match[1]} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return null;
  return new Date(2000 + Number(match[2]), monthIndex, 1);
}

function getWeeklyRangeKey(row: VelocityRow) {
  const start = parseIsoDateOnly(row.period_start_date);
  const end = parseIsoDateOnly(row.period_end_date);
  if (!start || !end) return "";
  return `${formatDateInputValue(start)}|${formatDateInputValue(end)}`;
}

function getFillRateWeeklyRanges(rows: VelocityRow[] | undefined, referenceMonth: string) {
  const ranges = new Map<string, { key: string; start: string; end: string }>();

  for (const row of rows ?? []) {
    if (String(row.period_type || "").toLowerCase() !== "weekly") continue;
    if (normalizeMonthLabel(row.month) !== referenceMonth) continue;

    const key = getWeeklyRangeKey(row);
    if (!key || ranges.has(key)) continue;

    const [start, end] = key.split("|");
    ranges.set(key, { key, start, end });
  }

  return Array.from(ranges.values()).sort((a, b) => {
    const endCompare = a.end.localeCompare(b.end);
    if (endCompare !== 0) return endCompare;
    return a.start.localeCompare(b.start);
  });
}

function buildFillRatePeriodConfig(
  rows: VelocityRow[] | undefined,
  referenceMonth: string,
  analyticsDateMode: AnalyticsDateMode,
) {
  const referenceMonthNorm = normalizeMonthLabel(referenceMonth);
  const isCurrentMonth =
    analyticsDateMode === "thisMonth" &&
    referenceMonthNorm === normalizeMonthLabel(getCurrentMonthLabel());

  if (isCurrentMonth) {
    const weeklyRanges = getFillRateWeeklyRanges(rows, referenceMonthNorm);
    const columns: FillRatePeriodColumn[] = [];

    const pastWeeksCount = weeklyRanges.length - 1;
    if (pastWeeksCount >= 1) {
      columns.push({
        key: "past-weeks",
        label: `Past ${pastWeeksCount} Week${pastWeeksCount === 1 ? "" : "s"}`,
        kind: "past-weeks",
      });
    }

    columns.push(
      {
        key: "last-week",
        label: "Last Week",
        kind: "last-week",
      },
      {
        key: "mtd",
        label: "MTD",
        kind: "mtd",
      },
    );

    return {
      periodColumns: columns,
      isCurrentMonth,
      includePastWeeks: weeklyRanges.length >= 2,
      latestWeeklyRangeKey: weeklyRanges[weeklyRanges.length - 1]?.key ?? "",
      referenceMonth: referenceMonthNorm,
    };
  }

  const referenceDate =
    getDateFromMonthLabel(referenceMonthNorm) ??
    getDateFromMonthLabel(getLastMonthLabel()) ??
    new Date();
  const periodColumns = [2, 1, 0].map((monthsBack) => {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() - monthsBack,
      1,
    );
    const month = monthLabelFromDate(date);
    return {
      key: month,
      label: month.replace(/ '\d{2}$/, ""),
      month,
      kind: "month" as const,
    };
  });

  return {
    periodColumns,
    isCurrentMonth,
    includePastWeeks: false,
    latestWeeklyRangeKey: "",
    referenceMonth: referenceMonthNorm,
  };
}

function addFillRatePeriodStat(
  periods: Map<string, FillRatePeriodStats>,
  key: string,
  fillRate: number,
) {
  if (!periods.has(key)) {
    periods.set(key, { sum: 0, count: 0 });
  }
  const stats = periods.get(key)!;
  stats.sum += fillRate;
  stats.count += 1;
}

function getFillRatePeriodValue(
  periods: Map<string, FillRatePeriodStats>,
  key: string,
) {
  const stats = periods.get(key);
  return stats ? averageFillRate(stats.sum, stats.count) ?? 0 : 0;
}

function getFillRatePeriodKeys(row: VelocityRow, monthKeys: Map<string, string[]>) {
  return monthKeys.get(normalizeMonthLabel(row.month)) ?? [];
}

function getCurrentMonthFillRatePeriodKeys(
  row: VelocityRow,
  config: ReturnType<typeof buildFillRatePeriodConfig>,
) {
  if (normalizeMonthLabel(row.month) !== config.referenceMonth) return [];

  const keys: string[] = [];
  const isWeekly = String(row.period_type || "").toLowerCase() === "weekly";

  if (isWeekly) {
    const rangeKey = getWeeklyRangeKey(row);
    if (
      config.includePastWeeks &&
      rangeKey &&
      rangeKey !== config.latestWeeklyRangeKey
    ) {
      keys.push("past-weeks");
    }

    if (rangeKey && rangeKey === config.latestWeeklyRangeKey) {
      keys.push("last-week");
    }
  }

  keys.push("mtd");
  return keys;
}

function buildFillRateSummaries(
  rows: VelocityRow[] | undefined,
  referenceMonth: string,
  analyticsDateMode: AnalyticsDateMode,
) {
  const periodConfig = buildFillRatePeriodConfig(
    rows,
    referenceMonth,
    analyticsDateMode,
  );
  const { periodColumns } = periodConfig;
  const periodKeysByMonth = new Map<string, string[]>();

  for (const column of periodColumns) {
    if (!column.month) continue;
    const month = normalizeMonthLabel(column.month);
    periodKeysByMonth.set(month, [...(periodKeysByMonth.get(month) ?? []), column.key]);
  }

  const retailerMap = new Map<
    string,
    { retailer: string; periods: Map<string, FillRatePeriodStats> }
  >();
  const areaMap = new Map<
    string,
    {
      retailer: string;
      area: string;
      periods: Map<string, FillRatePeriodStats>;
      stores: Map<string, { customer: string; periods: Map<string, FillRatePeriodStats> }>;
    }
  >();
  let totalSum = 0;
  let totalCount = 0;
  const referenceMonthNorm = normalizeMonthLabel(referenceMonth);

  for (const row of rows ?? []) {
    const rowMonth = normalizeMonthLabel(row.month);
    const fillRate = parseFillRateValue(row.fill_rate);
    if (fillRate === null) continue;

    if (referenceMonthNorm && rowMonth === referenceMonthNorm) {
      totalSum += fillRate;
      totalCount += 1;
    }

    const periodKeys = periodConfig.isCurrentMonth
      ? getCurrentMonthFillRatePeriodKeys(row, periodConfig)
      : getFillRatePeriodKeys(row, periodKeysByMonth);
    if (!periodKeys.length) continue;

    const retailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
    const area = String(row.retailer_area || "").replace(/\u00a0/g, " ").trim();
    const customer = String(row.customer || "").replace(/\u00a0/g, " ").trim();
    if (!retailer) continue;

    if (!retailerMap.has(retailer)) {
      retailerMap.set(retailer, { retailer, periods: new Map() });
    }
    const retailerEntry = retailerMap.get(retailer)!;
    for (const key of periodKeys) {
      addFillRatePeriodStat(retailerEntry.periods, key, fillRate);
    }

    if (area) {
      const areaKey = `${retailer}||${area}`;
      if (!areaMap.has(areaKey)) {
        areaMap.set(areaKey, {
          retailer,
          area,
          periods: new Map(),
          stores: new Map(),
        });
      }
      const areaEntry = areaMap.get(areaKey)!;
      for (const key of periodKeys) {
        addFillRatePeriodStat(areaEntry.periods, key, fillRate);
      }

      if (customer) {
        if (!areaEntry.stores.has(customer)) {
          areaEntry.stores.set(customer, { customer, periods: new Map() });
        }
        const storeEntry = areaEntry.stores.get(customer)!;
        for (const key of periodKeys) {
          addFillRatePeriodStat(storeEntry.periods, key, fillRate);
        }
      }
    }
  }

  return {
    periodColumns,
    overall: averageFillRate(totalSum, totalCount),
    retailerRows: Array.from(retailerMap.values())
      .map((row) => ({
        retailer: row.retailer,
        fillRates: Object.fromEntries(
          periodColumns.map((column) => [
            column.key,
            getFillRatePeriodValue(row.periods, column.key),
          ]),
        ) as Record<string, number>,
      }))
      .sort((a, b) => sortRetailersForChart(a.retailer, b.retailer)),
    areaRows: Array.from(areaMap.values())
      .map((row) => ({
        retailer: row.retailer,
        area: row.area,
        fillRates: Object.fromEntries(
          periodColumns.map((column) => [
            column.key,
            getFillRatePeriodValue(row.periods, column.key),
          ]),
        ) as Record<string, number>,
        stores: Array.from(row.stores.values())
          .map((store) => ({
            customer: store.customer,
            fillRates: Object.fromEntries(
              periodColumns.map((column) => [
                column.key,
                getFillRatePeriodValue(store.periods, column.key),
              ]),
            ) as Record<string, number>,
          }))
          .sort((a, b) => a.customer.localeCompare(b.customer)),
      }))
      .sort((a, b) => {
        const retailerCompare = sortRetailersForChart(a.retailer, b.retailer);
        if (retailerCompare !== 0) return retailerCompare;
        return a.area.localeCompare(b.area);
      }),
  };
}

function formatSelectedCustomers(selected: string[]) {
  if (!selected.length) return "All Customers";
  if (selected.length === 1) return selected[0];
  return `${selected.length} customers selected`;
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportToExcel({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return s.search(/[",\n]/) >= 0 ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ];
  const blob = new Blob([lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Searchable dropdown (Excel-style multi-select) ─────────────────────────────
function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
  allLabel = "All Customers",
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const nonAll = useMemo(
    () => options.filter((o) => o !== allLabel),
    [options, allLabel],
  );
  const filtered = useMemo(
    () => nonAll.filter((o) => o.toLowerCase().includes(query.toLowerCase())),
    [nonAll, query],
  );

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const isAll = value.length === 0;
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((opt) => selectedSet.has(opt));

  const toggleOne = (opt: string) => {
    if (selectedSet.has(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const selectFiltered = () => {
    const merged = new Set(value);
    filtered.forEach((opt) => merged.add(opt));
    onChange(Array.from(merged));
  };

  const clearFiltered = () => {
    const filteredSet = new Set(filtered);
    onChange(value.filter((v) => !filteredSet.has(v)));
  };

  return (
    <div ref={ref} className="relative min-w-[220px]">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 outline-none flex items-center justify-between gap-2 hover:border-slate-300 transition"
      >
        <span className="truncate">{formatSelectedCustomers(value)}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>

          <div className="border-b border-slate-100">
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setOpen(false);
                setQuery("");
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold hover:bg-slate-50 transition text-slate-800"
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isAll ? "border-slate-800 bg-slate-800" : "border-slate-300"}`}
              >
                {isAll && (
                  <svg
                    className="h-3 w-3 text-white"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2 6l3 3 5-5"
                    />
                  </svg>
                )}
              </span>
              (Select All Customers)
            </button>

            {query && filtered.length > 0 && (
              <button
                type="button"
                onClick={allFilteredSelected ? clearFiltered : selectFiltered}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold hover:bg-slate-50 transition text-slate-800"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${allFilteredSelected ? "border-slate-800 bg-slate-800" : "border-slate-300"}`}
                >
                  {allFilteredSelected && (
                    <svg
                      className="h-3 w-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2 6l3 3 5-5"
                      />
                    </svg>
                  )}
                </span>
                {allFilteredSelected
                  ? `Clear all matching "${query}"`
                  : `Select all matching "${query}"`}
              </button>
            )}
          </div>

          {value.length > 0 && (
            <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
              {value.length} selected
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">No results</div>
            ) : (
              filtered.map((opt) => {
                const sel = selectedSet.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleOne(opt)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 text-slate-700"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${sel ? "border-slate-800 bg-slate-800" : "border-slate-300"}`}
                    >
                      {sel && (
                        <svg
                          className="h-3 w-3 text-white"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2 6l3 3 5-5"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────
function SearchBar({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-[220px] flex-1 max-w-xs">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-slate-400 transition"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────
function GroupedMonthlyChart({
  title,
  months,
  series,
}: {
  title: string;
  months: string[];
  series: { name: string; values: number[]; fill: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(980);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(Math.max(w, 400));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const cH = 360;
  const cW = containerWidth;
  const lP = 55,
    rP = 20,
    tP = 20,
    bP = 95;
  const iW = cW - lP - rP,
    iH = cH - tP - bP;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gW = months.length > 0 ? iW / months.length : iW;
  const bGap = 4,
    gPad = 8;
  const bW = Math.max(
    10,
    (gW - gPad * 2 - bGap * Math.max(series.length - 1, 0)) /
      Math.max(series.length, 1),
  );
  const ticks = Array.from({ length: 5 }, (_, i) => ({
    value: Math.round((max / 4) * i),
    y: tP + iH - (iH / 4) * i,
  }));
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg width={cW} height={cH} style={{ display: "block", width: "100%" }}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={lP}
                y1={t.y}
                x2={cW - rP}
                y2={t.y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={lP - 10}
                y={t.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
              >
                {t.value}
              </text>
            </g>
          ))}
          <line
            x1={lP}
            y1={tP + iH}
            x2={cW - rP}
            y2={tP + iH}
            stroke="#94a3b8"
            strokeWidth="1.5"
          />
          {months.map((month, mi) => {
            const gX = lP + mi * gW + gPad;
            return (
              <g key={month}>
                {series.map((item, si) => {
                  const v = item.values[mi] || 0;
                  const bH = (v / max) * iH;
                  const x = gX + si * (bW + bGap);
                  const y = tP + iH - bH;
                  return (
                    <g key={`${month}-${item.name}`}>
                      <rect
                        x={x}
                        y={y}
                        width={bW}
                        height={bH}
                        rx="3"
                        fill={item.fill}
                      />
                      <text
                        x={x + bW / 2}
                        y={y - 6}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill={item.fill}
                      >
                        {v}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={lP + mi * gW + gW / 2}
                  y={tP + iH + 18}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#334155"
                >
                  {month.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        {series.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-2 text-sm text-slate-600"
          >
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: item.fill }}
            />
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarChart({
  data,
  title,
  minWidth = 1100,
  labelWidth = 360,
}: {
  data: { label: string; value: number }[];
  title: string;
  minWidth?: number;
  labelWidth?: number;
}) {
  const rH = 42,
    tP = 20,
    bP = 20,
    cW = minWidth;
  const iW = cW - labelWidth - 40;
  const cH = Math.max(320, tP + bP + data.length * rH);
  const max = Math.max(...data.map((d) => d.value), 1);
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i));
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <svg width={cW} height={cH} style={{ minWidth: `${minWidth}px` }}>
          {ticks.map((tick, i) => {
            const x = labelWidth + (tick / max) * iW;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={tP}
                  x2={x}
                  y2={cH - bP}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={tP - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748b"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          {data.map((item, i) => {
            const y = tP + i * rH;
            const bW = (item.value / max) * iW;
            return (
              <g key={`${item.label}-${i}`}>
                <text
                  x={labelWidth - 12}
                  y={y + 16}
                  textAnchor="end"
                  fontSize="12"
                  fill="#334155"
                >
                  {truncateLabel(item.label, 44)}
                  <title>{item.label}</title>
                </text>
                <rect
                  x={labelWidth}
                  y={y}
                  width={bW}
                  height={24}
                  rx="4"
                  fill="#4a83e7"
                />
                <text
                  x={labelWidth + bW + 8}
                  y={y + 16}
                  fontSize="12"
                  fontWeight="700"
                  fill="#2563eb"
                >
                  {item.value}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Analytics helpers ─────────────────────────────────────────────────────────
function buildAnalyticsContext(
  rows: VelocityRow[],
  analyticsLastMonth?: string,
) {
  if (!rows.length) return null;

  const allMonths = Array.from(
    new Set(rows.map((r) => normalizeMonthLabel(r.month))),
  ).sort(compareMonthLabelsAsc);
  // if a specific last month is chosen, slice up to and including it
  const effectiveMonths = analyticsLastMonth
    ? allMonths.filter(
        (m) => getMonthSortValue(m) <= getMonthSortValue(analyticsLastMonth),
      )
    : allMonths;
  const recentMonths = effectiveMonths.slice(-6);
  const lastMonth = effectiveMonths[effectiveMonths.length - 1] ?? "";
  const prevMonth = effectiveMonths[effectiveMonths.length - 2] ?? "";

  const storeMap = new Map<
    string,
    {
      retailer: string;
      retailerArea: string;
      customer: string;
      monthCases: Record<string, number>;
      total: number;
    }
  >();
  for (const row of rows) {
    const key = `${String(row.retailer || "").trim()}||${String(row.retailer_area || "").trim()}||${String(row.customer || "").trim()}`;
    const month = normalizeMonthLabel(row.month);
    if (!storeMap.has(key))
      storeMap.set(key, {
        retailer: String(row.retailer || "").trim(),
        retailerArea: String(row.retailer_area || "").trim(),
        customer: String(row.customer || "").trim(),
        monthCases: {},
        total: 0,
      });
    const entry = storeMap.get(key)!;
    entry.monthCases[month] =
      (entry.monthCases[month] || 0) + Number(row.cases || 0);
    entry.total += Number(row.cases || 0);
  }
  const stores = Array.from(storeMap.values());

  const areaMap = new Map<
    string,
    { retailer: string; area: string; stores: typeof stores }
  >();
  for (const s of stores) {
    const key = `${s.retailer}||${s.retailerArea}`;
    if (!areaMap.has(key))
      areaMap.set(key, {
        retailer: s.retailer,
        area: s.retailerArea,
        stores: [],
      });
    areaMap.get(key)!.stores.push(s);
  }

  // Compute how many consecutive months a store has been inactive (from lastMonth backwards)
  function getInactiveMonthCount(s: (typeof stores)[0]) {
    let count = 0;
    for (let i = effectiveMonths.length - 1; i >= 0; i--) {
      if ((s.monthCases[effectiveMonths[i]] || 0) === 0) count++;
      else break;
    }
    return count;
  }

  const areaSummaries = Array.from(areaMap.values())
    .map(({ retailer, area, stores: aStores }) => {
      const total = aStores.length;
      const activeLastMonth = aStores.filter(
        (s) => (s.monthCases[lastMonth] || 0) > 0,
      ).length;
      const inactiveLastMonth = total - activeLastMonth;
      const inactive3Plus = aStores.filter((s) => {
        const last3 = recentMonths.slice(-3);
        return last3.every((m) => (s.monthCases[m] || 0) === 0) && s.total > 0;
      });
      const areaCases = aStores.reduce((sum, s) => sum + s.total, 0);
      const lastMonthCases = aStores.reduce(
        (sum, s) => sum + (s.monthCases[lastMonth] || 0),
        0,
      );
      const prevMonthCases = aStores.reduce(
        (sum, s) => sum + (s.monthCases[prevMonth] || 0),
        0,
      );
      // stores sorted: inactive first, then by cases desc
      const sortedStores = [...aStores].sort((a, b) => {
        const aActive = (a.monthCases[lastMonth] || 0) > 0 ? 1 : 0;
        const bActive = (b.monthCases[lastMonth] || 0) > 0 ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive; // inactive first
        return b.total - a.total;
      });
      return {
        retailer,
        area,
        total,
        activeLastMonth,
        inactiveLastMonth,
        inactive3Plus: inactive3Plus.length,
        areaCases,
        lastMonthCases,
        prevMonthCases,
        sortedStores,
      };
    })
    .sort((a, b) => b.lastMonthCases - a.lastMonthCases); // sort by last month cases

  const winBackCandidates = stores
    .filter((s) => {
      const last3 = recentMonths.slice(-3);
      const hasOlderVolume = Object.entries(s.monthCases).some(
        ([m, v]) => !last3.includes(m) && v > 0,
      );
      const zeroLast3 = last3.every((m) => (s.monthCases[m] || 0) === 0);
      return hasOlderVolume && zeroLast3;
    })
    .sort((a, b) => b.total - a.total);

  const decliningStores = stores
    .filter((s) => {
      if (!lastMonth) return false;

      const referenceMonthIndex = effectiveMonths.indexOf(lastMonth);
      if (referenceMonthIndex < 3) return false;

      const prior3Months = effectiveMonths.slice(
        referenceMonthIndex - 3,
        referenceMonthIndex,
      );
      const prior3Average =
        prior3Months.reduce((sum, month) => sum + (s.monthCases[month] || 0), 0) /
        3;
      const referenceMonthCases = s.monthCases[lastMonth] || 0;

      return prior3Average > 0 && referenceMonthCases <= prior3Average * 0.5;
    })
    .sort((a, b) => {
      const referenceMonthIndex = effectiveMonths.indexOf(lastMonth);
      const prior3Months =
        referenceMonthIndex >= 3
          ? effectiveMonths.slice(referenceMonthIndex - 3, referenceMonthIndex)
          : [];

      const aPrior3Average = prior3Months.length
        ? prior3Months.reduce((sum, month) => sum + (a.monthCases[month] || 0), 0) /
          prior3Months.length
        : 0;
      const bPrior3Average = prior3Months.length
        ? prior3Months.reduce((sum, month) => sum + (b.monthCases[month] || 0), 0) /
          prior3Months.length
        : 0;

      const aDrop = aPrior3Average - (a.monthCases[lastMonth] || 0);
      const bDrop = bPrior3Average - (b.monthCases[lastMonth] || 0);

      return bDrop - aDrop;
    });

  const topLastMonth = stores
    .filter((s) => (s.monthCases[lastMonth] || 0) > 0)
    .sort(
      (a, b) => (b.monthCases[lastMonth] || 0) - (a.monthCases[lastMonth] || 0),
    )
    .slice(0, 10);

  const retailerMap = new Map<string, number>();
  for (const row of rows) {
    const r = String(row.retailer || "").trim();
    retailerMap.set(r, (retailerMap.get(r) || 0) + Number(row.cases || 0));
  }
  const retailerTotals = Array.from(retailerMap.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  return {
    allMonths,
    effectiveMonths,
    recentMonths,
    lastMonth,
    prevMonth,
    areaSummaries,
    winBackCandidates,
    decliningStores,
    topLastMonth,
    retailerTotals,
    totalStores: stores.length,
    stores,
    getInactiveMonthCount,
  };
}


function getPrior3Months(ctx: NonNullable<ReturnType<typeof buildAnalyticsContext>>) {
  const referenceIndex = ctx.effectiveMonths.indexOf(ctx.lastMonth);
  if (referenceIndex < 3) return [];
  return ctx.effectiveMonths.slice(referenceIndex - 3, referenceIndex);
}

function getPrior3AverageForStore(
  store: {
    monthCases: Record<string, number>;
  },
  ctx: NonNullable<ReturnType<typeof buildAnalyticsContext>>,
) {
  const prior3 = getPrior3Months(ctx);
  if (!prior3.length) return 0;
  const total = prior3.reduce((sum, month) => sum + (store.monthCases[month] || 0), 0);
  return Math.round(total / prior3.length);
}

function getPrior3AverageLabel(ctx: NonNullable<ReturnType<typeof buildAnalyticsContext>>) {
  const prior3 = getPrior3Months(ctx);
  if (!prior3.length) return "Average past 3 months";
  return `Average past 3 months (${prior3.join(", ")})`;
}

function buildAIPrompt(
  ctx: NonNullable<ReturnType<typeof buildAnalyticsContext>>,
  distributor: string,
) {
  const top5areas = ctx.areaSummaries.slice(0, 5);
  const top5winback = ctx.winBackCandidates.slice(0, 5);
  const top5declining = ctx.decliningStores.slice(0, 5);
  return `You are a senior CPG sales analyst reviewing distributor velocity and pullout data for ${distributor}.

DATA SUMMARY (last 6 months: ${ctx.recentMonths.join(", ")}):

RETAILER TOTALS (cases):
${ctx.retailerTotals.map(([r, c]) => `- ${r}: ${c} cases`).join("\n")}

TOP RETAILER AREAS (by last month cases):
${top5areas.map((a) => `- ${a.retailer} / ${a.area}: ${a.total} stores, ${a.activeLastMonth} pulled last month (${a.inactiveLastMonth} inactive), ${a.inactive3Plus} gone 3+ months, ${a.lastMonthCases} cases last month`).join("\n")}

TOP ACTIVE STORES LAST MONTH (${ctx.lastMonth}):
${ctx.topLastMonth
  .slice(0, 5)
  .map(
    (s) =>
      `- ${s.customer} (${s.retailerArea}): ${s.monthCases[ctx.lastMonth]} cases`,
  )
  .join("\n")}

WIN-BACK CANDIDATES (had volume, zero last 3 months):
${top5winback.map((s) => `- ${s.customer} (${s.retailer} / ${s.retailerArea}): ${s.total} total cases historically, last 3 months = 0`).join("\n") || "None found"}

DECLINING STORES:
${top5declining.map((s) => `- ${s.customer} (${s.retailerArea}): ${s.total} total cases`).join("\n") || "None found"}

FULL AREA BREAKDOWN:
${ctx.areaSummaries.map((a) => `${a.retailer} / ${a.area}: ${a.total} stores, ${a.activeLastMonth} active last month, ${a.inactive3Plus} gone 3+ months, ${a.lastMonthCases} cases last month`).join("\n")}

---

Based on this data, produce a structured sales analysis. Be specific — use actual store names and numbers. Do NOT be generic.

## What Are the Biggest Things I Need to Know?
3-5 sharp bullets with specific numbers and names.

## Main Takeaways
**Biggest Opportunities:** (bullet list)
**Biggest Risks:** (bullet list)
**Major Patterns:** (bullet list)

## Priority Accounts
Ranked list. For each: name, area, why they matter, what signal. Label: 🔴 High / 🟡 Medium / 🟢 Low.

## Sales Strategy
Tactical guidance — store vs banner issue, distribution/reset problems, reactivation vs low-probability, who to contact.

## Opportunity Segmentation
- 🔴 High-Priority Win-Backs
- 🟡 Medium-Priority Watchlist
- 🟢 New/Growth Opportunities
- ⚫ Low-Priority / Low-Return

## Recommended Next Actions
Top 5 practical actions for a salesperson this week.`;
}

// ── Expandable Area Row ───────────────────────────────────────────────────────
function AreaRow({
  row,
  lastMonth,
  allMonths,
}: {
  row: NonNullable<
    ReturnType<typeof buildAnalyticsContext>
  >["areaSummaries"][0];
  lastMonth: string;
  allMonths: string[];
}) {
  const [open, setOpen] = useState(false);
  const pullRate =
    row.total > 0 ? Math.round((row.activeLastMonth / row.total) * 100) : 0;
  const rateColor =
    pullRate >= 70
      ? "text-emerald-600 font-bold"
      : pullRate >= 40
        ? "text-amber-600 font-bold"
        : "text-slate-600 font-bold";

  // compute inactive months per store
  function getInactiveMoCount(store: (typeof row.sortedStores)[0]) {
    let count = 0;
    for (let i = allMonths.length - 1; i >= 0; i--) {
      if ((store.monthCases[allMonths[i]] || 0) === 0) count++;
      else break;
    }
    return count;
  }

  return (
    <>
      <tr
        className="border-t border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-3 text-slate-700">
          <span className="inline-flex items-center gap-1.5">
            <svg
              className={`h-3.5 w-3.5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
            {row.retailer}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-700 font-medium">{row.area}</td>
        <td className="px-4 py-3 text-right text-slate-700">{row.total}</td>
        <td className="px-4 py-3 text-right text-emerald-700 font-semibold">
          {row.activeLastMonth}
        </td>
        <td className="px-4 py-3 text-right text-slate-600">
          {row.inactiveLastMonth}
        </td>
        <td className="px-4 py-3 text-right">
          {row.inactive3Plus > 0 ? (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {row.inactive3Plus}
            </span>
          ) : (
            <span className="text-slate-400">0</span>
          )}
        </td>
        <td className={`px-4 py-3 text-right ${rateColor}`}>{pullRate}%</td>
        <td className="px-4 py-3 text-right font-semibold text-slate-900">
          {row.lastMonthCases.toLocaleString()}
        </td>
      </tr>

      {open && (
        <tr>
          <td
            colSpan={8}
            className="px-0 py-0 bg-slate-50 border-t border-slate-100"
          >
            <div className="px-6 py-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left font-semibold text-slate-500 pr-4">
                      Store
                    </th>
                    <th className="pb-2 text-center font-semibold text-slate-500 w-20">
                      Status
                    </th>
                    <th className="pb-2 text-right font-semibold text-slate-500 w-32">
                      Gone (months)
                    </th>
                    <th className="pb-2 text-right font-semibold text-slate-500 w-24">
                      Cases ({lastMonth})
                    </th>
                    <th className="pb-2 text-right font-semibold text-slate-500 w-24">
                      Total Cases
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.sortedStores.map((store, si) => {
                    const isActive = (store.monthCases[lastMonth] || 0) > 0;
                    const inactiveMo = isActive ? 0 : getInactiveMoCount(store);
                    return (
                      <tr
                        key={si}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-2 pr-4 text-slate-700 font-medium">
                          {store.customer}
                        </td>
                        <td className="py-2 text-center">
                          {isActive ? (
                            <span
                              title="Active last month"
                              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100"
                            >
                              <svg
                                className="h-3 w-3 text-emerald-600"
                                fill="none"
                                viewBox="0 0 12 12"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M2 6l3 3 5-5"
                                />
                              </svg>
                            </span>
                          ) : (
                            <span
                              title="Inactive last month"
                              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-red-100"
                            >
                              <svg
                                className="h-3 w-3 text-red-500"
                                fill="none"
                                viewBox="0 0 12 12"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M3 3l6 6M9 3L3 9"
                                />
                              </svg>
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {!isActive && inactiveMo > 0 ? (
                            <span
                              className={`font-semibold ${inactiveMo >= 3 ? "text-slate-600" : "text-amber-600"}`}
                            >
                              No pull for {inactiveMo} month
                              {inactiveMo !== 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-slate-700">
                          {store.monthCases[lastMonth] || 0}
                        </td>
                        <td className="py-2 text-right font-semibold text-slate-900">
                          {store.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Analytics Header (frozen/sticky) ─────────────────────────────────────────
function FillRateAreaRow({
  row,
  periodColumns,
}: {
  row: ReturnType<typeof buildFillRateSummaries>["areaRows"][0];
  periodColumns: FillRatePeriodColumn[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className="border-t border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer select-none"
        onClick={() => setOpen((value) => !value)}
      >
        <td className="px-4 py-3 text-slate-700">
          <span className="inline-flex items-center gap-1.5">
            <svg
              className={`h-3.5 w-3.5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
            {row.retailer}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-700 font-medium">{row.area}</td>
        <td className="px-4 py-3 text-right text-slate-700">
          {row.stores.length}
        </td>
        {periodColumns.map((column) => {
          const fillRate = row.fillRates[column.key] ?? 0;
          return (
            <td
              key={column.key}
              className={`px-4 py-3 text-right font-semibold ${getFillRateTone(fillRate)}`}
            >
              {formatFillRate(fillRate)}
            </td>
          );
        })}
      </tr>

      {open && (
        <tr>
          <td
            colSpan={3 + periodColumns.length}
            className="px-0 py-0 bg-slate-50 border-t border-slate-100"
          >
            <div className="px-6 py-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left font-semibold text-slate-500 pr-4">
                      Store
                    </th>
                    {periodColumns.map((column) => (
                      <th
                        key={column.key}
                        className="pb-2 text-right font-semibold text-slate-500 w-28"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.stores.map((store) => (
                    <tr
                      key={store.customer}
                      className="border-b border-slate-100 last:border-0"
                    >
                        <td className="py-2 pr-4 text-slate-700 font-medium">
                          {store.customer}
                        </td>
                        {periodColumns.map((column) => {
                          const fillRate = store.fillRates[column.key] ?? 0;
                          return (
                            <td
                              key={column.key}
                              className={`py-2 text-right font-semibold ${getFillRateTone(fillRate)}`}
                            >
                              {formatFillRate(fillRate)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AnalyticsHeader({
  allRows,
  fillRateRows = [],
  ctx,
  loading,
  loadError,
  analyticsSection,
  setAnalyticsSection,
  retailerFilter,
  setRetailerFilter,
  analyticsDateMode,
  setAnalyticsDateMode,
  analyticsFromMonth,
  setAnalyticsFromMonth,
  analyticsToMonth,
  setAnalyticsToMonth,
  analyticsSearchQuery,
  setAnalyticsSearchQuery,
}: {
  allRows: VelocityRow[];
  fillRateRows: VelocityRow[];
  ctx: ReturnType<typeof buildAnalyticsContext>;
  loading: boolean;
  loadError: string;
  analyticsSection: AnalyticsSection;
  setAnalyticsSection: (section: AnalyticsSection) => void;
  retailerFilter: string;
  setRetailerFilter: (value: string) => void;
  analyticsDateMode: AnalyticsDateMode;
  setAnalyticsDateMode: (value: AnalyticsDateMode) => void;
  analyticsFromMonth: string;
  setAnalyticsFromMonth: (value: string) => void;
  analyticsToMonth: string;
  setAnalyticsToMonth: (value: string) => void;
  analyticsSearchQuery: string;
  setAnalyticsSearchQuery: (value: string) => void;
}) {
  const defaultThisMonth = normalizeMonthLabel(getCurrentMonthLabel());
  const defaultLastMonth = normalizeMonthLabel(getLastMonthLabel());
  const retailerOptions = useMemo(
    () => [
      "All Retailers",
      ...Array.from(
        new Set(
          allRows
            .map((r) =>
              String(r.retailer || "")
                .replace(/\u00a0/g, " ")
                .trim(),
            )
            .filter(Boolean),
        ),
      ).sort(),
    ],
    [allRows],
  );

  const totalActive = useMemo(
    () => ctx?.areaSummaries.reduce((s, a) => s + a.activeLastMonth, 0) ?? 0,
    [ctx],
  );
  const totalStores = useMemo(
    () => ctx?.areaSummaries.reduce((s, a) => s + a.total, 0) ?? 0,
    [ctx],
  );
  const overallPullPct =
    totalStores > 0 ? Math.round((totalActive / totalStores) * 100) : 0;
  const winBackCount = ctx?.winBackCandidates.length ?? 0;
  const decliningCount = ctx?.decliningStores.length ?? 0;
  const fillRateSummary = useMemo(
    () => {
      const fillRateReferenceMonth =
        analyticsDateMode === "thisMonth"
          ? defaultThisMonth
          : analyticsDateMode === "lastMonth"
            ? defaultLastMonth
            : ctx?.lastMonth ?? "";
      return buildFillRateSummaries(
        fillRateRows,
        fillRateReferenceMonth,
        analyticsDateMode,
      );
    },
    [
      analyticsDateMode,
      defaultLastMonth,
      defaultThisMonth,
      fillRateRows,
      ctx?.lastMonth,
    ],
  );

  const cardBase =
    "rounded-3xl border px-5 py-3 shadow-sm flex items-center justify-between gap-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-300";
  const selectedRing = "ring-2 ring-slate-900/20";

  if (loading || loadError || !ctx) return null;

  return (
    <div className="space-y-3">
      {/* Title + filters row */}
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Sales Analytics</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBar
              value={analyticsSearchQuery}
              onChange={setAnalyticsSearchQuery}
              placeholder="Search retailer, area, store, UPC..."
            />
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
                Retailer
              </label>
              <select
                value={retailerFilter}
                onChange={(e) => setRetailerFilter(e.target.value)}
                className="h-9 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                {retailerOptions.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
                Reference Month
              </label>
              <select
                value={analyticsDateMode}
                onChange={(e) =>
                  setAnalyticsDateMode(e.target.value as AnalyticsDateMode)
                }
                className="h-9 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="thisMonth">
                  This Month ({defaultThisMonth})
                </option>
                <option value="lastMonth">
                  Last Month ({defaultLastMonth})
                </option>
                <option value="past6Months">Past 6 Months</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {analyticsDateMode === "custom" && (
              <>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
                    From
                  </label>
                  <input
                    type="month"
                    value={analyticsFromMonth}
                    onChange={(e) => setAnalyticsFromMonth(e.target.value)}
                    className="h-9 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-400 whitespace-nowrap">
                    To
                  </label>
                  <input
                    type="month"
                    value={analyticsToMonth}
                    onChange={(e) => setAnalyticsToMonth(e.target.value)}
                    className="h-9 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Clickable stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => setAnalyticsSection("summary")}
          className={`${cardBase} bg-emerald-50 text-emerald-700 border-emerald-200 ${analyticsSection === "summary" ? selectedRing : ""}`}
        >
          <div>
            <div className="text-sm font-semibold">Summary</div>
            <div className="text-xs opacity-70 mt-0.5">
              {overallPullPct}% pull rate · all areas
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-extrabold leading-none">
              {totalActive}
            </span>
            <span className="text-base font-semibold text-emerald-400 ml-1">
              /{totalStores}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setAnalyticsSection("pull-rate")}
          className={`${cardBase} bg-purple-50 text-purple-700 border-purple-200 ${analyticsSection === "pull-rate" ? selectedRing : ""}`}
        >
          <div>
            <div className="text-sm font-semibold">Pull Out Rate</div>
            <div className="text-xs opacity-70 mt-0.5">
              {totalActive}/{totalStores} stores active
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-extrabold leading-none">
              {overallPullPct}%
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setAnalyticsSection("fill-rate")}
          className={`${cardBase} bg-sky-50 text-sky-800 border-sky-200 ${analyticsSection === "fill-rate" ? selectedRing : ""}`}
        >
          <div>
            <div className="text-sm font-semibold">Fill Rate Summary</div>
            <div className="text-xs opacity-70 mt-0.5">
              {ctx.lastMonth} velocity rows
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-extrabold leading-none">
              {formatFillRate(fillRateSummary.overall)}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setAnalyticsSection("win-back")}
          className={`${cardBase} bg-slate-50 text-slate-700 border-amber-200 ${analyticsSection === "win-back" ? selectedRing : ""}`}
        >
          <div>
            <div className="text-sm font-semibold">Win-Back Candidates</div>
            <div className="text-xs opacity-70 mt-0.5">
              zero last 3 months, had prior volume
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-extrabold leading-none">
              {winBackCount}
            </span>
            <span className="text-xs font-semibold text-slate-400 ml-1">
              stores
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setAnalyticsSection("declining")}
          className={`${cardBase} bg-slate-50 text-slate-600 border-red-200 ${analyticsSection === "declining" ? selectedRing : ""}`}
        >
          <div>
            <div className="text-sm font-semibold">Declining Stores</div>
            <div className="text-xs opacity-70 mt-0.5">volume dropped 50%+</div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-extrabold leading-none">
              {decliningCount}
            </span>
            <span className="text-xs font-semibold text-red-400 ml-1">
              stores
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Analytics Tab Component (scrollable content only) ─────────────────────────
function WinBackAreaGroup({
  group,
  effectiveMonths,
}: {
  group: {
    retailer: string;
    area: string;
    totalStoresInArea: number;
    stores: {
      customer: string;
      retailer: string;
      retailerArea: string;
      monthCases: Record<string, number>;
      total: number;
    }[];
  };
  effectiveMonths: string[];
}) {
  const [open, setOpen] = useState(false);
  const pulled = group.stores.length;
  const total = group.totalStoresInArea;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`h-3.5 w-3.5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          <div className="min-w-0">
            <span className="font-semibold text-sm text-slate-800">
              {group.area}
            </span>
            <span className="ml-2 text-xs text-slate-500">
              {group.retailer}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-slate-500">
            {pulled}/{total} stores
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {pulled} win-back
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-700">
                  Store
                </th>
                <th className="px-4 py-2 text-right font-semibold text-slate-700">
                  Historical Cases
                </th>
                <th className="px-4 py-2 text-right font-semibold text-slate-700">
                  Last Active Month
                </th>
              </tr>
            </thead>
            <tbody>
              {group.stores.map((s, i) => {
                const lastActiveMo =
                  [...effectiveMonths]
                    .reverse()
                    .find((m) => (s.monthCases[m] || 0) > 0) ?? "—";
                return (
                  <tr
                    key={i}
                    className="border-t border-amber-50 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {s.customer}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-700">
                      {s.total}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      {lastActiveMo}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab Component ───────────────────────────────────────────────────
function AnalyticsTab({
  rows,
  ctx,
  loading,
  loadError,
  analyticsSection,
  analyticsDateMode,
}: {
  rows: VelocityRow[];
  ctx: ReturnType<typeof buildAnalyticsContext>;
  loading: boolean;
  loadError: string;
  analyticsSection: AnalyticsSection;
  analyticsDateMode: AnalyticsDateMode;
}) {
  const [fillRateSubTab, setFillRateSubTab] =
    useState<FillRateSubTabKey>("retailer");

  const areasByPullRate = useMemo(() => {
    if (!ctx) return [];
    return [...ctx.areaSummaries].sort((a, b) => {
      const ra = a.total > 0 ? a.activeLastMonth / a.total : 0;
      const rb = b.total > 0 ? b.activeLastMonth / b.total : 0;
      return rb - ra;
    });
  }, [ctx]);

  const top5ByPullRate = useMemo(
    () => areasByPullRate.slice(0, 5),
    [areasByPullRate],
  );

  const winBackByArea = useMemo(() => {
    if (!ctx) return [];
    const map = new Map<string, number>();
    for (const s of ctx.winBackCandidates) {
      const key = `${s.retailer} · ${s.retailerArea}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ctx]);

  const decliningByArea = useMemo(() => {
    if (!ctx) return [];
    const map = new Map<string, number>();
    for (const s of ctx.decliningStores) {
      const key = `${s.retailer} · ${s.retailerArea}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ctx]);

  const winBackByAreaGrouped = useMemo(() => {
    if (!ctx) return [];
    const map = new Map<
      string,
      {
        retailer: string;
        area: string;
        totalStoresInArea: number;
        stores: typeof ctx.winBackCandidates;
      }
    >();
    const areaTotal = new Map(
      ctx.areaSummaries.map((a) => [`${a.retailer}||${a.area}`, a.total]),
    );
    for (const s of ctx.winBackCandidates) {
      const key = `${s.retailer}||${s.retailerArea}`;
      if (!map.has(key))
        map.set(key, {
          retailer: s.retailer,
          area: s.retailerArea,
          totalStoresInArea: areaTotal.get(key) ?? 0,
          stores: [],
        });
      map.get(key)!.stores.push(s);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.stores.length - a.stores.length,
    );
  }, [ctx]);

  const fillRateSummary = useMemo(
    () =>
      buildFillRateSummaries(
        rows,
        analyticsDateMode === "thisMonth"
          ? normalizeMonthLabel(getCurrentMonthLabel())
          : analyticsDateMode === "lastMonth"
            ? normalizeMonthLabel(getLastMonthLabel())
            : ctx?.lastMonth ?? "",
        analyticsDateMode,
      ),
    [analyticsDateMode, rows, ctx?.lastMonth],
  );

  if (loading) return null;
  if (loadError) return null;
  if (!ctx) return null;

  const SummaryPanels = () => (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-800 uppercase tracking-wide">
          Top 5 Areas by Pull Rate
        </h3>
        <p className="mb-3 text-xs text-slate-400">{ctx.lastMonth}</p>
        <div className="space-y-3">
          {top5ByPullRate.map((area, i) => {
            const rate =
              area.total > 0
                ? Math.round((area.activeLastMonth / area.total) * 100)
                : 0;
            const barColor =
              rate >= 70
                ? "bg-emerald-500"
                : rate >= 40
                  ? "bg-amber-400"
                  : "bg-red-400";
            const textColor =
              rate >= 70
                ? "text-emerald-600"
                : rate >= 40
                  ? "text-amber-600"
                  : "text-red-500";
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-700 truncate">
                    {area.area}
                  </div>
                  <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
                <span
                  className={`text-xs font-bold shrink-0 w-9 text-right ${textColor}`}
                >
                  {rate}%
                </span>
                <span className="text-xs text-slate-400 shrink-0 w-12 text-right">
                  {area.activeLastMonth}/{area.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-slate-50 p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-700 uppercase tracking-wide">
          Win-Back by Area
        </h3>
        <p className="mb-3 text-xs text-amber-600">
          Areas with most win-back stores · pulled/total shown
        </p>
        <div className="space-y-2">
          {winBackByArea.length === 0 ? (
            <p className="text-xs text-amber-600">No win-back candidates</p>
          ) : (
            winBackByArea.map(([areaKey, count], i) => {
              const areaSummary = ctx.areaSummaries.find(
                (a) => `${a.retailer} · ${a.area}` === areaKey,
              );
              const areaTotal = areaSummary?.total ?? 0;
              const activeLast = areaSummary?.activeLastMonth ?? 0;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-slate-700 shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-xs text-slate-700 truncate">
                      {areaKey}
                    </span>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">
                      {activeLast}/{areaTotal}
                    </span>
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800">
                      {count} win-back
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-900 uppercase tracking-wide">
          Declining Stores by Area
        </h3>
        <p className="mb-3 text-xs text-slate-600">
          Areas with most stores declining 50%+
        </p>
        <div className="space-y-2">
          {decliningByArea.length === 0 ? (
            <p className="text-xs text-slate-600">No declining stores</p>
          ) : (
            decliningByArea.map(([area, count], i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-xs font-bold text-slate-600 shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-xs text-slate-700 truncate">
                    {area}
                  </span>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                  {count} stores
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const RetailerAreaBreakdown = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-slate-900">
        Retailer Area Breakdown
      </h3>
      <p className="mb-4 text-sm text-slate-500">
        Click any row to expand stores. Sorted by pull rate highest → lowest.
        Pull Rate = {ctx.lastMonth}. Gone 3+ = no pull for 3+ consecutive
        months.
      </p>
      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Retailer
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Area
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Total Stores
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Active ({ctx.lastMonth})
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Inactive ({ctx.lastMonth})
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Gone 3+ Months
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Pull Rate ({ctx.lastMonth})
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Cases ({ctx.lastMonth})
              </th>
            </tr>
          </thead>
          <tbody>
            {areasByPullRate.map((row, i) => (
              <AreaRow
                key={i}
                row={row}
                lastMonth={ctx.lastMonth}
                allMonths={ctx.effectiveMonths}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderFillRateSummary = () => {
    const isRetailer = fillRateSubTab === "retailer";
    const hasRows = isRetailer
      ? fillRateSummary.retailerRows.length > 0
      : fillRateSummary.areaRows.length > 0;

    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Fill Rate Summary
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Rolling fill rate from KeHE Velocity.
            </p>
          </div>
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setFillRateSubTab("retailer")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                fillRateSubTab === "retailer"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-white"
              }`}
            >
              Retailer Summary
            </button>
            <button
              type="button"
              onClick={() => setFillRateSubTab("area")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                fillRateSubTab === "area"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-white"
              }`}
            >
              Area Summary
            </button>
          </div>
        </div>

        {!hasRows ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No fill rate data found for the rolling fill-rate periods.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Retailer
                    </th>
                    {!isRetailer && (
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Area
                      </th>
                    )}
                    {!isRetailer && (
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">
                        Total Stores
                      </th>
                    )}
                    {fillRateSummary.periodColumns.map((column) => (
                      <th
                        key={column.key}
                        className="px-4 py-3 text-right font-semibold text-slate-700"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isRetailer
                    ? fillRateSummary.retailerRows.map((row) => (
                        <tr
                          key={row.retailer}
                          className="border-t border-slate-200 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3 text-slate-700">
                            {row.retailer}
                          </td>
                          {fillRateSummary.periodColumns.map((column) => {
                            const fillRate = row.fillRates[column.key] ?? 0;
                            return (
                              <td
                                key={column.key}
                                className={`px-4 py-3 text-right font-semibold ${getFillRateTone(fillRate)}`}
                              >
                                {formatFillRate(fillRate)}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    : fillRateSummary.areaRows.map((row) => (
                        <FillRateAreaRow
                          key={`${row.retailer}-${row.area}`}
                          row={row}
                          periodColumns={fillRateSummary.periodColumns}
                        />
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const WinBackCandidates = () => (
    <div className="rounded-3xl border border-amber-200 bg-slate-50 p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-slate-700">
        🔁 Win-Back Candidates
        <span className="ml-2 text-sm font-normal text-slate-700">
          ({ctx.winBackCandidates.length} stores across{" "}
          {winBackByAreaGrouped.length} areas)
        </span>
      </h3>
      <p className="mb-4 text-sm text-slate-700">
        Had meaningful historical volume · zero orders last 3 months · grouped
        by retailer area
      </p>
      {ctx.winBackCandidates.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-700">
          No win-back candidates found for the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {winBackByAreaGrouped.map((group, gi) => (
            <WinBackAreaGroup
              key={gi}
              group={group}
              effectiveMonths={ctx.effectiveMonths}
            />
          ))}
        </div>
      )}
    </div>
  );

  const DecliningStores = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-slate-900">
        📉 Declining Stores
        <span className="ml-2 text-sm font-normal text-slate-600">
          ({ctx.decliningStores.length} stores)
        </span>
      </h3>
      <p className="mb-4 text-sm text-slate-600">
        Volume dropped 50%+ vs average past 3 months before the reference month.
      </p>
      {ctx.decliningStores.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          No declining stores found for the current filters.
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">
                  Store
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">
                  Retailer
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">
                  Area
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  Average past 3 months
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  Cases ({ctx.lastMonth})
                </th>
              </tr>
            </thead>
            <tbody>
              {ctx.decliningStores.map((s, i) => (
                <tr
                  key={i}
                  className="border-t border-red-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {s.customer}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{s.retailer}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {s.retailerArea}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-600" title={getPrior3AverageLabel(ctx)}>
                    {getPrior3AverageForStore(s, ctx)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {s.monthCases[ctx.lastMonth] || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {analyticsSection === "summary" && <SummaryPanels />}
      {analyticsSection === "pull-rate" && <RetailerAreaBreakdown />}
      {analyticsSection === "fill-rate" && renderFillRateSummary()}
      {analyticsSection === "win-back" && <WinBackCandidates />}
      {analyticsSection === "declining" && <DecliningStores />}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function KeheDashboardView() {
  const [activeTab, setActiveTab] = useState<TabKey>("analytics");
  const [velocitySubTab, setVelocitySubTab] =
    useState<VelocitySubTabKey>("best-selling-store");
  const [pulloutSubTab, setPulloutSubTab] =
    useState<PulloutSubTabKey>("by-retailer-area");

  // velocity filters
  const [bestStorePeriodMode, setBestStorePeriodMode] =
    useState<PeriodMode>("lastMonth");
  const [bestStoreFromMonth, setBestStoreFromMonth] = useState(
    getLastMonthInputValue(),
  );
  const [bestStoreToMonth, setBestStoreToMonth] = useState(
    getCurrentMonthInputValue(),
  );
  const [topN, setTopN] = useState<TopN>(10);
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");
  const [monthlyCasesPeriodMode, setMonthlyCasesPeriodMode] =
    useState<PeriodMode>("past6Months");
  const [monthlyCasesFromMonth, setMonthlyCasesFromMonth] = useState(
    getPastMonthsInputValue(5),
  );
  const [monthlyCasesToMonth, setMonthlyCasesToMonth] = useState(
    getCurrentMonthInputValue(),
  );
  const [avgCakesPeriodMode, setAvgCakesPeriodMode] =
    useState<PeriodMode>("past6Months");
  const [avgCakesFromMonth, setAvgCakesFromMonth] = useState(
    getPastMonthsInputValue(5),
  );
  const [avgCakesToMonth, setAvgCakesToMonth] = useState(
    getCurrentMonthInputValue(),
  );

  // pullout filters
  const [pulloutPeriodMode, setPulloutPeriodMode] =
    useState<PeriodMode>("past6Months");
  const [pulloutFromMonth, setPulloutFromMonth] = useState(
    getPastMonthsInputValue(5),
  );
  const [pulloutToMonth, setPulloutToMonth] = useState(
    getCurrentMonthInputValue(),
  );
  const [pulloutRetailerFilter, setPulloutRetailerFilter] =
    useState("All Retailers");
  const [pulloutCustomerFilter, setPulloutCustomerFilter] = useState<string[]>(
    [],
  );
  const [pulloutSearchQuery, setPulloutSearchQuery] = useState("");

  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // analytics filters / clickable summary cards
  const [analyticsSection, setAnalyticsSection] =
    useState<AnalyticsSection>("summary");
  const [analyticsRetailerFilter, setAnalyticsRetailerFilter] =
    useState("All Retailers");
  const [analyticsSearchQuery, setAnalyticsSearchQuery] = useState("");
  const [analyticsDateMode, setAnalyticsDateMode] =
    useState<AnalyticsDateMode>("thisMonth");
  const [analyticsFromMonth, setAnalyticsFromMonth] = useState(
    getPastMonthsInputValue(2),
  );
  const [analyticsToMonth, setAnalyticsToMonth] = useState(
    getCurrentMonthInputValue(),
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const pageSize = 1000;
        let from = 0;
        let all: VelocityRow[] = [];
        while (true) {
          const { data, error } = await supabase
            .from("kehe_velocity")
            .select("*")
            .range(from, from + pageSize - 1);
          if (error) throw error;
          const batch = (data ?? []) as VelocityRow[];
          all = [...all, ...batch];
          if (batch.length < pageSize) break;
          from += pageSize;
        }
        setRows(all);

        try {
          let locationFrom = 0;
          let allLocations: LocationRow[] = [];
          while (true) {
            const { data, error } = await supabase
              .from("locations")
              .select("*")
              .range(locationFrom, locationFrom + pageSize - 1);
            if (error) throw error;
            const batch = (data ?? []) as LocationRow[];
            allLocations = [...allLocations, ...batch];
            if (batch.length < pageSize) break;
            locationFrom += pageSize;
          }
          setLocations(allLocations);
        } catch (locationError) {
          console.error("Failed to load location DC mappings:", locationError);
          setLocations([]);
        }
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load KEHE velocity data.",
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const locationDcLookup = useMemo<LocationDcLookup>(() => {
    const exact = new Map<string, string>();
    const entries: LocationDcEntry[] = [];

    for (const location of locations) {
      const dc = getLocationDc(location);
      const customer = String(getLocationCustomer(location) || "").trim();
      const retailerArea = String(getLocationArea(location) || "").trim();
      const key = getLocationKey(customer, retailerArea);

      if (!dc) continue;
      if (key) exact.set(key, dc);
      if (customer && retailerArea) {
        entries.push({
          customer,
          retailerArea,
          dc,
          storeCode: getLocationStoreCode(customer),
        });
      }
    }

    return { exact, entries };
  }, [locations]);

  const retailerOptions = useMemo(
    () => [
      "All Retailers",
      ...Array.from(
        new Set(
          rows
            .map((r) =>
              String(r.retailer || "")
                .replace(/\u00a0/g, " ")
                .trim(),
            )
            .filter(Boolean),
        ),
      ).sort(),
    ],
    [rows],
  );

  const analyticsFilteredRows = useMemo(() => {
    const q = analyticsSearchQuery.trim().toLowerCase();

    return rows.filter((r) => {
      const retailer = String(r.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();
      const area = String(r.retailer_area || "")
        .replace(/\u00a0/g, " ")
        .trim();
      const customer = String(r.customer || "")
        .replace(/\u00a0/g, " ")
        .trim();
      const upc = String(r.upc || "")
        .replace(/\u00a0/g, " ")
        .trim();
      const description = String(r.description || "")
        .replace(/\u00a0/g, " ")
        .trim();

      const retailerMatch =
        analyticsRetailerFilter === "All Retailers" ||
        retailer === analyticsRetailerFilter;
      const searchMatch =
        !q ||
        retailer.toLowerCase().includes(q) ||
        area.toLowerCase().includes(q) ||
        customer.toLowerCase().includes(q) ||
        upc.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q);

      return retailerMatch && searchMatch;
    });
  }, [rows, analyticsRetailerFilter, analyticsSearchQuery]);

  const analyticsAvailableMonths = useMemo(
    () =>
      Array.from(
        new Set(analyticsFilteredRows.map((r) => normalizeMonthLabel(r.month))),
      ).sort(compareMonthLabelsAsc),
    [analyticsFilteredRows],
  );

  const analyticsThisMonth = normalizeMonthLabel(getCurrentMonthLabel());
  const analyticsCalendarLastMonth = normalizeMonthLabel(getLastMonthLabel());
  const analyticsDefaultReferenceMonth =
    analyticsAvailableMonths[analyticsAvailableMonths.length - 1] ??
    analyticsThisMonth;

  const analyticsSelectedMonths = useMemo(() => {
    if (analyticsDateMode === "thisMonth") return [analyticsThisMonth];
    if (analyticsDateMode === "lastMonth") return [analyticsCalendarLastMonth];
    if (analyticsDateMode === "past6Months") return analyticsAvailableMonths.slice(-6);
    return buildMonthRange(analyticsFromMonth, analyticsToMonth).map(
      normalizeMonthLabel,
    );
  }, [
    analyticsDateMode,
    analyticsAvailableMonths,
    analyticsCalendarLastMonth,
    analyticsFromMonth,
    analyticsThisMonth,
    analyticsToMonth,
  ]);

  const analyticsReferenceMonth = useMemo(() => {
    if (analyticsDateMode === "thisMonth") return analyticsThisMonth;
    if (analyticsDateMode === "lastMonth") return analyticsCalendarLastMonth;
    return (
      analyticsSelectedMonths[analyticsSelectedMonths.length - 1] ??
      analyticsDefaultReferenceMonth
    );
  }, [
    analyticsCalendarLastMonth,
    analyticsDateMode,
    analyticsDefaultReferenceMonth,
    analyticsSelectedMonths,
    analyticsThisMonth,
  ]);

  const analyticsRowsByDate = useMemo(() => {
    if (!analyticsReferenceMonth) return analyticsFilteredRows;

    return analyticsFilteredRows.filter(
      (row) =>
        getMonthSortValue(normalizeMonthLabel(row.month)) <=
        getMonthSortValue(analyticsReferenceMonth),
    );
  }, [
    analyticsFilteredRows,
    analyticsReferenceMonth,
  ]);

  const analyticsCtx = useMemo(
    () => buildAnalyticsContext(analyticsRowsByDate, analyticsReferenceMonth),
    [analyticsRowsByDate, analyticsReferenceMonth],
  );
  const bestStoreSelectedMonths = useMemo(() => {
    if (bestStorePeriodMode === "lastMonth")
      return [normalizeMonthLabel(getLastMonthLabel())];
    if (bestStorePeriodMode === "past12Months")
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    if (bestStorePeriodMode === "past6Months")
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    return buildMonthRange(bestStoreFromMonth, bestStoreToMonth).map(
      normalizeMonthLabel,
    );
  }, [bestStorePeriodMode, bestStoreFromMonth, bestStoreToMonth]);

  const monthlyCasesSelectedMonths = useMemo(() => {
    if (monthlyCasesPeriodMode === "lastMonth")
      return [normalizeMonthLabel(getLastMonthLabel())];
    if (monthlyCasesPeriodMode === "past12Months")
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    if (monthlyCasesPeriodMode === "past6Months")
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    return buildMonthRange(monthlyCasesFromMonth, monthlyCasesToMonth).map(
      normalizeMonthLabel,
    );
  }, [monthlyCasesPeriodMode, monthlyCasesFromMonth, monthlyCasesToMonth]);

  const avgCakesSelectedMonths = useMemo(() => {
    if (avgCakesPeriodMode === "lastMonth")
      return [normalizeMonthLabel(getLastMonthLabel())];
    if (avgCakesPeriodMode === "past12Months")
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    if (avgCakesPeriodMode === "past6Months")
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    return buildMonthRange(avgCakesFromMonth, avgCakesToMonth).map(
      normalizeMonthLabel,
    );
  }, [avgCakesPeriodMode, avgCakesFromMonth, avgCakesToMonth]);

  const pulloutSelectedMonths = useMemo(() => {
    if (pulloutPeriodMode === "lastMonth")
      return [normalizeMonthLabel(getLastMonthLabel())];
    if (pulloutPeriodMode === "past12Months")
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    if (pulloutPeriodMode === "past6Months")
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    return buildMonthRange(pulloutFromMonth, pulloutToMonth).map(
      normalizeMonthLabel,
    );
  }, [pulloutPeriodMode, pulloutFromMonth, pulloutToMonth]);

  const bestStoreRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          bestStoreSelectedMonths.includes(normalizeMonthLabel(row.month)) &&
          (retailerFilter === "All Retailers" ||
            String(row.retailer || "")
              .replace(/\u00a0/g, " ")
              .trim() === retailerFilter),
      ),
    [rows, bestStoreSelectedMonths, retailerFilter],
  );
  const topSellingStores = useMemo(() => {
    const g = new Map<string, number>();
    for (const r of bestStoreRows) {
      if (!r.customer) continue;
      g.set(r.customer, (g.get(r.customer) || 0) + Number(r.cases || 0));
    }
    return Array.from(g.entries())
      .map(([c, t]) => ({ customer: c, totalCases: t }))
      .sort((a, b) => b.totalCases - a.totalCases)
      .slice(0, topN);
  }, [bestStoreRows, topN]);

  const monthlyCasesRows = useMemo(
    () =>
      rows.filter((r) =>
        monthlyCasesSelectedMonths.includes(normalizeMonthLabel(r.month)),
      ),
    [rows, monthlyCasesSelectedMonths],
  );
  const monthlyCasesSeries = useMemo(() => {
    const sm = [...monthlyCasesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((m) =>
        monthlyCasesRows.some((r) => normalizeMonthLabel(r.month) === m),
      );
    const retailerNames = Array.from(
      new Set(
        monthlyCasesRows
          .map((row) =>
            String(row.retailer || "")
              .replace(/\u00a0/g, " ")
              .trim(),
          )
          .filter(Boolean),
      ),
    ).sort(sortRetailersForChart);

    const g: Record<string, Record<string, number>> = {};
    for (const m of sm) {
      g[m] = {};
      for (const retailer of retailerNames) g[m][retailer] = 0;
    }

    for (const row of monthlyCasesRows) {
      const m = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();
      if (!retailer) continue;
      if (!g[m]) g[m] = {};
      g[m][retailer] = (g[m][retailer] || 0) + Number(row.cases || 0);
    }

    return {
      months: sm,
      series: retailerNames.map((retailer, index) => ({
        name: retailer,
        fill: getRetailerChartColor(retailer, index),
        values: sm.map((m) => g[m]?.[retailer] || 0),
      })),
    };
  }, [monthlyCasesRows, monthlyCasesSelectedMonths]);

  const avgCakesRows = useMemo(
    () =>
      rows.filter((r) =>
        avgCakesSelectedMonths.includes(normalizeMonthLabel(r.month)),
      ),
    [rows, avgCakesSelectedMonths],
  );
  const averageCakesPerWeekSeries = useMemo(() => {
    const sm = [...avgCakesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((m) =>
        avgCakesRows.some((r) => normalizeMonthLabel(r.month) === m),
      );
    const cakes = Array.from(
      new Set(
        avgCakesRows
          .map((r) => getCakeSeriesName(r.description))
          .filter(Boolean),
      ),
    ).sort((a, b) => {
      const w = getCakeSortWeight(a) - getCakeSortWeight(b);
      return w !== 0 ? w : a.localeCompare(b);
    });
    const pal = [
      "#123f73",
      "#f59e0b",
      "#60c7df",
      "#7c3aed",
      "#10b981",
      "#ef4444",
      "#8b5cf6",
      "#14b8a6",
      "#f97316",
      "#3b82f6",
    ];
    const g: Record<string, Record<string, number>> = {};
    for (const m of sm) {
      g[m] = {};
      for (const c of cakes) g[m][c] = 0;
    }
    for (const row of avgCakesRows) {
      const m = normalizeMonthLabel(row.month);
      const c = getCakeSeriesName(row.description);
      if (!c || !g[m]) continue;
      g[m][c] = (g[m][c] || 0) + Number(row.eaches || 0);
    }
    return {
      months: sm,
      series: cakes.map((c, i) => ({
        name: c,
        fill: pal[i % pal.length],
        values: sm.map((m) => Number(((g[m]?.[c] || 0) / 4).toFixed(1))),
      })),
    };
  }, [avgCakesRows, avgCakesSelectedMonths]);

  const pulloutRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          pulloutSelectedMonths.includes(normalizeMonthLabel(row.month)) &&
          (pulloutRetailerFilter === "All Retailers" ||
            String(row.retailer || "")
              .replace(/\u00a0/g, " ")
              .trim() === pulloutRetailerFilter),
      ),
    [rows, pulloutSelectedMonths, pulloutRetailerFilter],
  );
  const customerOptions = useMemo(
    () => [
      "All Customers",
      ...Array.from(
        new Set(
          pulloutRows
            .map((r) => String(r.customer || "").trim())
            .filter(Boolean),
        ),
      ).sort(),
    ],
    [pulloutRows],
  );
  useEffect(() => {
    setPulloutCustomerFilter([]);
  }, [pulloutRetailerFilter]);
  useEffect(() => {
    setPulloutSearchQuery("");
  }, [pulloutSubTab]);

  const pulloutByAreaTable = useMemo(() => {
    const mc = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const g = new Map<
      string,
      {
        retailer: string;
        retailer_area: string;
        months: Record<string, number>;
        total: number;
      }
    >();
    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month),
        retailer = String(row.retailer || "").trim() || "Unknown",
        ra = String(row.retailer_area || "").trim() || "Unknown",
        key = `${retailer}__${ra}`;
      if (!g.has(key))
        g.set(key, { retailer, retailer_area: ra, months: {}, total: 0 });
      const item = g.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }
    return {
      monthColumns: mc,
      rows: Array.from(g.values()).sort((a, b) => b.total - a.total),
    };
  }, [pulloutRows, pulloutSelectedMonths]);

  const pulloutByStoreTable = useMemo(() => {
    const mc = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const selectedCustomers = new Set(pulloutCustomerFilter);
    const filtered = pulloutRows.filter(
      (r) =>
        pulloutCustomerFilter.length === 0 ||
        selectedCustomers.has(String(r.customer || "").trim()),
    );
    const g = new Map<
      string,
      {
        retailer: string;
        retailer_area: string;
        customer: string;
        months: Record<string, number>;
        total: number;
      }
    >();
    for (const row of filtered) {
      const month = normalizeMonthLabel(row.month),
        retailer = String(row.retailer || "").trim() || "Unknown",
        ra = String(row.retailer_area || "").trim() || "Unknown",
        cust = String(row.customer || "").trim() || "Unknown",
        key = `${retailer}__${ra}__${cust}`;
      if (!g.has(key))
        g.set(key, {
          retailer,
          retailer_area: ra,
          customer: cust,
          months: {},
          total: 0,
        });
      const item = g.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }
    return {
      monthColumns: mc,
      rows: Array.from(g.values()).sort((a, b) => b.total - a.total),
    };
  }, [pulloutRows, pulloutSelectedMonths, pulloutCustomerFilter]);

  const pulloutByDcTable = useMemo(() => {
    const mc = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const g = new Map<
      string,
      {
        dc: string;
        months: Record<string, number>;
        total: number;
      }
    >();
    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month);
      const dc = getDcForVelocityRow(row, locationDcLookup);
      if (!g.has(dc)) {
        g.set(dc, { dc, months: {}, total: 0 });
      }
      const item = g.get(dc)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }
    return {
      monthColumns: mc,
      rows: Array.from(g.values()).sort((a, b) => {
        if (a.dc === "Unassigned DC") return 1;
        if (b.dc === "Unassigned DC") return -1;
        return b.total - a.total;
      }),
    };
  }, [pulloutRows, pulloutSelectedMonths, locationDcLookup]);

  const filteredByAreaRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByAreaTable.rows;
    return pulloutByAreaTable.rows.filter(
      (r) =>
        r.retailer.toLowerCase().includes(q) ||
        r.retailer_area.toLowerCase().includes(q),
    );
  }, [pulloutByAreaTable.rows, pulloutSearchQuery]);
  const filteredByStoreRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByStoreTable.rows;
    return pulloutByStoreTable.rows.filter(
      (r) =>
        r.retailer.toLowerCase().includes(q) ||
        r.retailer_area.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q),
    );
  }, [pulloutByStoreTable.rows, pulloutSearchQuery]);
  const filteredByDcRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByDcTable.rows;
    return pulloutByDcTable.rows.filter((r) => r.dc.toLowerCase().includes(q));
  }, [pulloutByDcTable.rows, pulloutSearchQuery]);

  const renderTabButtons = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["analytics", "velocity", "pullout"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium capitalize transition ${activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            {tab === "pullout"
              ? "Pull out"
              : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );

  const renderVelocitySubTabs = () => (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["best-selling-store", "Best Selling Store"],
          ["total-cases-per-month", "Total Cases Per Month"],
          ["overall-average-cakes-per-week", "Overall: Average Cakes Per Week"],
        ] as [VelocitySubTabKey, string][]
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setVelocitySubTab(key)}
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${velocitySubTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderPulloutSubTabs = () => (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["by-retailer-area", "Monthly Cases by Retailer Area"],
          ["by-retailer-store", "Monthly Cases by Retailer Store"],
          ["by-dc", "Monthly Cases per DC"],
        ] as [PulloutSubTabKey, string][]
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setPulloutSubTab(key)}
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${pulloutSubTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderVelocityFilters = () => {
    if (velocitySubTab === "best-selling-store")
      return (
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Retailer
            </label>
            <select
              value={retailerFilter}
              onChange={(e) => setRetailerFilter(e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            >
              {retailerOptions.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Show Top
            </label>
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) as TopN)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            >
              {[5, 10, 15, 20].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date Filter
            </label>
            <select
              value={bestStorePeriodMode}
              onChange={(e) =>
                setBestStorePeriodMode(e.target.value as PeriodMode)
              }
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            >
              <option value="lastMonth">Last Month</option>
              <option value="past6Months">Past 6 Months</option>
              <option value="past12Months">Past 12 Months</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {bestStorePeriodMode === "custom" && (
            <>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  From
                </label>
                <input
                  type="month"
                  value={bestStoreFromMonth}
                  onChange={(e) => setBestStoreFromMonth(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                />
              </div>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  To
                </label>
                <input
                  type="month"
                  value={bestStoreToMonth}
                  onChange={(e) => setBestStoreToMonth(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                />
              </div>
            </>
          )}
        </div>
      );
    if (velocitySubTab === "total-cases-per-month")
      return (
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date Filter
            </label>
            <select
              value={monthlyCasesPeriodMode}
              onChange={(e) =>
                setMonthlyCasesPeriodMode(e.target.value as PeriodMode)
              }
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            >
              <option value="past6Months">Past 6 Months</option>
              <option value="past12Months">Past 12 Months</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {monthlyCasesPeriodMode === "custom" && (
            <>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  From
                </label>
                <input
                  type="month"
                  value={monthlyCasesFromMonth}
                  onChange={(e) => setMonthlyCasesFromMonth(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                />
              </div>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  To
                </label>
                <input
                  type="month"
                  value={monthlyCasesToMonth}
                  onChange={(e) => setMonthlyCasesToMonth(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                />
              </div>
            </>
          )}
        </div>
      );
    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Date Filter
          </label>
          <select
            value={avgCakesPeriodMode}
            onChange={(e) =>
              setAvgCakesPeriodMode(e.target.value as PeriodMode)
            }
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
          >
            <option value="past6Months">Past 6 Months</option>
            <option value="past12Months">Past 12 Months</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {avgCakesPeriodMode === "custom" && (
          <>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                From
              </label>
              <input
                type="month"
                value={avgCakesFromMonth}
                onChange={(e) => setAvgCakesFromMonth(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
              />
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                To
              </label>
              <input
                type="month"
                value={avgCakesToMonth}
                onChange={(e) => setAvgCakesToMonth(e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPulloutFilters = () => (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Search
        </label>
        <SearchBar
          value={pulloutSearchQuery}
          onChange={setPulloutSearchQuery}
          placeholder={
            pulloutSubTab === "by-retailer-area"
              ? "Search retailer or area..."
              : pulloutSubTab === "by-dc"
                ? "Search DC..."
                : "Search retailer, area or customer..."
          }
        />
      </div>
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Retailer
        </label>
        <select
          value={pulloutRetailerFilter}
          onChange={(e) => setPulloutRetailerFilter(e.target.value)}
          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
        >
          {retailerOptions.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {pulloutSubTab === "by-retailer-store" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Customer
          </label>
          <SearchableSelect
            options={customerOptions}
            value={pulloutCustomerFilter}
            onChange={setPulloutCustomerFilter}
            placeholder="Search customer..."
          />
        </div>
      )}
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Date Filter
        </label>
        <select
          value={pulloutPeriodMode}
          onChange={(e) => setPulloutPeriodMode(e.target.value as PeriodMode)}
          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
        >
          <option value="past6Months">Past 6 Months</option>
          <option value="lastMonth">Last Month</option>
          <option value="past12Months">Past 12 Months</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      {pulloutPeriodMode === "custom" && (
        <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              From
            </label>
            <input
              type="month"
              value={pulloutFromMonth}
              onChange={(e) => setPulloutFromMonth(e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              To
            </label>
            <input
              type="month"
              value={pulloutToMonth}
              onChange={(e) => setPulloutToMonth(e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            />
          </div>
        </>
      )}
    </div>
  );

  const renderPulloutTable = () => {
    if (loading)
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading KEHE velocity data...
        </div>
      );
    if (loadError)
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          {loadError}
        </div>
      );
    const isArea = pulloutSubTab === "by-retailer-area";
    const isStore = pulloutSubTab === "by-retailer-store";
    const isDc = pulloutSubTab === "by-dc";
    const monthColumns = isArea
      ? pulloutByAreaTable.monthColumns
      : isStore
        ? pulloutByStoreTable.monthColumns
        : pulloutByDcTable.monthColumns;
    const tableRows: Array<{
      retailer?: string;
      retailer_area?: string;
      customer?: string;
      dc?: string;
      months: Record<string, number>;
      total: number;
    }> = isArea
      ? filteredByAreaRows
      : isStore
        ? filteredByStoreRows
        : filteredByDcRows;
    const handleExport = () => {
      const headers = isDc
        ? ["DC", ...monthColumns, "Total"]
        : isArea
          ? ["Retailer", "Retailer Area", ...monthColumns, "Total"]
          : ["Retailer", "Retailer Area", "Store", ...monthColumns, "Total"];
      const exportRows = tableRows.map((row) => {
        const base = isDc
          ? [row.dc ?? ""]
          : isArea
            ? [row.retailer ?? "", row.retailer_area ?? ""]
            : [row.retailer ?? "", row.retailer_area ?? "", row.customer ?? ""];
        return [
          ...base,
          ...monthColumns.map((m) => row.months[m] || 0),
          row.total,
        ];
      });
      exportToExcel({
        filename: isDc
          ? "monthly-cases-per-dc"
          : isArea
          ? "monthly-cases-by-retailer-area"
          : "monthly-cases-by-retailer-store",
        headers,
        rows: exportRows,
      });
    };
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={handleExport}
            disabled={tableRows.length === 0}
            title="Download as Excel / CSV"
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="h-4 w-4 text-emerald-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
            Download Excel
          </button>
        </div>
        {tableRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No rows found for the selected filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    {isDc ? (
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        DC
                      </th>
                    ) : (
                      <>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Retailer
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Retailer Area
                        </th>
                      </>
                    )}
                    {isStore && (
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Store
                      </th>
                    )}
                    {monthColumns.map((m) => (
                      <th
                        key={m}
                        className="px-4 py-3 text-left font-semibold text-slate-700"
                      >
                        {m}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-t border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      {isDc ? (
                        <td className="px-4 py-3 text-slate-700">
                          {row.dc}
                        </td>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-slate-700">
                            {row.retailer}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.retailer_area}
                          </td>
                        </>
                      )}
                      {isStore && (
                        <td className="px-4 py-3 text-slate-700">
                          {row.customer}
                        </td>
                      )}
                      {monthColumns.map((m) => (
                        <td key={m} className="px-4 py-3 text-slate-700">
                          {row.months[m] || 0}
                        </td>
                      ))}
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* ── FIXED HEADER (does NOT move) ── */}
      <div className="shrink-0">
        <div className="z-20 bg-slate-100 pt-3 pb-3 px-6 shadow-[0_2px_8px_0_rgba(0,0,0,0.06)]">
          <div className="pb-2">{renderTabButtons()}</div>

          {activeTab === "analytics" && (
            <div className="pb-1">
              <AnalyticsHeader
                allRows={rows}
                fillRateRows={analyticsRowsByDate}
                ctx={analyticsCtx}
                loading={loading}
                loadError={loadError}
                analyticsSection={analyticsSection}
                setAnalyticsSection={setAnalyticsSection}
                retailerFilter={analyticsRetailerFilter}
                setRetailerFilter={setAnalyticsRetailerFilter}
                analyticsDateMode={analyticsDateMode}
                setAnalyticsDateMode={setAnalyticsDateMode}
                analyticsFromMonth={analyticsFromMonth}
                setAnalyticsFromMonth={setAnalyticsFromMonth}
                analyticsToMonth={analyticsToMonth}
                setAnalyticsToMonth={setAnalyticsToMonth}
                analyticsSearchQuery={analyticsSearchQuery}
                setAnalyticsSearchQuery={setAnalyticsSearchQuery}
              />
            </div>
          )}

          {activeTab === "velocity" && (
            <div className="pb-1">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-3">
                    <h2 className="text-2xl font-bold text-slate-900">
                      Velocity
                    </h2>
                    {renderVelocitySubTabs()}
                  </div>
                  {renderVelocityFilters()}
                </div>
              </div>
            </div>
          )}

          {activeTab === "pullout" && (
            <div className="pb-1">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex flex-col gap-3">
                    {renderPulloutSubTabs()}
                  </div>
                  {renderPulloutFilters()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ONLY ── */}
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-10 space-y-6">
        {activeTab === "analytics" && (
          <AnalyticsTab
            rows={analyticsRowsByDate}
            ctx={analyticsCtx}
            loading={loading}
            loadError={loadError}
            analyticsSection={analyticsSection}
            analyticsDateMode={analyticsDateMode}
          />
        )}

        {activeTab === "velocity" && (
          <>
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                Loading...
              </div>
            ) : loadError ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                {loadError}
              </div>
            ) : (
              <>
                {velocitySubTab === "best-selling-store" && (
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-xl font-semibold text-slate-900">
                          Top Selling Store
                        </h3>
                        <div className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                          Top {topN}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {topSellingStores.length === 0 ? (
                          <div className="text-sm text-slate-500">
                            No data found for the selected filters.
                          </div>
                        ) : (
                          topSellingStores.map((item, i) => (
                            <div
                              key={`${item.customer}-${i}`}
                              className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 px-4 py-3"
                            >
                              <div className="text-sm font-medium leading-5 text-slate-800">
                                {item.customer}
                              </div>
                              <div className="min-w-[56px] text-right text-sm font-bold text-slate-900">
                                {item.totalCases}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <HorizontalBarChart
                      title="Top Selling Store"
                      data={topSellingStores.map((item) => ({
                        label: item.customer,
                        value: item.totalCases,
                      }))}
                    />
                  </div>
                )}

                {velocitySubTab === "total-cases-per-month" && (
                  <GroupedMonthlyChart
                    title="Total Cases per Month per Retailer"
                    months={monthlyCasesSeries.months}
                    series={monthlyCasesSeries.series}
                  />
                )}

                {velocitySubTab === "overall-average-cakes-per-week" && (
                  <GroupedMonthlyChart
                    title="Overall: Average Cakes per Week"
                    months={averageCakesPerWeekSeries.months}
                    series={averageCakesPerWeekSeries.series}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === "pullout" && renderPulloutTable()}
      </div>
    </div>
  );
}
