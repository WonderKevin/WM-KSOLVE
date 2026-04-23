"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TabKey = "analytics" | "velocity" | "pullout";
type VelocitySubTabKey =
  | "best-selling-store"
  | "total-cases-per-month"
  | "overall-average-cakes-per-week";
type PulloutSubTabKey = "by-retailer-area" | "by-retailer-store";
type PeriodMode = "lastMonth" | "custom" | "past12Months";
type TopN = 5 | 10 | 15 | 20;

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
  source_file_name?: string;
};

function normalizeMonthLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/['`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getCakeSeriesName(description: string) {
  return String(description || "").replace(/\u00a0/g, " ").trim();
}

function getCakeSortWeight(description: string) {
  const text = getCakeSeriesName(description).toUpperCase();
  if (text.startsWith("NSA")) return 1;
  if (text.startsWith("HP")) return 2;
  return 99;
}

function getMonthSortValue(value: string) {
  const normalized = normalizeMonthLabel(value);
  const match = normalized.match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!match) return -Infinity;
  const monthIndex = new Date(`${match[1]} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return -Infinity;
  return (2000 + Number(match[2])) * 100 + (monthIndex + 1);
}

function compareMonthLabelsAsc(a: string, b: string) {
  return getMonthSortValue(a) - getMonthSortValue(b);
}

function monthLabelFromDate(date: Date) {
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(date.getFullYear()).slice(-2)}`;
}

function getCurrentMonthInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getLastMonthInputValue() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPastMonthsInputValue(monthsBack: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getLastMonthLabel() {
  const now = new Date();
  return monthLabelFromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

function buildMonthRange(fromMonth: string, toMonth: string) {
  const result: string[] = [];
  if (!fromMonth || !toMonth) return result;
  const [fromYear, fromMonthNum] = fromMonth.split("-").map(Number);
  const [toYear, toMonthNum] = toMonth.split("-").map(Number);
  if (!fromYear || !fromMonthNum || !toYear || !toMonthNum) return result;
  let cursor = new Date(fromYear, fromMonthNum - 1, 1);
  const end = new Date(toYear, toMonthNum - 1, 1);
  while (cursor <= end) {
    result.push(monthLabelFromDate(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return result;
}

function buildPast12MonthsRange() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) =>
    monthLabelFromDate(new Date(now.getFullYear(), now.getMonth() - (11 - i), 1))
  );
}

function truncateLabel(value: string, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ── Searchable dropdown ───────────────────────────────────────────────────────
function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(query.toLowerCase())),
    [options, query]
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative min-w-[200px]">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 outline-none flex items-center justify-between gap-2 hover:border-slate-300 transition"
      >
        <span className="truncate">{value}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
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
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">No results</div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { onChange(option); setOpen(false); setQuery(""); }}
                  className={`w-full px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${value === option ? "font-semibold text-slate-900 bg-slate-50" : "text-slate-700"}`}
                >
                  {option}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────
function GroupedMonthlyChart({ title, months, series }: {
  title: string;
  months: string[];
  series: { name: string; values: number[]; fill: string }[];
}) {
  const chartHeight = 360;
  const chartWidth = Math.max(980, 140 + months.length * 120);
  const leftPad = 55, rightPad = 20, topPad = 20, bottomPad = 95;
  const innerWidth = chartWidth - leftPad - rightPad;
  const innerHeight = chartHeight - topPad - bottomPad;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const groupWidth = months.length > 0 ? innerWidth / months.length : innerWidth;
  const barGap = 6, groupInnerPadding = 12;
  const barWidth = Math.max(14, (groupWidth - groupInnerPadding * 2 - barGap * Math.max(series.length - 1, 0)) / Math.max(series.length, 1));
  const ticks = Array.from({ length: 5 }, (_, i) => ({
    value: Math.round((maxValue / 4) * i),
    y: topPad + innerHeight - (innerHeight / 4) * i,
  }));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: "980px" }}>
          {ticks.map((tick, i) => (
            <g key={i}>
              <line x1={leftPad} y1={tick.y} x2={chartWidth - rightPad} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={tick.y + 4} textAnchor="end" fontSize="11" fill="#64748b">{tick.value}</text>
            </g>
          ))}
          <line x1={leftPad} y1={topPad + innerHeight} x2={chartWidth - rightPad} y2={topPad + innerHeight} stroke="#94a3b8" strokeWidth="1.5" />
          {months.map((month, mi) => {
            const groupStartX = leftPad + mi * groupWidth + groupInnerPadding;
            return (
              <g key={month}>
                {series.map((item, si) => {
                  const value = item.values[mi] || 0;
                  const barHeight = (value / maxValue) * innerHeight;
                  const x = groupStartX + si * (barWidth + barGap);
                  const y = topPad + innerHeight - barHeight;
                  return (
                    <g key={`${month}-${item.name}`}>
                      <rect x={x} y={y} width={barWidth} height={barHeight} rx="3" fill={item.fill} />
                      <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={item.fill}>{value}</text>
                    </g>
                  );
                })}
                <text x={leftPad + mi * groupWidth + groupWidth / 2} y={topPad + innerHeight + 18} textAnchor="middle" fontSize="11" fill="#334155">{month.toUpperCase()}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        {series.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.fill }} />
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarChart({ data, title, minWidth = 1100, labelWidth = 360 }: {
  data: { label: string; value: number }[];
  title: string;
  minWidth?: number;
  labelWidth?: number;
}) {
  const rowHeight = 42, topPad = 20, bottomPad = 20;
  const chartWidth = minWidth;
  const innerWidth = chartWidth - labelWidth - 40;
  const chartHeight = Math.max(320, topPad + bottomPad + data.length * rowHeight);
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const tickValues = Array.from({ length: 5 }, (_, i) => Math.round((maxValue / 4) * i));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: `${minWidth}px` }}>
          {tickValues.map((tick, i) => {
            const x = labelWidth + (tick / maxValue) * innerWidth;
            return (
              <g key={i}>
                <line x1={x} y1={topPad} x2={x} y2={chartHeight - bottomPad} stroke="#e2e8f0" strokeWidth="1" />
                <text x={x} y={topPad - 6} textAnchor="middle" fontSize="11" fill="#64748b">{tick}</text>
              </g>
            );
          })}
          {data.map((item, i) => {
            const y = topPad + i * rowHeight;
            const barWidth = (item.value / maxValue) * innerWidth;
            return (
              <g key={`${item.label}-${i}`}>
                <text x={labelWidth - 12} y={y + 16} textAnchor="end" fontSize="12" fill="#334155">
                  {truncateLabel(item.label, 44)}<title>{item.label}</title>
                </text>
                <rect x={labelWidth} y={y} width={barWidth} height={24} rx="4" fill="#4a83e7" />
                <text x={labelWidth + barWidth + 8} y={y + 16} fontSize="12" fontWeight="700" fill="#2563eb">{item.value}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function KeheDashboardView() {
  const [activeTab, setActiveTab] = useState<TabKey>("analytics");
  const [velocitySubTab, setVelocitySubTab] = useState<VelocitySubTabKey>("best-selling-store");
  const [pulloutSubTab, setPulloutSubTab] = useState<PulloutSubTabKey>("by-retailer-area");

  // velocity filters
  const [bestStorePeriodMode, setBestStorePeriodMode] = useState<PeriodMode>("lastMonth");
  const [bestStoreFromMonth, setBestStoreFromMonth] = useState(getLastMonthInputValue());
  const [bestStoreToMonth, setBestStoreToMonth] = useState(getCurrentMonthInputValue());
  const [topN, setTopN] = useState<TopN>(10);
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");
  const [monthlyCasesPeriodMode, setMonthlyCasesPeriodMode] = useState<PeriodMode>("past12Months");
  const [monthlyCasesFromMonth, setMonthlyCasesFromMonth] = useState(getPastMonthsInputValue(11));
  const [monthlyCasesToMonth, setMonthlyCasesToMonth] = useState(getCurrentMonthInputValue());
  const [avgCakesPeriodMode, setAvgCakesPeriodMode] = useState<PeriodMode>("past12Months");
  const [avgCakesFromMonth, setAvgCakesFromMonth] = useState(getPastMonthsInputValue(11));
  const [avgCakesToMonth, setAvgCakesToMonth] = useState(getCurrentMonthInputValue());

  // pullout filters
  const [pulloutPeriodMode, setPulloutPeriodMode] = useState<PeriodMode>("custom");
  const [pulloutFromMonth, setPulloutFromMonth] = useState(getPastMonthsInputValue(5));
  const [pulloutToMonth, setPulloutToMonth] = useState(getCurrentMonthInputValue());
  const [pulloutRetailerFilter, setPulloutRetailerFilter] = useState("All Retailers");
  const [pulloutCustomerFilter, setPulloutCustomerFilter] = useState("All Customers");
  const [pulloutSearchQuery, setPulloutSearchQuery] = useState("");

  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const pageSize = 1000;
        let from = 0;
        let all: VelocityRow[] = [];
        while (true) {
          const { data, error } = await supabase.from("kehe_velocity").select("*").range(from, from + pageSize - 1);
          if (error) throw error;
          const batch = (data ?? []) as VelocityRow[];
          all = [...all, ...batch];
          if (batch.length < pageSize) break;
          from += pageSize;
        }
        setRows(all);
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load KEHE velocity data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const retailerOptions = useMemo(() => [
    "All Retailers",
    ...Array.from(new Set(rows.map((r) => String(r.retailer || "").replace(/\u00a0/g, " ").trim()).filter(Boolean))).sort(),
  ], [rows]);

  // selected months
  const bestStoreSelectedMonths = useMemo(() => {
    if (bestStorePeriodMode === "lastMonth") return [normalizeMonthLabel(getLastMonthLabel())];
    if (bestStorePeriodMode === "past12Months") return buildPast12MonthsRange().map(normalizeMonthLabel);
    return buildMonthRange(bestStoreFromMonth, bestStoreToMonth).map(normalizeMonthLabel);
  }, [bestStorePeriodMode, bestStoreFromMonth, bestStoreToMonth]);

  const monthlyCasesSelectedMonths = useMemo(() => {
    if (monthlyCasesPeriodMode === "lastMonth") return [normalizeMonthLabel(getLastMonthLabel())];
    if (monthlyCasesPeriodMode === "past12Months") return buildPast12MonthsRange().map(normalizeMonthLabel);
    return buildMonthRange(monthlyCasesFromMonth, monthlyCasesToMonth).map(normalizeMonthLabel);
  }, [monthlyCasesPeriodMode, monthlyCasesFromMonth, monthlyCasesToMonth]);

  const avgCakesSelectedMonths = useMemo(() => {
    if (avgCakesPeriodMode === "lastMonth") return [normalizeMonthLabel(getLastMonthLabel())];
    if (avgCakesPeriodMode === "past12Months") return buildPast12MonthsRange().map(normalizeMonthLabel);
    return buildMonthRange(avgCakesFromMonth, avgCakesToMonth).map(normalizeMonthLabel);
  }, [avgCakesPeriodMode, avgCakesFromMonth, avgCakesToMonth]);

  const pulloutSelectedMonths = useMemo(() => {
    if (pulloutPeriodMode === "lastMonth") return [normalizeMonthLabel(getLastMonthLabel())];
    if (pulloutPeriodMode === "past12Months") return buildPast12MonthsRange().map(normalizeMonthLabel);
    return buildMonthRange(pulloutFromMonth, pulloutToMonth).map(normalizeMonthLabel);
  }, [pulloutPeriodMode, pulloutFromMonth, pulloutToMonth]);

  // velocity data
  const bestStoreRows = useMemo(() => rows.filter((row) => {
    const rowMonth = normalizeMonthLabel(row.month);
    const rowRetailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
    return bestStoreSelectedMonths.includes(rowMonth) &&
      (retailerFilter === "All Retailers" || rowRetailer === retailerFilter);
  }), [rows, bestStoreSelectedMonths, retailerFilter]);

  const topSellingStores = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const row of bestStoreRows) {
      if (!row.customer) continue;
      grouped.set(row.customer, (grouped.get(row.customer) || 0) + Number(row.cases || 0));
    }
    return Array.from(grouped.entries())
      .map(([customer, totalCases]) => ({ customer, totalCases }))
      .sort((a, b) => b.totalCases - a.totalCases)
      .slice(0, topN);
  }, [bestStoreRows, topN]);

  const monthlyCasesRows = useMemo(() =>
    rows.filter((row) => monthlyCasesSelectedMonths.includes(normalizeMonthLabel(row.month))),
    [rows, monthlyCasesSelectedMonths]);

  const monthlyCasesSeries = useMemo(() => {
    const sortedMonths = [...monthlyCasesSelectedMonths].sort(compareMonthLabelsAsc)
      .filter((m) => monthlyCasesRows.some((r) => normalizeMonthLabel(r.month) === m));
    const retailerNames = ["Kroger", "Fresh Thyme", "INFRA & Others"];
    const colors: Record<string, string> = { Kroger: "#123f73", "Fresh Thyme": "#f59e0b", "INFRA & Others": "#60c7df" };
    const grouped: Record<string, Record<string, number>> = {};
    for (const m of sortedMonths) { grouped[m] = {}; for (const r of retailerNames) grouped[m][r] = 0; }
    for (const row of monthlyCasesRows) {
      const m = normalizeMonthLabel(row.month);
      const r = String(row.retailer || "").replace(/\u00a0/g, " ").trim() || "Unknown";
      if (!grouped[m]) grouped[m] = {};
      grouped[m][r] = (grouped[m][r] || 0) + Number(row.cases || 0);
    }
    return { months: sortedMonths, series: retailerNames.map((r) => ({ name: r, fill: colors[r] || "#4a83e7", values: sortedMonths.map((m) => grouped[m]?.[r] || 0) })) };
  }, [monthlyCasesRows, monthlyCasesSelectedMonths]);

  const avgCakesRows = useMemo(() =>
    rows.filter((row) => avgCakesSelectedMonths.includes(normalizeMonthLabel(row.month))),
    [rows, avgCakesSelectedMonths]);

  const averageCakesPerWeekSeries = useMemo(() => {
    const sortedMonths = [...avgCakesSelectedMonths].sort(compareMonthLabelsAsc)
      .filter((m) => avgCakesRows.some((r) => normalizeMonthLabel(r.month) === m));
    const cakeNames = Array.from(new Set(avgCakesRows.map((r) => getCakeSeriesName(r.description)).filter(Boolean)))
      .sort((a, b) => { const w = getCakeSortWeight(a) - getCakeSortWeight(b); return w !== 0 ? w : a.localeCompare(b); });
    const palette = ["#123f73", "#f59e0b", "#60c7df", "#7c3aed", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6"];
    const grouped: Record<string, Record<string, number>> = {};
    for (const m of sortedMonths) { grouped[m] = {}; for (const c of cakeNames) grouped[m][c] = 0; }
    for (const row of avgCakesRows) {
      const m = normalizeMonthLabel(row.month);
      const c = getCakeSeriesName(row.description);
      if (!c || !grouped[m]) continue;
      grouped[m][c] = (grouped[m][c] || 0) + Number(row.eaches || 0);
    }
    return { months: sortedMonths, series: cakeNames.map((c, i) => ({ name: c, fill: palette[i % palette.length], values: sortedMonths.map((m) => Number(((grouped[m]?.[c] || 0) / 4).toFixed(1))) })) };
  }, [avgCakesRows, avgCakesSelectedMonths]);

  // pullout base rows (month + retailer)
  const pulloutRows = useMemo(() => rows.filter((row) => {
    const rowMonth = normalizeMonthLabel(row.month);
    const rowRetailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
    return pulloutSelectedMonths.includes(rowMonth) &&
      (pulloutRetailerFilter === "All Retailers" || rowRetailer === pulloutRetailerFilter);
  }), [rows, pulloutSelectedMonths, pulloutRetailerFilter]);

  // customer options derived from pullout base rows
  const customerOptions = useMemo(() => [
    "All Customers",
    ...Array.from(new Set(pulloutRows.map((r) => String(r.customer || "").trim()).filter(Boolean))).sort(),
  ], [pulloutRows]);

  // reset customer when retailer changes
  useEffect(() => { setPulloutCustomerFilter("All Customers"); }, [pulloutRetailerFilter]);
  // reset search when switching sub-tab
  useEffect(() => { setPulloutSearchQuery(""); }, [pulloutSubTab]);

  // by area table
  const pulloutByAreaTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const grouped = new Map<string, { retailer: string; retailer_area: string; months: Record<string, number>; total: number }>();
    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}`;
      if (!grouped.has(key)) grouped.set(key, { retailer, retailer_area: retailerArea, months: {}, total: 0 });
      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }
    return { monthColumns, rows: Array.from(grouped.values()).sort((a, b) => b.total - a.total) };
  }, [pulloutRows, pulloutSelectedMonths]);

  // by store table
  const pulloutByStoreTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const filtered = pulloutRows.filter((row) => {
      const customer = String(row.customer || "").trim();
      return pulloutCustomerFilter === "All Customers" || customer === pulloutCustomerFilter;
    });
    const grouped = new Map<string, { retailer: string; retailer_area: string; customer: string; months: Record<string, number>; total: number }>();
    for (const row of filtered) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}__${customer}`;
      if (!grouped.has(key)) grouped.set(key, { retailer, retailer_area: retailerArea, customer, months: {}, total: 0 });
      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }
    return { monthColumns, rows: Array.from(grouped.values()).sort((a, b) => b.total - a.total) };
  }, [pulloutRows, pulloutSelectedMonths, pulloutCustomerFilter]);

  // search-filtered rows
  const filteredByAreaRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByAreaTable.rows;
    return pulloutByAreaTable.rows.filter((r) =>
      r.retailer.toLowerCase().includes(q) || r.retailer_area.toLowerCase().includes(q)
    );
  }, [pulloutByAreaTable.rows, pulloutSearchQuery]);

  const filteredByStoreRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByStoreTable.rows;
    return pulloutByStoreTable.rows.filter((r) =>
      r.retailer.toLowerCase().includes(q) ||
      r.retailer_area.toLowerCase().includes(q) ||
      r.customer.toLowerCase().includes(q)
    );
  }, [pulloutByStoreTable.rows, pulloutSearchQuery]);

  // ── Render helpers ──────────────────────────────────────────────────────────
  const renderTabButtons = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["analytics", "velocity", "pullout"] as TabKey[]).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium capitalize transition ${activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {tab === "pullout" ? "Pull out" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );

  const renderVelocitySubTabs = () => (
    <div className="flex flex-wrap gap-2">
      {([
        ["best-selling-store", "Best Selling Store"],
        ["total-cases-per-month", "Total Cases Per Month"],
        ["overall-average-cakes-per-week", "Overall: Average Cakes Per Week"],
      ] as [VelocitySubTabKey, string][]).map(([key, label]) => (
        <button key={key} type="button" onClick={() => setVelocitySubTab(key)}
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${velocitySubTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  const renderPulloutSubTabs = () => (
    <div className="flex flex-wrap gap-2">
      {([
        ["by-retailer-area", "Monthly Cases by Retailer Area"],
        ["by-retailer-store", "Monthly Cases by Retailer Store"],
      ] as [PulloutSubTabKey, string][]).map(([key, label]) => (
        <button key={key} type="button" onClick={() => setPulloutSubTab(key)}
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${pulloutSubTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  const renderVelocityFilters = () => {
    if (velocitySubTab === "best-selling-store") return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[160px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Retailer</label>
          <select value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            {retailerOptions.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Show Top</label>
          <select value={topN} onChange={(e) => setTopN(Number(e.target.value) as TopN)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            {[5, 10, 15, 20].map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
          <select value={bestStorePeriodMode} onChange={(e) => setBestStorePeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            <option value="lastMonth">Last Month</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {bestStorePeriodMode === "custom" && <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
            <input type="month" value={bestStoreFromMonth} onChange={(e) => setBestStoreFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input type="month" value={bestStoreToMonth} onChange={(e) => setBestStoreToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
        </>}
      </div>
    );

    if (velocitySubTab === "total-cases-per-month") return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
          <select value={monthlyCasesPeriodMode} onChange={(e) => setMonthlyCasesPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            <option value="past12Months">Past 12 Months</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {monthlyCasesPeriodMode === "custom" && <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
            <input type="month" value={monthlyCasesFromMonth} onChange={(e) => setMonthlyCasesFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input type="month" value={monthlyCasesToMonth} onChange={(e) => setMonthlyCasesToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
        </>}
      </div>
    );

    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
          <select value={avgCakesPeriodMode} onChange={(e) => setAvgCakesPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            <option value="past12Months">Past 12 Months</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {avgCakesPeriodMode === "custom" && <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
            <input type="month" value={avgCakesFromMonth} onChange={(e) => setAvgCakesFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input type="month" value={avgCakesToMonth} onChange={(e) => setAvgCakesToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
        </>}
      </div>
    );
  };

  const renderPulloutFilters = () => (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">Retailer</label>
        <select value={pulloutRetailerFilter} onChange={(e) => setPulloutRetailerFilter(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
          {retailerOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>

      {/* Customer filter only on by-retailer-store */}
      {pulloutSubTab === "by-retailer-store" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Customer</label>
          <SearchableSelect
            options={customerOptions}
            value={pulloutCustomerFilter}
            onChange={setPulloutCustomerFilter}
            placeholder="Search customer..."
          />
        </div>
      )}

      <div className="min-w-[210px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
        <select value={pulloutPeriodMode} onChange={(e) => setPulloutPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
          <option value="custom">Past 6 Months / Custom</option>
          <option value="lastMonth">Last Month</option>
        </select>
      </div>
      {pulloutPeriodMode === "custom" && <>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
          <input type="month" value={pulloutFromMonth} onChange={(e) => setPulloutFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
          <input type="month" value={pulloutToMonth} onChange={(e) => setPulloutToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
        </div>
      </>}
    </div>
  );

  const renderPulloutTable = () => {
    if (loading) return <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading KEHE velocity data...</div>;
    if (loadError) return <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">{loadError}</div>;

    const isArea = pulloutSubTab === "by-retailer-area";
    const monthColumns = isArea ? pulloutByAreaTable.monthColumns : pulloutByStoreTable.monthColumns;
    const tableRows = isArea ? filteredByAreaRows : filteredByStoreRows;
    const totalCount = isArea ? pulloutByAreaTable.rows.length : pulloutByStoreTable.rows.length;

    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Search bar */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={pulloutSearchQuery}
              onChange={(e) => setPulloutSearchQuery(e.target.value)}
              placeholder={isArea ? "Search retailer or area..." : "Search retailer, area or customer..."}
              className="h-10 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm outline-none focus:border-slate-400 focus:bg-white transition"
            />
            {pulloutSearchQuery && (
              <button type="button" onClick={() => setPulloutSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <span className="shrink-0 text-sm text-slate-400">
            {tableRows.length} of {totalCount} rows
          </span>
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Retailer</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Retailer Area</th>
                    {!isArea && <th className="px-4 py-3 text-left font-semibold text-slate-700">Customer</th>}
                    {monthColumns.map((m) => (
                      <th key={m} className="px-4 py-3 text-left font-semibold text-slate-700">{m}</th>
                    ))}
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-200 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                      {!isArea && "customer" in row && (
                        <td className="px-4 py-3 text-slate-700">{(row as any).customer}</td>
                      )}
                      {monthColumns.map((m) => (
                        <td key={m} className="px-4 py-3 text-slate-700">{row.months[m] || 0}</td>
                      ))}
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.total}</td>
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
    <div className="space-y-6">
      {activeTab === "analytics" && (
        <>
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">{renderTabButtons()}</div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold text-slate-900">Analytics</div>
            <p className="mt-2 text-sm text-slate-500">Analytics will be added next.</p>
          </div>
        </>
      )}

      {activeTab === "velocity" && (
        <>
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
            {renderTabButtons()}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold text-slate-900">Velocity</h2>
                  {renderVelocitySubTabs()}
                </div>
                {renderVelocityFilters()}
              </div>
            </div>
          </div>
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading KEHE velocity data...</div>
          ) : loadError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">{loadError}</div>
          ) : (
            <>
              {velocitySubTab === "best-selling-store" && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-xl font-semibold text-slate-900">Top Selling Store</h3>
                      <div className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">Top {topN}</div>
                    </div>
                    <div className="space-y-3">
                      {topSellingStores.length === 0 ? (
                        <div className="text-sm text-slate-500">No data found for the selected filters.</div>
                      ) : (
                        topSellingStores.map((item, i) => (
                          <div key={`${item.customer}-${i}`} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 px-4 py-3">
                            <div className="text-sm font-medium leading-5 text-slate-800">{item.customer}</div>
                            <div className="min-w-[56px] text-right text-sm font-bold text-slate-900">{item.totalCases}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <HorizontalBarChart title="Top Selling Store" data={topSellingStores.map((item) => ({ label: item.customer, value: item.totalCases }))} />
                </div>
              )}
              {velocitySubTab === "total-cases-per-month" && (
                <GroupedMonthlyChart title="Total Cases per Month per Retailer" months={monthlyCasesSeries.months} series={monthlyCasesSeries.series} />
              )}
              {velocitySubTab === "overall-average-cakes-per-week" && (
                <GroupedMonthlyChart title="Overall: Average Cakes per Week" months={averageCakesPerWeekSeries.months} series={averageCakesPerWeekSeries.series} />
              )}
            </>
          )}
        </>
      )}

      {activeTab === "pullout" && (
        <>
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
            {renderTabButtons()}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-col gap-3">
                  {renderPulloutSubTabs()}
                </div>
                {renderPulloutFilters()}
              </div>
            </div>
          </div>
          {renderPulloutTable()}
        </>
      )}
    </div>
  );
}