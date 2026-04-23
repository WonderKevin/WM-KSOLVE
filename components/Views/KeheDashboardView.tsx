"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TabKey = "analytics" | "velocity" | "pullout";
type VelocitySubTabKey =
  | "best-selling-store"
  | "total-cases-per-month"
  | "overall-average-cakes-per-week";
type PulloutSubTabKey = "by-retailer-area" | "by-retailer-store";
type PeriodMode = "lastMonth" | "custom" | "past6Months" | "past12Months";
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

type PriorityLevel = "High" | "Medium" | "Low";

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
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(
    date.getFullYear()
  ).slice(-2)}`;
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

function buildPastNMonthsRange(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) =>
    monthLabelFromDate(
      new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)
    )
  );
}

function truncateLabel(value: string, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-US");
}

function getPriorityBadgeClass(priority: PriorityLevel) {
  if (priority === "High") {
    return "bg-red-100 text-red-700 border-red-200";
  }
  if (priority === "Medium") {
    return "bg-amber-100 text-amber-700 border-amber-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function exportToExcel({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.search(/[",\n]/) >= 0 ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
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

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
  allLabel = "All Customers",
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const nonAllOptions = useMemo(
    () => options.filter((o) => o !== allLabel),
    [options, allLabel]
  );

  const filtered = useMemo(
    () =>
      nonAllOptions.filter((o) =>
        o.toLowerCase().includes(query.toLowerCase())
      ),
    [nonAllOptions, query]
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

  const isAll = value === allLabel;

  return (
    <div ref={ref} className="relative min-w-[200px]">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 outline-none transition hover:border-slate-300"
      >
        <span className="truncate">{value}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
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
        <div className="absolute z-50 mt-1 w-full min-w-[260px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>

          {!query && (
            <div className="border-b border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onChange(allLabel);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isAll
                      ? "border-slate-800 bg-slate-800"
                      : "border-slate-300"
                  }`}
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
                (Select All)
              </button>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">No results</div>
            ) : (
              filtered.map((option) => {
                const selected = value === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected
                          ? "border-slate-800 bg-slate-800"
                          : "border-slate-300"
                      }`}
                    >
                      {selected && (
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
                    {option}
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
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
        className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition focus:border-slate-400"
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

function GroupedMonthlyChart({
  title,
  months,
  series,
}: {
  title: string;
  months: string[];
  series: { name: string; values: number[]; fill: string }[];
}) {
  const chartHeight = 360;
  const chartWidth = Math.max(980, 140 + months.length * 120);
  const leftPad = 55;
  const rightPad = 20;
  const topPad = 20;
  const bottomPad = 95;
  const innerWidth = chartWidth - leftPad - rightPad;
  const innerHeight = chartHeight - topPad - bottomPad;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const groupWidth = months.length > 0 ? innerWidth / months.length : innerWidth;
  const barGap = 6;
  const groupInnerPadding = 12;
  const barWidth = Math.max(
    14,
    (groupWidth -
      groupInnerPadding * 2 -
      barGap * Math.max(series.length - 1, 0)) /
      Math.max(series.length, 1)
  );

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
              <line
                x1={leftPad}
                y1={tick.y}
                x2={chartWidth - rightPad}
                y2={tick.y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={leftPad - 10}
                y={tick.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
              >
                {tick.value}
              </text>
            </g>
          ))}

          <line
            x1={leftPad}
            y1={topPad + innerHeight}
            x2={chartWidth - rightPad}
            y2={topPad + innerHeight}
            stroke="#94a3b8"
            strokeWidth="1.5"
          />

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
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        rx="3"
                        fill={item.fill}
                      />
                      <text
                        x={x + barWidth / 2}
                        y={y - 6}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill={item.fill}
                      >
                        {value}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={leftPad + mi * groupWidth + groupWidth / 2}
                  y={topPad + innerHeight + 18}
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
          <div key={item.name} className="flex items-center gap-2 text-sm text-slate-600">
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
  const rowHeight = 42;
  const topPad = 20;
  const bottomPad = 20;
  const chartWidth = minWidth;
  const innerWidth = chartWidth - labelWidth - 40;
  const chartHeight = Math.max(320, topPad + bottomPad + data.length * rowHeight);
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const tickValues = Array.from({ length: 5 }, (_, i) =>
    Math.round((maxValue / 4) * i)
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: `${minWidth}px` }}>
          {tickValues.map((tick, i) => {
            const x = labelWidth + (tick / maxValue) * innerWidth;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={topPad}
                  x2={x}
                  y2={chartHeight - bottomPad}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={topPad - 6}
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
            const y = topPad + i * rowHeight;
            const barWidth = (item.value / maxValue) * innerWidth;
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
                  width={barWidth}
                  height={24}
                  rx="4"
                  fill="#4a83e7"
                />

                <text
                  x={labelWidth + barWidth + 8}
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

function InsightCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

export default function KeheDashboardView() {
  const [activeTab, setActiveTab] = useState<TabKey>("analytics");
  const [velocitySubTab, setVelocitySubTab] =
    useState<VelocitySubTabKey>("best-selling-store");
  const [pulloutSubTab, setPulloutSubTab] =
    useState<PulloutSubTabKey>("by-retailer-area");

  const [bestStorePeriodMode, setBestStorePeriodMode] =
    useState<PeriodMode>("lastMonth");
  const [bestStoreFromMonth, setBestStoreFromMonth] = useState(
    getLastMonthInputValue()
  );
  const [bestStoreToMonth, setBestStoreToMonth] = useState(
    getCurrentMonthInputValue()
  );
  const [topN, setTopN] = useState<TopN>(10);
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");

  const [monthlyCasesPeriodMode, setMonthlyCasesPeriodMode] =
    useState<PeriodMode>("past12Months");
  const [monthlyCasesFromMonth, setMonthlyCasesFromMonth] = useState(
    getPastMonthsInputValue(11)
  );
  const [monthlyCasesToMonth, setMonthlyCasesToMonth] = useState(
    getCurrentMonthInputValue()
  );

  const [avgCakesPeriodMode, setAvgCakesPeriodMode] =
    useState<PeriodMode>("past12Months");
  const [avgCakesFromMonth, setAvgCakesFromMonth] = useState(
    getPastMonthsInputValue(11)
  );
  const [avgCakesToMonth, setAvgCakesToMonth] = useState(
    getCurrentMonthInputValue()
  );

  const [pulloutPeriodMode, setPulloutPeriodMode] =
    useState<PeriodMode>("past6Months");
  const [pulloutFromMonth, setPulloutFromMonth] = useState(
    getPastMonthsInputValue(5)
  );
  const [pulloutToMonth, setPulloutToMonth] = useState(getCurrentMonthInputValue());
  const [pulloutRetailerFilter, setPulloutRetailerFilter] =
    useState("All Retailers");
  const [pulloutCustomerFilter, setPulloutCustomerFilter] =
    useState("All Customers");
  const [pulloutSearchQuery, setPulloutSearchQuery] = useState("");

  const [analyticsPeriodMode, setAnalyticsPeriodMode] =
    useState<PeriodMode>("past6Months");
  const [analyticsFromMonth, setAnalyticsFromMonth] = useState(
    getPastMonthsInputValue(5)
  );
  const [analyticsToMonth, setAnalyticsToMonth] = useState(
    getCurrentMonthInputValue()
  );
  const [analyticsRetailerFilter, setAnalyticsRetailerFilter] =
    useState("All Retailers");

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
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load KEHE velocity data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const retailerOptions = useMemo(
    () => [
      "All Retailers",
      ...Array.from(
        new Set(
          rows
            .map((r) => String(r.retailer || "").replace(/\u00a0/g, " ").trim())
            .filter(Boolean)
        )
      ).sort(),
    ],
    [rows]
  );

  const bestStoreSelectedMonths = useMemo(() => {
    if (bestStorePeriodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }
    if (bestStorePeriodMode === "past12Months") {
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    }
    if (bestStorePeriodMode === "past6Months") {
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    }
    return buildMonthRange(bestStoreFromMonth, bestStoreToMonth).map(
      normalizeMonthLabel
    );
  }, [bestStorePeriodMode, bestStoreFromMonth, bestStoreToMonth]);

  const monthlyCasesSelectedMonths = useMemo(() => {
    if (monthlyCasesPeriodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }
    if (monthlyCasesPeriodMode === "past12Months") {
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    }
    if (monthlyCasesPeriodMode === "past6Months") {
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    }
    return buildMonthRange(monthlyCasesFromMonth, monthlyCasesToMonth).map(
      normalizeMonthLabel
    );
  }, [monthlyCasesPeriodMode, monthlyCasesFromMonth, monthlyCasesToMonth]);

  const avgCakesSelectedMonths = useMemo(() => {
    if (avgCakesPeriodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }
    if (avgCakesPeriodMode === "past12Months") {
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    }
    if (avgCakesPeriodMode === "past6Months") {
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    }
    return buildMonthRange(avgCakesFromMonth, avgCakesToMonth).map(
      normalizeMonthLabel
    );
  }, [avgCakesPeriodMode, avgCakesFromMonth, avgCakesToMonth]);

  const pulloutSelectedMonths = useMemo(() => {
    if (pulloutPeriodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }
    if (pulloutPeriodMode === "past12Months") {
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    }
    if (pulloutPeriodMode === "past6Months") {
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    }
    return buildMonthRange(pulloutFromMonth, pulloutToMonth).map(
      normalizeMonthLabel
    );
  }, [pulloutPeriodMode, pulloutFromMonth, pulloutToMonth]);

  const analyticsSelectedMonths = useMemo(() => {
    if (analyticsPeriodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }
    if (analyticsPeriodMode === "past12Months") {
      return buildPastNMonthsRange(12).map(normalizeMonthLabel);
    }
    if (analyticsPeriodMode === "past6Months") {
      return buildPastNMonthsRange(6).map(normalizeMonthLabel);
    }
    return buildMonthRange(analyticsFromMonth, analyticsToMonth).map(
      normalizeMonthLabel
    );
  }, [analyticsPeriodMode, analyticsFromMonth, analyticsToMonth]);

  const bestStoreRows = useMemo(() => {
    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();
      return (
        bestStoreSelectedMonths.includes(rowMonth) &&
        (retailerFilter === "All Retailers" || rowRetailer === retailerFilter)
      );
    });
  }, [rows, bestStoreSelectedMonths, retailerFilter]);

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

  const monthlyCasesRows = useMemo(
    () =>
      rows.filter((row) =>
        monthlyCasesSelectedMonths.includes(normalizeMonthLabel(row.month))
      ),
    [rows, monthlyCasesSelectedMonths]
  );

  const monthlyCasesSeries = useMemo(() => {
    const sortedMonths = [...monthlyCasesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((m) =>
        monthlyCasesRows.some((r) => normalizeMonthLabel(r.month) === m)
      );

    const retailerNames = ["Kroger", "Fresh Thyme", "INFRA & Others"];

    const colors: Record<string, string> = {
      Kroger: "#123f73",
      "Fresh Thyme": "#f59e0b",
      "INFRA & Others": "#60c7df",
    };

    const grouped: Record<string, Record<string, number>> = {};

    for (const m of sortedMonths) {
      grouped[m] = {};
      for (const r of retailerNames) grouped[m][r] = 0;
    }

    for (const row of monthlyCasesRows) {
      const m = normalizeMonthLabel(row.month);
      const r =
        String(row.retailer || "").replace(/\u00a0/g, " ").trim() || "Unknown";
      if (!grouped[m]) grouped[m] = {};
      grouped[m][r] = (grouped[m][r] || 0) + Number(row.cases || 0);
    }

    return {
      months: sortedMonths,
      series: retailerNames.map((r) => ({
        name: r,
        fill: colors[r] || "#4a83e7",
        values: sortedMonths.map((m) => grouped[m]?.[r] || 0),
      })),
    };
  }, [monthlyCasesRows, monthlyCasesSelectedMonths]);

  const avgCakesRows = useMemo(
    () =>
      rows.filter((row) =>
        avgCakesSelectedMonths.includes(normalizeMonthLabel(row.month))
      ),
    [rows, avgCakesSelectedMonths]
  );

  const averageCakesPerWeekSeries = useMemo(() => {
    const sortedMonths = [...avgCakesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((m) => avgCakesRows.some((r) => normalizeMonthLabel(r.month) === m));

    const cakeNames = Array.from(
      new Set(
        avgCakesRows.map((r) => getCakeSeriesName(r.description)).filter(Boolean)
      )
    ).sort((a, b) => {
      const w = getCakeSortWeight(a) - getCakeSortWeight(b);
      return w !== 0 ? w : a.localeCompare(b);
    });

    const palette = [
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

    const grouped: Record<string, Record<string, number>> = {};

    for (const m of sortedMonths) {
      grouped[m] = {};
      for (const c of cakeNames) grouped[m][c] = 0;
    }

    for (const row of avgCakesRows) {
      const m = normalizeMonthLabel(row.month);
      const c = getCakeSeriesName(row.description);
      if (!c || !grouped[m]) continue;
      grouped[m][c] = (grouped[m][c] || 0) + Number(row.eaches || 0);
    }

    return {
      months: sortedMonths,
      series: cakeNames.map((c, i) => ({
        name: c,
        fill: palette[i % palette.length],
        values: sortedMonths.map((m) =>
          Number(((grouped[m]?.[c] || 0) / 4).toFixed(1))
        ),
      })),
    };
  }, [avgCakesRows, avgCakesSelectedMonths]);

  const pulloutRows = useMemo(() => {
    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();
      return (
        pulloutSelectedMonths.includes(rowMonth) &&
        (pulloutRetailerFilter === "All Retailers" ||
          rowRetailer === pulloutRetailerFilter)
      );
    });
  }, [rows, pulloutSelectedMonths, pulloutRetailerFilter]);

  const customerOptions = useMemo(
    () => [
      "All Customers",
      ...Array.from(
        new Set(
          pulloutRows.map((r) => String(r.customer || "").trim()).filter(Boolean)
        )
      ).sort(),
    ],
    [pulloutRows]
  );

  useEffect(() => {
    setPulloutCustomerFilter("All Customers");
  }, [pulloutRetailerFilter]);

  useEffect(() => {
    setPulloutSearchQuery("");
  }, [pulloutSubTab]);

  const pulloutByAreaTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const grouped = new Map<
      string,
      {
        retailer: string;
        retailer_area: string;
        months: Record<string, number>;
        total: number;
      }
    >();

    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          retailer,
          retailer_area: retailerArea,
          months: {},
          total: 0,
        });
      }

      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }

    return {
      monthColumns,
      rows: Array.from(grouped.values()).sort((a, b) => b.total - a.total),
    };
  }, [pulloutRows, pulloutSelectedMonths]);

  const pulloutByStoreTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);

    const filtered = pulloutRows.filter((row) => {
      const customer = String(row.customer || "").trim();
      return (
        pulloutCustomerFilter === "All Customers" ||
        customer === pulloutCustomerFilter
      );
    });

    const grouped = new Map<
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
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}__${customer}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          retailer,
          retailer_area: retailerArea,
          customer,
          months: {},
          total: 0,
        });
      }

      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }

    return {
      monthColumns,
      rows: Array.from(grouped.values()).sort((a, b) => b.total - a.total),
    };
  }, [pulloutRows, pulloutSelectedMonths, pulloutCustomerFilter]);

  const filteredByAreaRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByAreaTable.rows;
    return pulloutByAreaTable.rows.filter(
      (r) =>
        r.retailer.toLowerCase().includes(q) ||
        r.retailer_area.toLowerCase().includes(q)
    );
  }, [pulloutByAreaTable.rows, pulloutSearchQuery]);

  const filteredByStoreRows = useMemo(() => {
    const q = pulloutSearchQuery.trim().toLowerCase();
    if (!q) return pulloutByStoreTable.rows;
    return pulloutByStoreTable.rows.filter(
      (r) =>
        r.retailer.toLowerCase().includes(q) ||
        r.retailer_area.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q)
    );
  }, [pulloutByStoreTable.rows, pulloutSearchQuery]);

  const analyticsRows = useMemo(() => {
    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();

      return (
        analyticsSelectedMonths.includes(rowMonth) &&
        (analyticsRetailerFilter === "All Retailers" ||
          rowRetailer === analyticsRetailerFilter)
      );
    });
  }, [rows, analyticsSelectedMonths, analyticsRetailerFilter]);

  const analyticsData = useMemo(() => {
    const months = [...analyticsSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((month) =>
        analyticsRows.some((row) => normalizeMonthLabel(row.month) === month)
      );

    const latestMonth = months[months.length - 1] || "";
    const latestMonthIndex = months.length - 1;
    const recentThreeMonths = months.slice(Math.max(0, months.length - 3));
    const previousThreeMonths = months.slice(
      Math.max(0, months.length - 6),
      Math.max(0, months.length - 3)
    );

    const accountMap = new Map<
      string,
      {
        retailer: string;
        retailerArea: string;
        customer: string;
        monthlyCases: Record<string, number>;
        totalCases: number;
        lastActiveMonth: string;
        activeMonths: number;
      }
    >();

    for (const row of analyticsRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}__${customer}`;

      if (!accountMap.has(key)) {
        accountMap.set(key, {
          retailer,
          retailerArea,
          customer,
          monthlyCases: {},
          totalCases: 0,
          lastActiveMonth: "",
          activeMonths: 0,
        });
      }

      const item = accountMap.get(key)!;
      item.monthlyCases[month] = (item.monthlyCases[month] || 0) + Number(row.cases || 0);
      item.totalCases += Number(row.cases || 0);
    }

    const accounts = Array.from(accountMap.values()).map((item) => {
      let activeMonths = 0;
      let lastActiveMonth = "";
      let latestCases = 0;
      let previousMonthCases = 0;
      let recent3MonthCases = 0;
      let previous3MonthCases = 0;

      months.forEach((month, idx) => {
        const value = item.monthlyCases[month] || 0;
        if (value > 0) {
          activeMonths += 1;
          lastActiveMonth = month;
        }
        if (idx === latestMonthIndex) latestCases = value;
        if (idx === latestMonthIndex - 1) previousMonthCases = value;
      });

      for (const month of recentThreeMonths) {
        recent3MonthCases += item.monthlyCases[month] || 0;
      }

      for (const month of previousThreeMonths) {
        previous3MonthCases += item.monthlyCases[month] || 0;
      }

      const lastActiveIndex = months.findIndex((m) => m === lastActiveMonth);
      const monthsSinceActive =
        lastActiveMonth && lastActiveIndex >= 0
          ? months.length - 1 - lastActiveIndex
          : months.length;

      const droppedToZeroThisMonth =
        latestCases === 0 && (previousMonthCases > 0 || previous3MonthCases > 0);

      const averagePrev3 =
        previousThreeMonths.length > 0
          ? previous3MonthCases / previousThreeMonths.length
          : 0;

      const declineVsPrev3 =
        averagePrev3 > 0 ? (latestCases - averagePrev3) / averagePrev3 : 0;

      let priority: PriorityLevel = "Low";

      if (
        (monthsSinceActive >= 3 && item.totalCases >= 20) ||
        (droppedToZeroThisMonth && previous3MonthCases >= 15) ||
        (latestCases === 0 && recent3MonthCases === 0 && previous3MonthCases >= 25)
      ) {
        priority = "High";
      } else if (
        (latestCases < previousMonthCases && previousMonthCases >= 5) ||
        (declineVsPrev3 <= -0.5 && previous3MonthCases >= 10) ||
        item.totalCases >= 15
      ) {
        priority = "Medium";
      }

      let opportunityType = "Watchlist";
      if (monthsSinceActive >= 3 && item.totalCases >= 20) {
        opportunityType = "Reactivation";
      } else if (droppedToZeroThisMonth && previous3MonthCases >= 15) {
        opportunityType = "Recent pullout";
      } else if (declineVsPrev3 <= -0.5 && latestCases > 0) {
        opportunityType = "Declining account";
      } else if (latestCases > 0 && recent3MonthCases >= 20) {
        opportunityType = "Core active account";
      }

      let strategy = "Monitor and validate local demand.";
      if (opportunityType === "Reactivation") {
        strategy =
          "Treat as a high-priority win-back. Confirm why the account stopped ordering and whether distribution, shelf set, or buyer-level decisions changed.";
      } else if (opportunityType === "Recent pullout") {
        strategy =
          "Investigate as a recent store-level or area-level pullout. Check whether this is a temporary ordering gap, OOS issue, or removal from set.";
      } else if (opportunityType === "Declining account") {
        strategy =
          "Stabilize the account before it fully stops. Confirm merchandising, inventory, and replenishment issues.";
      } else if (opportunityType === "Core active account") {
        strategy =
          "Protect and grow. Use current velocity to identify duplicate distribution opportunities nearby.";
      }

      let routeToMarket = "Start with store/distributor contact.";
      if (item.retailer.toLowerCase().includes("kroger")) {
        routeToMarket =
          "Work both the distributor and banner contact. Escalate to buyer if multiple stores in the same area show the same pattern.";
      } else if (item.retailer.toLowerCase().includes("fresh thyme")) {
        routeToMarket =
          "Start with local store follow-up, then distributor. Escalate if multiple stores in one area are down.";
      }

      const signalParts = [
        latestCases === 0 ? `0 cases in ${latestMonth}` : `${latestCases} cases in ${latestMonth}`,
        previous3MonthCases > 0
          ? `${formatNumber(previous3MonthCases)} cases in prior 3 months`
          : "",
        monthsSinceActive >= 1 ? `${monthsSinceActive} month(s) since last order` : "still active",
      ].filter(Boolean);

      return {
        ...item,
        activeMonths,
        lastActiveMonth,
        latestCases,
        previousMonthCases,
        recent3MonthCases,
        previous3MonthCases,
        averagePrev3,
        declineVsPrev3,
        monthsSinceActive,
        droppedToZeroThisMonth,
        priority,
        opportunityType,
        strategy,
        routeToMarket,
        signal: signalParts.join(" • "),
      };
    });

    const rankedPriorityAccounts = [...accounts].sort((a, b) => {
      const priorityWeight = (p: PriorityLevel) =>
        p === "High" ? 3 : p === "Medium" ? 2 : 1;
      if (priorityWeight(b.priority) !== priorityWeight(a.priority)) {
        return priorityWeight(b.priority) - priorityWeight(a.priority);
      }
      if (b.previous3MonthCases !== a.previous3MonthCases) {
        return b.previous3MonthCases - a.previous3MonthCases;
      }
      return b.totalCases - a.totalCases;
    });

    const reactivationAccounts = accounts
      .filter((a) => a.monthsSinceActive >= 3 && a.totalCases >= 20)
      .sort((a, b) => b.totalCases - a.totalCases);

    const highPriority = rankedPriorityAccounts.filter((a) => a.priority === "High");
    const mediumPriority = rankedPriorityAccounts.filter(
      (a) => a.priority === "Medium"
    );
    const lowPriority = rankedPriorityAccounts.filter((a) => a.priority === "Low");

    const areaMap = new Map<
      string,
      {
        retailer: string;
        retailerArea: string;
        allStores: Set<string>;
        activeStoresLatestMonth: Set<string>;
        monthlyCases: Record<string, number>;
        totalCases: number;
      }
    >();

    for (const row of analyticsRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const cases = Number(row.cases || 0);
      const key = `${retailer}__${retailerArea}`;

      if (!areaMap.has(key)) {
        areaMap.set(key, {
          retailer,
          retailerArea,
          allStores: new Set(),
          activeStoresLatestMonth: new Set(),
          monthlyCases: {},
          totalCases: 0,
        });
      }

      const item = areaMap.get(key)!;
      item.allStores.add(customer);
      item.monthlyCases[month] = (item.monthlyCases[month] || 0) + cases;
      item.totalCases += cases;

      if (month === latestMonth && cases > 0) {
        item.activeStoresLatestMonth.add(customer);
      }
    }

    const areaPatterns = Array.from(areaMap.values())
      .map((area) => {
        const activeStoreCount = area.activeStoresLatestMonth.size;
        const totalStoreCount = area.allStores.size;
        const latestCases = area.monthlyCases[latestMonth] || 0;

        let previous3Cases = 0;
        for (const month of previousThreeMonths) {
          previous3Cases += area.monthlyCases[month] || 0;
        }

        return {
          ...area,
          latestCases,
          previous3Cases,
          activeStoreCount,
          totalStoreCount,
          activeStoreRatio:
            totalStoreCount > 0 ? activeStoreCount / totalStoreCount : 0,
        };
      })
      .sort((a, b) => a.activeStoreRatio - b.activeStoreRatio || b.totalCases - a.totalCases);

    const bannerMap = new Map<
      string,
      {
        retailer: string;
        monthlyCases: Record<string, number>;
        stores: Set<string>;
        activeStoresLatestMonth: Set<string>;
        totalCases: number;
      }
    >();

    for (const row of analyticsRows) {
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const month = normalizeMonthLabel(row.month);
      const cases = Number(row.cases || 0);

      if (!bannerMap.has(retailer)) {
        bannerMap.set(retailer, {
          retailer,
          monthlyCases: {},
          stores: new Set(),
          activeStoresLatestMonth: new Set(),
          totalCases: 0,
        });
      }

      const item = bannerMap.get(retailer)!;
      item.monthlyCases[month] = (item.monthlyCases[month] || 0) + cases;
      item.stores.add(customer);
      item.totalCases += cases;

      if (month === latestMonth && cases > 0) {
        item.activeStoresLatestMonth.add(customer);
      }
    }

    const bannerPatterns = Array.from(bannerMap.values())
      .map((banner) => {
        let previous3Cases = 0;
        for (const month of previousThreeMonths) {
          previous3Cases += banner.monthlyCases[month] || 0;
        }

        return {
          retailer: banner.retailer,
          latestCases: banner.monthlyCases[latestMonth] || 0,
          previous3Cases,
          totalCases: banner.totalCases,
          totalStores: banner.stores.size,
          activeStoresLatestMonth: banner.activeStoresLatestMonth.size,
          activeRatio:
            banner.stores.size > 0
              ? banner.activeStoresLatestMonth.size / banner.stores.size
              : 0,
        };
      })
      .sort((a, b) => b.totalCases - a.totalCases);

    const biggestNeedToKnow: string[] = [];
    const firstFocus: string[] = [];
    const riskOpportunity: string[] = [];
    const actionsToTake: string[] = [];

    if (highPriority[0]) {
      biggestNeedToKnow.push(
        `${highPriority[0].customer} in ${highPriority[0].retailerArea} is the top follow-up based on ${highPriority[0].signal.toLowerCase()}.`
      );
      firstFocus.push(
        `Start with ${highPriority[0].customer} because it has the clearest near-term recovery opportunity and strongest pullout signal.`
      );
      riskOpportunity.push(
        `${highPriority[0].customer} looks like a reactivation or pullout recovery opportunity rather than just normal volatility.`
      );
      actionsToTake.push(
        `Call the distributor/store contact for ${highPriority[0].customer} and confirm why orders stopped or declined.`
      );
    }

    if (reactivationAccounts[0]) {
      biggestNeedToKnow.push(
        `${reactivationAccounts.length} accounts have been inactive for 3+ months despite meaningful prior volume, creating a focused win-back list.`
      );
      riskOpportunity.push(
        `The biggest reactivation upside is in accounts that had meaningful prior volume but are now at zero for 3+ months.`
      );
      actionsToTake.push(
        `Build a reactivation list for the top stopped accounts and validate whether the issue is distribution, inventory, or set loss.`
      );
    }

    if (areaPatterns[0]) {
      biggestNeedToKnow.push(
        `${areaPatterns[0].retailerArea} has only ${areaPatterns[0].activeStoreCount} of ${areaPatterns[0].totalStoreCount} stores active in ${latestMonth}, signaling an area-level gap.`
      );
      firstFocus.push(
        `Prioritize retailer areas where active store count is low relative to the total known stores in that area.`
      );
      riskOpportunity.push(
        `Low active-store penetration within a retailer area suggests either partial pullout, inconsistent ordering, or a chain/distributor execution problem.`
      );
      actionsToTake.push(
        `Check the lowest-penetration retailer areas with the buyer/distributor to confirm whether the issue is localized or banner-wide.`
      );
    }

    if (bannerPatterns[0]) {
      biggestNeedToKnow.push(
        `${bannerPatterns[0].retailer} is the largest banner by total cases in the selected period, so changes there matter most overall.`
      );
      firstFocus.push(
        `Protect the highest-volume banner first, then work targeted reactivation in lower-penetration areas.`
      );
    }

    const sampleArea = areaPatterns[0]
      ? `${areaPatterns[0].retailerArea} has ${areaPatterns[0].totalStoreCount} stores in the selected range and ${areaPatterns[0].activeStoreCount} stores ordering in ${latestMonth}.`
      : "No area-level pattern available for the selected filters.";

    const mainTakeaways = [
      highPriority[0]
        ? `Biggest opportunity: recover ${highPriority[0].customer} (${highPriority[0].retailerArea}) because ${highPriority[0].signal.toLowerCase()}.`
        : "No major high-priority opportunity identified.",
      reactivationAccounts.length > 0
        ? `Biggest risk: ${reactivationAccounts.length} previously meaningful accounts have stopped ordering for 3+ months.`
        : "No major 3+ month reactivation risk identified.",
      bannerPatterns[0]
        ? `Major pattern: ${bannerPatterns[0].retailer} is the biggest banner driver in the selected period.`
        : "No clear banner-level pattern identified.",
      areaPatterns[0]
        ? `Store coverage pattern: ${sampleArea}`
        : "No store coverage pattern identified.",
    ].filter(Boolean);

    const recommendedActions = [
      highPriority[0]
        ? `Call ${highPriority[0].customer} / ${highPriority[0].retailerArea} first and confirm whether the decline is due to pullout, OOS, or distributor ordering gaps.`
        : "",
      reactivationAccounts[0]
        ? `Review the top stopped accounts and ask when the last order was, whether the item is still authorized, and whether a reset removed it.`
        : "",
      areaPatterns[0]
        ? `Audit the lowest-penetration retailer areas and compare active-store counts versus total known stores in the area.`
        : "",
      bannerPatterns[0]
        ? `Escalate repeated patterns within the same banner to the buyer or banner-level contact instead of treating them as isolated stores.`
        : "",
      `This week, convert the top 5 high-priority accounts into a call list with one hypothesis per account: distribution gap, reset loss, store-level issue, or buyer decision.`,
    ].filter(Boolean);

    return {
      months,
      latestMonth,
      accounts,
      rankedPriorityAccounts,
      reactivationAccounts,
      highPriority,
      mediumPriority,
      lowPriority,
      areaPatterns,
      bannerPatterns,
      biggestNeedToKnow,
      firstFocus,
      riskOpportunity,
      actionsToTake,
      mainTakeaways,
      recommendedActions,
      sampleArea,
    };
  }, [analyticsRows, analyticsSelectedMonths]);

  const renderTabButtons = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["analytics", "velocity", "pullout"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium capitalize transition ${
              activeTab === tab
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
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
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
            velocitySubTab === key
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
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
        ] as [PulloutSubTabKey, string][]
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setPulloutSubTab(key)}
          className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
            pulloutSubTab === key
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderVelocityFilters = () => {
    if (velocitySubTab === "best-selling-store") {
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
              onChange={(e) => setBestStorePeriodMode(e.target.value as PeriodMode)}
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
    }

    if (velocitySubTab === "total-cases-per-month") {
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
    }

    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Date Filter
          </label>
          <select
            value={avgCakesPeriodMode}
            onChange={(e) => setAvgCakesPeriodMode(e.target.value as PeriodMode)}
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

  const renderAnalyticsFilters = () => (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Retailer
        </label>
        <select
          value={analyticsRetailerFilter}
          onChange={(e) => setAnalyticsRetailerFilter(e.target.value)}
          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
        >
          {retailerOptions.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>

      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Date Filter
        </label>
        <select
          value={analyticsPeriodMode}
          onChange={(e) => setAnalyticsPeriodMode(e.target.value as PeriodMode)}
          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
        >
          <option value="past6Months">Past 6 Months</option>
          <option value="lastMonth">Last Month</option>
          <option value="past12Months">Past 12 Months</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {analyticsPeriodMode === "custom" && (
        <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              From
            </label>
            <input
              type="month"
              value={analyticsFromMonth}
              onChange={(e) => setAnalyticsFromMonth(e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            />
          </div>

          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              To
            </label>
            <input
              type="month"
              value={analyticsToMonth}
              onChange={(e) => setAnalyticsToMonth(e.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
            />
          </div>
        </>
      )}
    </div>
  );

  const renderPulloutTable = () => {
    if (loading) {
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading KEHE velocity data...
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
          {loadError}
        </div>
      );
    }

    const isArea = pulloutSubTab === "by-retailer-area";
    const monthColumns = isArea
      ? pulloutByAreaTable.monthColumns
      : pulloutByStoreTable.monthColumns;
    const tableRows = isArea ? filteredByAreaRows : filteredByStoreRows;

    const handleExport = () => {
      const headers = isArea
        ? ["Retailer", "Retailer Area", ...monthColumns, "Total"]
        : ["Retailer", "Retailer Area", "Store", ...monthColumns, "Total"];

      const exportRows = tableRows.map((row) => {
        const base = isArea
          ? [row.retailer, row.retailer_area]
          : [row.retailer, row.retailer_area, (row as any).customer ?? ""];

        return [...base, ...monthColumns.map((m) => row.months[m] || 0), row.total];
      });

      exportToExcel({
        filename: isArea
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
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Retailer
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Retailer Area
                    </th>
                    {!isArea && (
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
                      className="border-t border-slate-200 transition-colors hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                      {!isArea && "customer" in row && (
                        <td className="px-4 py-3 text-slate-700">
                          {(row as any).customer}
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

  const renderAnalytics = () => {
    if (loading) {
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading KEHE velocity data...
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
          {loadError}
        </div>
      );
    }

    const latestMonth = analyticsData.latestMonth || "latest month";

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <InsightCard
            title="High-Priority Accounts"
            value={String(analyticsData.highPriority.length)}
            subtitle="Accounts needing immediate follow-up"
          />
          <InsightCard
            title="3+ Month Reactivation Accounts"
            value={String(analyticsData.reactivationAccounts.length)}
            subtitle="Stopped ordering but had meaningful prior volume"
          />
          <InsightCard
            title="Latest-Month Coverage Example"
            value={analyticsData.areaPatterns[0]
              ? `${analyticsData.areaPatterns[0].activeStoreCount}/${analyticsData.areaPatterns[0].totalStoreCount}`
              : "0/0"}
            subtitle={
              analyticsData.areaPatterns[0]
                ? `${analyticsData.areaPatterns[0].retailerArea} active stores in ${latestMonth}`
                : "No area coverage signal"
            }
          />
          <InsightCard
            title="Accounts Reviewed"
            value={formatNumber(analyticsData.accounts.length)}
            subtitle="Distinct store-level accounts in selected range"
          />
        </div>

        <SectionCard title="What are the biggest things I need to know?">
          <div className="space-y-3">
            {analyticsData.biggestNeedToKnow.length === 0 ? (
              <div className="text-sm text-slate-500">
                No major insights for the selected filters.
              </div>
            ) : (
              analyticsData.biggestNeedToKnow.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="What should I focus on first?">
          <div className="space-y-3">
            {analyticsData.firstFocus.length === 0 ? (
              <div className="text-sm text-slate-500">
                No immediate focus area identified.
              </div>
            ) : (
              analyticsData.firstFocus.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="What is the likely sales opportunity or risk?">
          <div className="space-y-3">
            {analyticsData.riskOpportunity.length === 0 ? (
              <div className="text-sm text-slate-500">
                No clear opportunity/risk pattern identified.
              </div>
            ) : (
              analyticsData.riskOpportunity.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="What action should we take?">
          <div className="space-y-3">
            {analyticsData.actionsToTake.length === 0 ? (
              <div className="text-sm text-slate-500">
                No specific actions available.
              </div>
            ) : (
              analyticsData.actionsToTake.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="1. Main takeaways">
          <div className="space-y-3">
            {analyticsData.mainTakeaways.map((item, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="2. Priority accounts">
          {analyticsData.rankedPriorityAccounts.length === 0 ? (
            <div className="text-sm text-slate-500">No priority accounts identified.</div>
          ) : (
            <div className="space-y-4">
              {analyticsData.rankedPriorityAccounts.slice(0, 12).map((account, idx) => (
                <div
                  key={`${account.retailer}-${account.retailerArea}-${account.customer}-${idx}`}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-slate-900">
                          #{idx + 1} {account.customer}
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getPriorityBadgeClass(
                            account.priority
                          )}`}
                        >
                          {account.priority} Priority
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {account.opportunityType}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600">
                        {account.retailer} • {account.retailerArea}
                      </div>
                      <div className="text-sm text-slate-700">
                        <span className="font-semibold">Signal:</span> {account.signal}
                      </div>
                      <div className="text-sm text-slate-700">
                        <span className="font-semibold">Why it matters:</span>{" "}
                        {account.opportunityType === "Reactivation"
                          ? "Meaningful prior volume with 3+ months of inactivity."
                          : account.opportunityType === "Recent pullout"
                          ? "Recent stop in ordering after prior movement."
                          : account.opportunityType === "Declining account"
                          ? "Still active but weakening meaningfully."
                          : "Stable active account with protection/growth value."}
                      </div>
                    </div>

                    <div className="grid min-w-[240px] grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">Latest Month</div>
                        <div className="text-lg font-bold text-slate-900">
                          {account.latestCases}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">Prior 3 Months</div>
                        <div className="text-lg font-bold text-slate-900">
                          {formatNumber(account.previous3MonthCases)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="3. Sales strategy">
          <div className="space-y-4">
            {analyticsData.rankedPriorityAccounts.slice(0, 8).map((account, idx) => (
              <div
                key={`${account.customer}-${idx}`}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="text-base font-semibold text-slate-900">
                  {account.customer} • {account.retailerArea}
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-semibold">Likely issue:</span> {account.opportunityType}
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Sales strategy:</span> {account.strategy}
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Route:</span> {account.routeToMarket}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="4. Opportunity segmentation">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
            <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
              <div className="text-lg font-semibold text-red-800">
                High-priority win-backs
              </div>
              <div className="mt-2 text-3xl font-bold text-red-900">
                {analyticsData.highPriority.length}
              </div>
              <div className="mt-2 text-sm text-red-700">
                Accounts with the strongest recovery value or most urgent pullout signal.
              </div>
            </div>

            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-lg font-semibold text-amber-800">
                Medium-priority watchlist
              </div>
              <div className="mt-2 text-3xl font-bold text-amber-900">
                {analyticsData.mediumPriority.length}
              </div>
              <div className="mt-2 text-sm text-amber-700">
                Accounts that are slipping or need confirmation before escalation.
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-lg font-semibold text-slate-800">
                Low-priority / low-return
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {analyticsData.lowPriority.length}
              </div>
              <div className="mt-2 text-sm text-slate-700">
                Low-volume or stable accounts with less immediate upside.
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-lg font-semibold text-emerald-800">
                New opportunity accounts
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-900">
                {analyticsData.reactivationAccounts.length}
              </div>
              <div className="mt-2 text-sm text-emerald-700">
                Accounts that once pulled meaningfully and then stopped.
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="5. Recommended next actions">
          <div className="space-y-3">
            {analyticsData.recommendedActions.map((item, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                {idx + 1}. {item}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Banner-level / chain-level patterns">
          {analyticsData.bannerPatterns.length === 0 ? (
            <div className="text-sm text-slate-500">No banner patterns found.</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Banner
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Latest Month Cases
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Prior 3 Months
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Total Stores
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Active Stores Latest Month
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                        Active Ratio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsData.bannerPatterns.map((banner, idx) => (
                      <tr key={`${banner.retailer}-${idx}`} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-700">{banner.retailer}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatNumber(banner.latestCases)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatNumber(banner.previous3Cases)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{banner.totalStores}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {banner.activeStoresLatestMonth}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {(banner.activeRatio * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Retailer area coverage analysis">
          {analyticsData.areaPatterns.length === 0 ? (
            <div className="text-sm text-slate-500">No retailer area pattern found.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Example: {analyticsData.sampleArea}
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Retailer
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Retailer Area
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Total Stores
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Active in {latestMonth}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Active Ratio
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                          Latest Cases
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.areaPatterns.slice(0, 20).map((area, idx) => (
                        <tr key={`${area.retailerArea}-${idx}`} className="border-t border-slate-200">
                          <td className="px-4 py-3 text-slate-700">{area.retailer}</td>
                          <td className="px-4 py-3 text-slate-700">{area.retailerArea}</td>
                          <td className="px-4 py-3 text-slate-700">{area.totalStoreCount}</td>
                          <td className="px-4 py-3 text-slate-700">{area.activeStoreCount}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {(area.activeStoreRatio * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {formatNumber(area.latestCases)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {activeTab === "analytics" && (
        <>
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
            {renderTabButtons()}

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-slate-900">Analytics</h2>
                  <p className="text-sm text-slate-500">
                    Sales analyst view based on velocity and pullout behavior.
                  </p>
                </div>

                {renderAnalyticsFilters()}
              </div>
            </div>
          </div>

          {renderAnalytics()}
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
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Loading KEHE velocity data...
            </div>
          ) : loadError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
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

      {activeTab === "pullout" && (
        <>
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
            {renderTabButtons()}

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-col gap-3">{renderPulloutSubTabs()}</div>
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