"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type TabKey = "analytics" | "velocity" | "pullout";
type PeriodMode = "lastMonth" | "custom";
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
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getMonthSortValue(value: string) {
  const normalized = normalizeMonthLabel(value);
  const match = normalized.match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!match) return -Infinity;

  const monthName = match[1];
  const year2 = Number(match[2]);
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return -Infinity;

  const fullYear = 2000 + year2;
  return fullYear * 100 + (monthIndex + 1);
}

function compareMonthLabelsDesc(a: string, b: string) {
  return getMonthSortValue(b) - getMonthSortValue(a);
}

function getLastMonthLabel() {
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  return `${lastMonthDate.toLocaleString("en-US", {
    month: "long",
  })} '${String(lastMonthDate.getFullYear()).slice(-2)}`;
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
    result.push(
      `${cursor.toLocaleString("en-US", { month: "long" })} '${String(
        cursor.getFullYear()
      ).slice(-2)}`
    );
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return result;
}

function getCurrentMonthInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getLastMonthInputValue() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function SimpleBarChart({
  data,
  title,
}: {
  data: { label: string; value: number }[];
  title: string;
}) {
  const chartHeight = 340;
  const chartWidth = 980;
  const leftPad = 55;
  const rightPad = 20;
  const topPad = 20;
  const bottomPad = 120;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const innerWidth = chartWidth - leftPad - rightPad;
  const innerHeight = chartHeight - topPad - bottomPad;
  const barGap = 14;
  const barWidth =
    data.length > 0
      ? Math.max(28, (innerWidth - barGap * (data.length - 1)) / data.length)
      : 40;

  const gridSteps = 4;
  const ticks = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const value = Math.round((maxValue / gridSteps) * i);
    const y = topPad + innerHeight - (innerHeight / gridSteps) * i;
    return { value, y };
  });

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>

      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} className="min-w-[980px]">
          {ticks.map((tick, index) => (
            <g key={index}>
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

          {data.map((item, index) => {
            const x = leftPad + index * (barWidth + barGap);
            const barHeight = (item.value / maxValue) * innerHeight;
            const y = topPad + innerHeight - barHeight;
            const shortLabel =
              item.label.length > 22 ? `${item.label.slice(0, 22)}...` : item.label;

            return (
              <g key={`${item.label}-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="4"
                  fill="#4a83e7"
                />
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="#2563eb"
                >
                  {item.value}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={topPad + innerHeight + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#334155"
                >
                  {shortLabel}
                  <title>{item.label}</title>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function KeheDashboardView() {
  const [activeTab, setActiveTab] = useState<TabKey>("analytics");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("lastMonth");
  const [fromMonth, setFromMonth] = useState(getLastMonthInputValue());
  const [toMonth, setToMonth] = useState(getCurrentMonthInputValue());
  const [topN, setTopN] = useState<TopN>(10);
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");

  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const loadVelocity = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const pageSize = 1000;
        let from = 0;
        let allRows: VelocityRow[] = [];

        while (true) {
          const { data, error } = await supabase
            .from("kehe_velocity")
            .select("*")
            .range(from, from + pageSize - 1);

          if (error) throw error;

          const batch = (data ?? []) as VelocityRow[];
          allRows = [...allRows, ...batch];

          if (batch.length < pageSize) break;
          from += pageSize;
        }

        setRows(allRows);
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load KEHE velocity data.");
      } finally {
        setLoading(false);
      }
    };

    loadVelocity();
  }, []);

  const retailerOptions = useMemo(() => {
    return [
      "All Retailers",
      ...Array.from(
        new Set(
          rows
            .map((r) => String(r.retailer || "").replace(/\u00a0/g, " ").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [rows]);

  const selectedMonths = useMemo(() => {
    if (periodMode === "lastMonth") {
      return [normalizeMonthLabel(getLastMonthLabel())];
    }

    return buildMonthRange(fromMonth, toMonth).map(normalizeMonthLabel);
  }, [periodMode, fromMonth, toMonth]);

  const topSellingStores = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const row of rows) {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();

      const matchesMonth = selectedMonths.includes(rowMonth);
      const matchesRetailer =
        retailerFilter === "All Retailers" || rowRetailer === retailerFilter;

      if (!matchesMonth || !matchesRetailer) continue;
      if (!row.customer) continue;

      grouped.set(row.customer, (grouped.get(row.customer) || 0) + Number(row.cases || 0));
    }

    return Array.from(grouped.entries())
      .map(([customer, totalCases]) => ({
        customer,
        totalCases,
      }))
      .sort((a, b) => b.totalCases - a.totalCases)
      .slice(0, topN);
  }, [rows, selectedMonths, retailerFilter, topN]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium transition ${
              activeTab === "analytics"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Analytics
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("velocity")}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium transition ${
              activeTab === "velocity"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Velocity
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("pullout")}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium transition ${
              activeTab === "pullout"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Pull out
          </button>
        </div>
      </div>

      {activeTab === "analytics" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Analytics</div>
          <p className="mt-2 text-sm text-slate-500">
            Analytics will be added next.
          </p>
        </div>
      )}

      {activeTab === "pullout" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Pull out</div>
          <p className="mt-2 text-sm text-slate-500">
            Pull out dashboard will be added next.
          </p>
        </div>
      )}

      {activeTab === "velocity" && (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-bold text-slate-900">
                  Best Selling Store
                </h2>
                <p className="text-sm text-slate-500">
                  Customer ranking by total cases for the selected month and retailer.
                </p>
              </div>

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
                    {retailerOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
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
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                  </select>
                </div>

                <div className="min-w-[180px]">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Date Filter
                  </label>
                  <select
                    value={periodMode}
                    onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                  >
                    <option value="lastMonth">Last Month</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {periodMode === "custom" && (
                  <>
                    <div className="min-w-[180px]">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        From
                      </label>
                      <input
                        type="month"
                        value={fromMonth}
                        onChange={(e) => setFromMonth(e.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                      />
                    </div>

                    <div className="min-w-[180px]">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        To
                      </label>
                      <input
                        type="month"
                        value={toMonth}
                        onChange={(e) => setToMonth(e.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                      />
                    </div>
                  </>
                )}
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
                      No KEHE velocity data found for the selected month range.
                    </div>
                  ) : (
                    topSellingStores.map((item, index) => (
                      <div
                        key={`${item.customer}-${index}`}
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

              <SimpleBarChart
                title="Top Selling Store"
                data={topSellingStores.map((item) => ({
                  label: item.customer,
                  value: item.totalCases,
                }))}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}