"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  return String(description || "")
    .replace(/\u00a0/g, " ")
    .trim();
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
  const monthName = match[1];
  const year2 = Number(match[2]);
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return -Infinity;
  const fullYear = 2000 + year2;
  return fullYear * 100 + (monthIndex + 1);
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
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
}

function getPastMonthsInputValue(monthsBack: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getLastMonthLabel() {
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return monthLabelFromDate(lastMonthDate);
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
  const result: string[] = [];
  for (let i = 11; i >= 0; i--) {
    result.push(monthLabelFromDate(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return result;
}

function truncateLabel(value: string, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
    (groupWidth - groupInnerPadding * 2 - barGap * Math.max(series.length - 1, 0)) /
      Math.max(series.length, 1)
  );

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
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: "980px" }}>
          {ticks.map((tick, index) => (
            <g key={index}>
              <line x1={leftPad} y1={tick.y} x2={chartWidth - rightPad} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={tick.y + 4} textAnchor="end" fontSize="11" fill="#64748b">{tick.value}</text>
            </g>
          ))}
          <line x1={leftPad} y1={topPad + innerHeight} x2={chartWidth - rightPad} y2={topPad + innerHeight} stroke="#94a3b8" strokeWidth="1.5" />
          {months.map((month, monthIndex) => {
            const groupStartX = leftPad + monthIndex * groupWidth + groupInnerPadding;
            return (
              <g key={month}>
                {series.map((item, seriesIndex) => {
                  const value = item.values[monthIndex] || 0;
                  const barHeight = (value / maxValue) * innerHeight;
                  const x = groupStartX + seriesIndex * (barWidth + barGap);
                  const y = topPad + innerHeight - barHeight;
                  return (
                    <g key={`${month}-${item.name}`}>
                      <rect x={x} y={y} width={barWidth} height={barHeight} rx="3" fill={item.fill} />
                      <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={item.fill}>{value}</text>
                    </g>
                  );
                })}
                <text x={leftPad + monthIndex * groupWidth + groupWidth / 2} y={topPad + innerHeight + 18} textAnchor="middle" fontSize="11" fill="#334155">{month.toUpperCase()}</text>
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
  const leftPad = labelWidth;
  const rightPad = 40;
  const chartWidth = minWidth;
  const innerWidth = chartWidth - leftPad - rightPad;
  const chartHeight = Math.max(320, topPad + bottomPad + data.length * rowHeight);
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxValue / ticks) * i));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: `${minWidth}px` }}>
          {tickValues.map((tick, index) => {
            const x = leftPad + (tick / maxValue) * innerWidth;
            return (
              <g key={index}>
                <line x1={x} y1={topPad} x2={x} y2={chartHeight - bottomPad} stroke="#e2e8f0" strokeWidth="1" />
                <text x={x} y={topPad - 6} textAnchor="middle" fontSize="11" fill="#64748b">{tick}</text>
              </g>
            );
          })}
          {data.map((item, index) => {
            const y = topPad + index * rowHeight;
            const barHeight = 24;
            const barWidth = (item.value / maxValue) * innerWidth;
            return (
              <g key={`${item.label}-${index}`}>
                <text x={leftPad - 12} y={y + barHeight / 2 + 4} textAnchor="end" fontSize="12" fill="#334155">
                  {truncateLabel(item.label, 44)}
                  <title>{item.label}</title>
                </text>
                <rect x={leftPad} y={y} width={barWidth} height={barHeight} rx="4" fill="#4a83e7" />
                <text x={leftPad + barWidth + 8} y={y + barHeight / 2 + 4} fontSize="12" fontWeight="700" fill="#2563eb">{item.value}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SingleSeriesMonthlyChart({
  title,
  months,
  values,
  fill = "#123f73",
}: {
  title: string;
  months: string[];
  values: number[];
  fill?: string;
}) {
  const chartHeight = 360;
  const chartWidth = Math.max(980, 140 + months.length * 120);
  const leftPad = 55;
  const rightPad = 20;
  const topPad = 20;
  const bottomPad = 95;
  const innerWidth = chartWidth - leftPad - rightPad;
  const innerHeight = chartHeight - topPad - bottomPad;

  const maxValue = Math.max(1, ...values);
  const groupWidth = months.length > 0 ? innerWidth / months.length : innerWidth;
  const barWidth = Math.max(36, groupWidth * 0.55);

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
        <svg width={chartWidth} height={chartHeight} style={{ minWidth: "980px" }}>
          {ticks.map((tick, index) => (
            <g key={index}>
              <line x1={leftPad} y1={tick.y} x2={chartWidth - rightPad} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={leftPad - 10} y={tick.y + 4} textAnchor="end" fontSize="11" fill="#64748b">{tick.value}</text>
            </g>
          ))}
          <line x1={leftPad} y1={topPad + innerHeight} x2={chartWidth - rightPad} y2={topPad + innerHeight} stroke="#94a3b8" strokeWidth="1.5" />
          {months.map((month, index) => {
            const value = values[index] || 0;
            const barHeight = (value / maxValue) * innerHeight;
            const x = leftPad + index * groupWidth + (groupWidth - barWidth) / 2;
            const y = topPad + innerHeight - barHeight;
            return (
              <g key={month}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx="4" fill={fill} />
                <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill={fill}>{value}</text>
                <text x={leftPad + index * groupWidth + groupWidth / 2} y={topPad + innerHeight + 18} textAnchor="middle" fontSize="11" fill="#334155">{month.toUpperCase()}</text>
                <text x={leftPad + index * groupWidth + groupWidth / 2} y={topPad + innerHeight + 34} textAnchor="middle" fontSize="12" fontWeight="700" fill="#64748b">{value}</text>
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
  const [velocitySubTab, setVelocitySubTab] = useState<VelocitySubTabKey>("best-selling-store");
  const [pulloutSubTab, setPulloutSubTab] = useState<PulloutSubTabKey>("by-retailer-area");

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

  const [pulloutPeriodMode, setPulloutPeriodMode] = useState<PeriodMode>("custom");
  const [pulloutFromMonth, setPulloutFromMonth] = useState(getPastMonthsInputValue(5));
  const [pulloutToMonth, setPulloutToMonth] = useState(getCurrentMonthInputValue());
  const [pulloutRetailerFilter, setPulloutRetailerFilter] = useState("All Retailers");

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

  const bestStoreRows = useMemo(() => {
    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
      return bestStoreSelectedMonths.includes(rowMonth) &&
        (retailerFilter === "All Retailers" || rowRetailer === retailerFilter);
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

  const monthlyCasesRows = useMemo(() => {
    return rows.filter((row) => monthlyCasesSelectedMonths.includes(normalizeMonthLabel(row.month)));
  }, [rows, monthlyCasesSelectedMonths]);

  const monthlyCasesSeries = useMemo(() => {
    const sortedMonths = [...monthlyCasesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((month) => monthlyCasesRows.some((row) => normalizeMonthLabel(row.month) === month));

    const retailerNames = ["Kroger", "Fresh Thyme", "INFRA & Others"];
    const colors: Record<string, string> = {
      Kroger: "#123f73",
      "Fresh Thyme": "#f59e0b",
      "INFRA & Others": "#60c7df",
    };

    const grouped: Record<string, Record<string, number>> = {};
    for (const month of sortedMonths) {
      grouped[month] = {};
      for (const retailer of retailerNames) {
        grouped[month][retailer] = 0;
      }
    }

    for (const row of monthlyCasesRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim() || "Unknown";
      if (!grouped[month]) grouped[month] = {};
      grouped[month][retailer] = (grouped[month][retailer] || 0) + Number(row.cases || 0);
    }

    return {
      months: sortedMonths,
      series: retailerNames.map((retailer) => ({
        name: retailer,
        fill: colors[retailer] || "#4a83e7",
        values: sortedMonths.map((month) => grouped[month]?.[retailer] || 0),
      })),
    };
  }, [monthlyCasesRows, monthlyCasesSelectedMonths]);

  const avgCakesRows = useMemo(() => {
    return rows.filter((row) => avgCakesSelectedMonths.includes(normalizeMonthLabel(row.month)));
  }, [rows, avgCakesSelectedMonths]);

  const averageCakesPerWeekSeries = useMemo(() => {
    const sortedMonths = [...avgCakesSelectedMonths]
      .sort(compareMonthLabelsAsc)
      .filter((month) => avgCakesRows.some((row) => normalizeMonthLabel(row.month) === month));

    const cakeNames = Array.from(
      new Set(avgCakesRows.map((row) => getCakeSeriesName(row.description)).filter(Boolean))
    ).sort((a, b) => {
      const weightDiff = getCakeSortWeight(a) - getCakeSortWeight(b);
      if (weightDiff !== 0) return weightDiff;
      return a.localeCompare(b);
    });

    const palette = ["#123f73", "#f59e0b", "#60c7df", "#7c3aed", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6"];

    const groupedEaches: Record<string, Record<string, number>> = {};
    for (const month of sortedMonths) {
      groupedEaches[month] = {};
      for (const cake of cakeNames) {
        groupedEaches[month][cake] = 0;
      }
    }

    for (const row of avgCakesRows) {
      const month = normalizeMonthLabel(row.month);
      const cake = getCakeSeriesName(row.description);
      if (!cake) continue;
      if (!groupedEaches[month]) groupedEaches[month] = {};
      groupedEaches[month][cake] = (groupedEaches[month][cake] || 0) + Number(row.eaches || 0);
    }

    return {
      months: sortedMonths,
      series: cakeNames.map((cake, index) => ({
        name: cake,
        fill: palette[index % palette.length],
        values: sortedMonths.map((month) => Number(((groupedEaches[month]?.[cake] || 0) / 4).toFixed(1))),
      })),
    };
  }, [avgCakesRows, avgCakesSelectedMonths]);

  const pulloutRows = useMemo(() => {
    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
      return pulloutSelectedMonths.includes(rowMonth) &&
        (pulloutRetailerFilter === "All Retailers" || rowRetailer === pulloutRetailerFilter);
    });
  }, [rows, pulloutSelectedMonths, pulloutRetailerFilter]);

  // By Retailer Area: grouped by retailer + retailer_area
  const pulloutByAreaTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const grouped = new Map<
      string,
      { retailer: string; retailer_area: string; months: Record<string, number>; total: number }
    >();

    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}`;

      if (!grouped.has(key)) {
        grouped.set(key, { retailer, retailer_area: retailerArea, months: {}, total: 0 });
      }

      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }

    const rowsOut = Array.from(grouped.values()).sort((a, b) => b.total - a.total);
    return { monthColumns, rows: rowsOut };
  }, [pulloutRows, pulloutSelectedMonths]);

  // By Retailer Store: grouped by retailer + retailer_area + customer
  const pulloutByStoreTable = useMemo(() => {
    const monthColumns = [...pulloutSelectedMonths].sort(compareMonthLabelsAsc);
    const grouped = new Map<
      string,
      { retailer: string; retailer_area: string; customer: string; months: Record<string, number>; total: number }
    >();

    for (const row of pulloutRows) {
      const month = normalizeMonthLabel(row.month);
      const retailer = String(row.retailer || "").trim() || "Unknown";
      const retailerArea = String(row.retailer_area || "").trim() || "Unknown";
      const customer = String(row.customer || "").trim() || "Unknown";
      const key = `${retailer}__${retailerArea}__${customer}`;

      if (!grouped.has(key)) {
        grouped.set(key, { retailer, retailer_area: retailerArea, customer, months: {}, total: 0 });
      }

      const item = grouped.get(key)!;
      item.months[month] = (item.months[month] || 0) + Number(row.cases || 0);
      item.total += Number(row.cases || 0);
    }

    const rowsOut = Array.from(grouped.values()).sort((a, b) => b.total - a.total);
    return { monthColumns, rows: rowsOut };
  }, [pulloutRows, pulloutSelectedMonths]);

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
            {tab === "pullout" ? "Pull out" : tab.charAt(0).toUpperCase() + tab.slice(1)}
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
            <label className="mb-1 block text-sm font-medium text-slate-700">Retailer</label>
            <select value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              {retailerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Show Top</label>
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value) as TopN)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
            <select value={bestStorePeriodMode} onChange={(e) => setBestStorePeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              <option value="lastMonth">Last Month</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {bestStorePeriodMode === "custom" && (
            <>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
                <input type="month" value={bestStoreFromMonth} onChange={(e) => setBestStoreFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
              </div>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
                <input type="month" value={bestStoreToMonth} onChange={(e) => setBestStoreToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
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
            <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
            <select value={monthlyCasesPeriodMode} onChange={(e) => setMonthlyCasesPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              <option value="past12Months">Past 12 Months</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {monthlyCasesPeriodMode === "custom" && (
            <>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
                <input type="month" value={monthlyCasesFromMonth} onChange={(e) => setMonthlyCasesFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
              </div>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
                <input type="month" value={monthlyCasesToMonth} onChange={(e) => setMonthlyCasesToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
          <select value={avgCakesPeriodMode} onChange={(e) => setAvgCakesPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
            <option value="past12Months">Past 12 Months</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {avgCakesPeriodMode === "custom" && (
          <>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
              <input type="month" value={avgCakesFromMonth} onChange={(e) => setAvgCakesFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
              <input type="month" value={avgCakesToMonth} onChange={(e) => setAvgCakesToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPulloutFilters = () => (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">Retailer</label>
        <select value={pulloutRetailerFilter} onChange={(e) => setPulloutRetailerFilter(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
          {retailerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
        <select value={pulloutPeriodMode} onChange={(e) => setPulloutPeriodMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
          <option value="custom">Past 6 Months / Custom</option>
          <option value="lastMonth">Last Month</option>
        </select>
      </div>
      {pulloutPeriodMode === "custom" && (
        <>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">From</label>
            <input type="month" value={pulloutFromMonth} onChange={(e) => setPulloutFromMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input type="month" value={pulloutToMonth} onChange={(e) => setPulloutToMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
          </div>
        </>
      )}
    </div>
  );

  const velocityStickyFilters = (
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
  );

  const pulloutStickyFilters = (
    <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
      {renderTabButtons()}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-bold text-slate-900">
                {pulloutSubTab === "by-retailer-area"
                  ? "Monthly Cases by Retailer Area"
                  : "Monthly Cases by Retailer Store"}
              </h2>
              <p className="text-sm text-slate-500">
                Past 6 months by default. Filter by retailer and date range.
              </p>
            </div>
            {renderPulloutSubTabs()}
          </div>
          {renderPulloutFilters()}
        </div>
      </div>
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

    if (pulloutSubTab === "by-retailer-area") {
      const { monthColumns, rows: tableRows } = pulloutByAreaTable;
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-xl font-semibold text-slate-900">Monthly Cases by Retailer Area</h3>
            <p className="mt-1 text-sm text-slate-500">
              Grouped by Retailer and Retailer Area with monthly case totals.
            </p>
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
                      {monthColumns.map((month) => (
                        <th key={month} className="px-4 py-3 text-left font-semibold text-slate-700">{month}</th>
                      ))}
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr key={`${row.retailer}-${row.retailer_area}-${index}`} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                        <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                        {monthColumns.map((month) => (
                          <td key={month} className="px-4 py-3 text-slate-700">{row.months[month] || 0}</td>
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
    }

    // by-retailer-store
    const { monthColumns, rows: tableRows } = pulloutByStoreTable;
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-xl font-semibold text-slate-900">Monthly Cases by Retailer Store</h3>
          <p className="mt-1 text-sm text-slate-500">
            Grouped by Retailer, Retailer Area, and Customer with monthly case totals.
          </p>
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Customer</th>
                    {monthColumns.map((month) => (
                      <th key={month} className="px-4 py-3 text-left font-semibold text-slate-700">{month}</th>
                    ))}
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, index) => (
                    <tr key={`${row.retailer}-${row.retailer_area}-${row.customer}-${index}`} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customer}</td>
                      {monthColumns.map((month) => (
                        <td key={month} className="px-4 py-3 text-slate-700">{row.months[month] || 0}</td>
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
          <div className="sticky top-0 z-20 space-y-4 bg-slate-100 pb-4">
            {renderTabButtons()}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold text-slate-900">Analytics</div>
            <p className="mt-2 text-sm text-slate-500">Analytics will be added next.</p>
          </div>
        </>
      )}

      {activeTab === "velocity" && (
        <>
          {velocityStickyFilters}
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
                      <h3 className="text-xl font-semibold text-slate-900">Top Selling Store</h3>
                      <div className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">Top {topN}</div>
                    </div>
                    <div className="space-y-3">
                      {topSellingStores.length === 0 ? (
                        <div className="text-sm text-slate-500">No KEHE velocity data found for the selected month range.</div>
                      ) : (
                        topSellingStores.map((item, index) => (
                          <div key={`${item.customer}-${index}`} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 px-4 py-3">
                            <div className="text-sm font-medium leading-5 text-slate-800">{item.customer}</div>
                            <div className="min-w-[56px] text-right text-sm font-bold text-slate-900">{item.totalCases}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <HorizontalBarChart
                    title="Top Selling Store"
                    data={topSellingStores.map((item) => ({ label: item.customer, value: item.totalCases }))}
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
          {pulloutStickyFilters}
          {renderPulloutTable()}
        </>
      )}
    </div>
  );
}