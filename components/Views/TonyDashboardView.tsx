"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload, Plus, X, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type TabKey = "analytics" | "velocity" | "pullout" | "priority-pullout";
type PeriodMode = "lastMonth" | "past6Months" | "past12Months" | "custom";
type AnalyticsSection = "summary" | "pull-rate" | "win-back" | "declining";

type TonyVelocityRow = {
  id?: string;
  month: string;
  warehouse: string;
  location: string;
  customer: string;
  cheesecakes: string;
  item_pack: string;
  item_size: string;
  vendor_item: string;
  quantity_shipped: number;
  eaches: number;
  ext_net_ship_weight: number;
  actual_cost_gross: number;
  source_file_name?: string;
};

type TonyLocation = {
  id?: string;
  customer: string;
  location: string;
};

type MissingLocation = {
  customer: string;
  location: string;
};

type LocationMonthRow = {
  location: string;
  months: Record<string, number>;
  total: number;
  stores: StoreMonthRow[];
};

type StoreMonthRow = {
  location: string;
  store: string;
  months: Record<string, number>;
  total: number;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DEFAULT_PRIORITY_STORES = [
  "ANDRONICO'S #0173",
  "ANDRONICO'S #2451",
  "ANDRONICO'S #2453",
  "ANDRONICO'S #2454",
  "ANDRONICO'S #2455",
  "ANDRONICO'S SF #2452",
  "ANDRONICO'S SF #3066",
  "BF/LAZY ACRES #06",
  "BF/LAZY ACRES #23",
  "BF/LAZY ACRES #25",
  "BRISTOL FARMS #01",
  "BRISTOL FARMS #02",
  "BRISTOL FARMS #03",
  "BRISTOL FARMS #04",
  "BRISTOL FARMS #07",
  "BRISTOL FARMS #09",
  "BRISTOL FARMS #10",
  "BRISTOL FARMS #11",
  "BRISTOL FARMS #14",
  "BRISTOL FARMS #15",
  "BRISTOL FARMS #18",
  "BRISTOL FARMS #19",
  "DOORDASH CONCORD",
  "DOORDASH LA VALLEY 1",
  "DOORDASH LOS ANGELES 1",
  "DOORDASH LOS ANGELES 2",
  "DOORDASH PENINSULA 3",
  "DOORDASH PENINSULA 4",
  "DOORDASH PENINSULA 5",
  "DOORDASH PHOENIX 1",
  "DOORDASH PHOENIX 2",
  "DOORDASH SACRAMENTO-1",
  "DOORDASH SAN CARLOS",
  "DOORDASH SAN DIEGO-1",
  "DOORDASH SAN FRANCISCO 1",
  "DOORDASH SEATTLE-1",
  "DOORDASH SOUTH BAY-2",
  "LAZY ACRES STORE #26",
  "LAZY ACRES STORE #27",
  "LAZY ACRES STORE #28",
  "MARKET OF CHOICE #1",
  "MARKET OF CHOICE #10",
  "MARKET OF CHOICE #11",
  "MARKET OF CHOICE #12",
  "MARKET OF CHOICE #2",
  "MARKET OF CHOICE #3",
  "MARKET OF CHOICE #4",
  "MARKET OF CHOICE #5",
  "MARKET OF CHOICE #6",
  "MARKET OF CHOICE #7",
  "MARKET OF CHOICE #8",
  "MARKET OF CHOICE #9",
  "BRISTOL FARMS #21",
  "FOOD 4 LESS - #11-SLO",
  "FOOD 4 LESS -#1 MARCH LN",
  "FOOD 4 LESS #10 ATASCADER",
  "FOOD 4 LESS #12 PASO ROBL",
  "FOOD 4 LESS #14 MACK RD.",
  "FOOD 4 LESS - #3 LODI",
  "FOOD 4 LESS #15 RIO LINDA",
  "FOOD 4 LESS #16 RANCHO CO",
  "FOOD 4 LESS -#2 WILSON WY",
  "FOOD 4 LESS-#4 WESTON RN",
  "FOOD 4 LESS -#5 HAMMER LN",
  "FOOD 4 LESS -#6 MANTECA",
  "FOOD 4 LESS -#7 LOS BANOS",
  "FOOD 4 LESS - #8 SALINAS",
  "FOOD 4 LESS - CERES",
  "FOOD 4 LESS - #13 ARROYO",
  "FOOD 4 LESS #17 FAIRFIELD",
];

function normalize(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim();
}
function normalizeKey(value: unknown) { return normalize(value).toUpperCase(); }
function normalizeMonthLabel(value: string) { return normalize(value); }
function getCases(row: TonyVelocityRow) { return Number(row.quantity_shipped || 0); }
function monthLabel(month: string, year: string) { return `${month} '${String(year).slice(-2)}`; }
function getCurrentMonthInputValue() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
function getLastMonthInputValue() { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function getPastMonthsInputValue(back: number) { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() - back, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthLabelFromDate(date: Date) { return `${date.toLocaleString("en-US", { month: "long" })} '${String(date.getFullYear()).slice(-2)}`; }
function getLastMonthLabel() { const n = new Date(); return monthLabelFromDate(new Date(n.getFullYear(), n.getMonth() - 1, 1)); }
function getMonthSortValue(value: string) {
  const m = normalizeMonthLabel(value).match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!m) return -Infinity;
  const idx = new Date(`${m[1]} 1, 2000`).getMonth();
  if (Number.isNaN(idx)) return -Infinity;
  return (2000 + Number(m[2])) * 100 + (idx + 1);
}
function compareMonthLabelsAsc(a: string, b: string) { return getMonthSortValue(a) - getMonthSortValue(b); }
function buildMonthRange(from: string, to: string) {
  const result: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return result;
  let c = new Date(fy, fm - 1, 1); const end = new Date(ty, tm - 1, 1);
  while (c <= end) { result.push(monthLabelFromDate(c)); c = new Date(c.getFullYear(), c.getMonth() + 1, 1); }
  return result;
}
function buildPastNMonthsRange(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => monthLabelFromDate(new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)));
}
function selectedMonthsFromMode(mode: PeriodMode, from: string, to: string) {
  if (mode === "lastMonth") return [normalizeMonthLabel(getLastMonthLabel())];
  if (mode === "past12Months") return buildPastNMonthsRange(12).map(normalizeMonthLabel);
  if (mode === "past6Months") return buildPastNMonthsRange(6).map(normalizeMonthLabel);
  return buildMonthRange(from, to).map(normalizeMonthLabel);
}
function toNumber(value: unknown) { const n = Number(String(value ?? "").replace(/[$,]/g, "").trim()); return Number.isFinite(n) ? n : 0; }
function findColumn(headers: string[], candidates: string[]) {
  const normalized = headers.map((h) => normalize(h).toLowerCase());
  for (const c of candidates) { const i = normalized.findIndex((h) => h === normalize(c).toLowerCase()); if (i >= 0) return headers[i]; }
  for (const c of candidates) { const q = normalize(c).toLowerCase(); const i = normalized.findIndex((h) => h.includes(q) || q.includes(h)); if (i >= 0) return headers[i]; }
  return "";
}
function getCell(row: Record<string, unknown>, headers: string[], candidates: string[]) { const col = findColumn(headers, candidates); return col ? row[col] : ""; }
function truncate(value: string, max = 42) { return value.length > max ? `${value.slice(0, max)}...` : value; }
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (value: string | number) => { const s = String(value ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${filename}.csv`; a.click(); URL.revokeObjectURL(url);
}
async function readWorkbookRows(file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[240px]">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-9 text-sm outline-none focus:border-slate-400" />
      {value && <button type="button" onClick={() => onChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
    </div>
  );
}

function FilterButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{children}</button>;
}

function PeriodFilters({ mode, setMode, from, setFrom, to, setTo }: {
  mode: PeriodMode; setMode: (v: PeriodMode) => void; from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div className="min-w-[180px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">Date Filter</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
          <option value="past6Months">Past 6 Months</option>
          <option value="lastMonth">Last Month</option>
          <option value="past12Months">Past 12 Months</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      {mode === "custom" && <>
        <div className="min-w-[180px]"><label className="mb-1 block text-sm font-medium text-slate-700">From</label><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" /></div>
        <div className="min-w-[180px]"><label className="mb-1 block text-sm font-medium text-slate-700">To</label><input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" /></div>
      </>}
    </div>
  );
}

function GroupedMonthlyChart({ title, months, series }: { title: string; months: string[]; series: { name: string; values: number[]; fill: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(980);
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => setWidth(Math.max(entries[0]?.contentRect.width || 980, 420)));
    obs.observe(containerRef.current); return () => obs.disconnect();
  }, []);
  const cH = 370, lP = 60, rP = 25, tP = 24, bP = 95;
  const iW = width - lP - rP, iH = cH - tP - bP;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gW = months.length ? iW / months.length : iW;
  const bGap = 4, gPad = 10;
  const bW = Math.max(10, (gW - gPad * 2 - bGap * Math.max(series.length - 1, 0)) / Math.max(series.length, 1));
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i));
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-2xl font-semibold text-slate-700">{title}</h3>
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg width={width} height={cH} style={{ display: "block", width: "100%" }}>
          {ticks.map((tick, i) => { const y = tP + iH - (tick / max) * iH; return <g key={tick}><line x1={lP} y1={y} x2={width - rP} y2={y} stroke="#e2e8f0" /><text x={lP - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">{tick}</text></g>; })}
          {months.map((month, mi) => {
            const gX = lP + mi * gW + gPad;
            return <g key={month}>{series.map((item, si) => { const v = item.values[mi] || 0; const h = (v / max) * iH; const x = gX + si * (bW + bGap); const y = tP + iH - h; return <g key={`${month}-${item.name}`}><rect x={x} y={y} width={bW} height={h} rx="3" fill={item.fill} /><text x={x + bW / 2} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill={item.fill}>{v}</text></g>; })}<text x={lP + mi * gW + gW / 2} y={tP + iH + 22} textAnchor="middle" fontSize="11" fill="#334155">{month.toUpperCase()}</text></g>;
          })}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">{series.map((item) => <div key={item.name} className="flex items-center gap-2 text-sm text-slate-600"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.fill }} />{item.name}</div>)}</div>
    </div>
  );
}

function buildLocationTable(rows: TonyVelocityRow[], months: string[], prioritySet?: Set<string>) {
  const monthColumns = [...months].sort(compareMonthLabelsAsc);
  const locationMap = new Map<string, LocationMonthRow>();
  for (const row of rows) {
    const store = normalize(row.customer) || "Unknown Store";
    if (prioritySet && !prioritySet.has(normalizeKey(store))) continue;
    const location = normalize(row.location) || "Unmapped Location";
    const month = normalizeMonthLabel(row.month);
    const cases = getCases(row);
    if (!locationMap.has(location)) locationMap.set(location, { location, months: {}, total: 0, stores: [] });
    const loc = locationMap.get(location)!;
    loc.months[month] = (loc.months[month] || 0) + cases;
    loc.total += cases;

    const existing = loc.stores.find((s) => s.store === store);
    const storeRow = existing || { location, store, months: {}, total: 0 };
    storeRow.months[month] = (storeRow.months[month] || 0) + cases;
    storeRow.total += cases;
    if (!existing) loc.stores.push(storeRow);
  }
  const rowsOut = Array.from(locationMap.values())
    .map((loc) => ({ ...loc, stores: loc.stores.sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
  return { monthColumns, rows: rowsOut };
}

function ExpandableLocationRow({ row, monthColumns }: { row: LocationMonthRow; monthColumns: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="sticky left-0 bg-white px-4 py-3 font-semibold text-slate-900">
          <span className="inline-flex items-center gap-2"><ChevronRight className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-90" : ""}`} />{row.location}</span>
        </td>
        {monthColumns.map((m) => <td key={m} className="px-4 py-3 text-right text-slate-700">{row.months[m] || 0}</td>)}
        <td className="px-4 py-3 text-right font-bold text-slate-900">{row.total}</td>
      </tr>
      {open && row.stores.map((store) => (
        <tr key={`${row.location}-${store.store}`} className="border-t border-slate-100 bg-slate-50">
          <td className="sticky left-0 bg-slate-50 py-2 pl-12 pr-4 text-sm font-medium text-slate-700">{store.store}</td>
          {monthColumns.map((m) => <td key={m} className="px-4 py-2 text-right text-slate-600">{store.months[m] || 0}</td>)}
          <td className="px-4 py-2 text-right font-semibold text-slate-800">{store.total}</td>
        </tr>
      ))}
    </>
  );
}

function LocationCasesTable({ title, table, searchQuery, emptyText }: { title: string; table: { monthColumns: string[]; rows: LocationMonthRow[] }; searchQuery: string; emptyText: string }) {
  const q = normalize(searchQuery).toLowerCase();
  const rows = useMemo(() => {
    if (!q) return table.rows;
    return table.rows.filter((r) => r.location.toLowerCase().includes(q) || r.stores.some((s) => s.store.toLowerCase().includes(q)));
  }, [table.rows, q]);
  const exportRows = () => downloadCsv(
    title.toLowerCase().replace(/\s+/g, "-"),
    ["Location", "Store", ...table.monthColumns, "Total"],
    rows.flatMap((loc) => [
      [loc.location, "", ...table.monthColumns.map((m) => loc.months[m] || 0), loc.total],
      ...loc.stores.map((s) => [loc.location, s.store, ...table.monthColumns.map((m) => s.months[m] || 0), s.total]),
    ])
  );
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-slate-900">{title}</h3><p className="text-sm text-slate-500">Click a location to collapse/expand stores.</p></div>
        <button type="button" onClick={exportRows} disabled={!rows.length} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><FileSpreadsheet className="h-4 w-4" />Export</button>
      </div>
      {rows.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{emptyText}</div> : (
        <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
              <tr><th className="sticky left-0 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700">Location / Store</th>{table.monthColumns.map((m) => <th key={m} className="px-4 py-3 text-right font-semibold text-slate-700">{m}</th>)}<th className="px-4 py-3 text-right font-semibold text-slate-700">Total</th></tr>
            </thead>
            <tbody>{rows.map((row) => <ExpandableLocationRow key={row.location} row={row} monthColumns={table.monthColumns} />)}</tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}

function StoreCasesTable({ title, rows, months, searchQuery, emptyText }: { title: string; rows: TonyVelocityRow[]; months: string[]; searchQuery: string; emptyText: string }) {
  const monthColumns = [...months].sort(compareMonthLabelsAsc);
  const q = normalize(searchQuery).toLowerCase();

  const storeRows = useMemo(() => {
    const map = new Map<string, StoreMonthRow>();
    for (const row of rows) {
      const store = normalize(row.customer) || "Unknown Store";
      if (q && !store.toLowerCase().includes(q)) continue;
      const month = normalizeMonthLabel(row.month);
      if (!map.has(store)) map.set(store, { location: "", store, months: {}, total: 0 });
      const item = map.get(store)!;
      item.months[month] = (item.months[month] || 0) + getCases(row);
      item.total += getCases(row);
    }
    return Array.from(map.values()).sort((a, b) => a.store.localeCompare(b.store));
  }, [rows, q]);

  const exportRows = () => downloadCsv(
    title.toLowerCase().replace(/\s+/g, "-"),
    ["Store", ...monthColumns, "Total"],
    storeRows.map((store) => [store.store, ...monthColumns.map((m) => store.months[m] || 0), store.total])
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-slate-900">{title}</h3><p className="text-sm text-slate-500">Stores only. Location grouping removed.</p></div>
        <button type="button" onClick={exportRows} disabled={!storeRows.length} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><FileSpreadsheet className="h-4 w-4" />Export</button>
      </div>
      {storeRows.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{emptyText}</div> : (
        <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
              <tr><th className="sticky left-0 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700">Store</th>{monthColumns.map((m) => <th key={m} className="px-4 py-3 text-right font-semibold text-slate-700">{m}</th>)}<th className="px-4 py-3 text-right font-semibold text-slate-700">Total</th></tr>
            </thead>
            <tbody>{storeRows.map((store) => <tr key={store.store} className="border-t border-slate-200 hover:bg-slate-50"><td className="sticky left-0 bg-white px-4 py-3 font-semibold text-slate-900">{store.store}</td>{monthColumns.map((m) => <td key={m} className="px-4 py-3 text-right text-slate-700">{store.months[m] || 0}</td>)}<td className="px-4 py-3 text-right font-bold text-slate-900">{store.total}</td></tr>)}</tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}


type TonyAnalyticsStore = {
  store: string;
  location: string;
  months: Record<string, number>;
  total: number;
};

type TonyAnalyticsArea = {
  location: string;
  total: number;
  activeLastMonth: number;
  inactiveLastMonth: number;
  inactive3Plus: number;
  lastMonthCases: number;
  stores: TonyAnalyticsStore[];
};

function buildTonyAnalyticsContext(rows: TonyVelocityRow[], referenceMonth?: string) {
  const allMonths = Array.from(new Set(rows.map((r) => normalizeMonthLabel(r.month)))).sort(compareMonthLabelsAsc);
  const effectiveMonths = referenceMonth
    ? allMonths.filter((m) => getMonthSortValue(m) <= getMonthSortValue(referenceMonth))
    : allMonths;
  const recentMonths = effectiveMonths.slice(-6);
  const lastMonth = effectiveMonths[effectiveMonths.length - 1] || "";
  const prevMonth = effectiveMonths[effectiveMonths.length - 2] || "";

  const storeMap = new Map<string, TonyAnalyticsStore>();
  for (const row of rows) {
    const store = normalize(row.customer) || "Unknown Store";
    const location = normalize(row.location) || "Unmapped Location";
    const key = normalizeKey(store);
    if (!storeMap.has(key)) storeMap.set(key, { store, location, months: {}, total: 0 });
    const item = storeMap.get(key)!;
    const month = normalizeMonthLabel(row.month);
    item.months[month] = (item.months[month] || 0) + getCases(row);
    item.total += getCases(row);
  }

  const stores = Array.from(storeMap.values());
  const locationMap = new Map<string, TonyAnalyticsStore[]>();
  for (const store of stores) {
    if (!locationMap.has(store.location)) locationMap.set(store.location, []);
    locationMap.get(store.location)!.push(store);
  }

  const locationSummaries: TonyAnalyticsArea[] = Array.from(locationMap.entries()).map(([location, locationStores]) => {
    const total = locationStores.length;
    const activeLastMonth = locationStores.filter((s) => (s.months[lastMonth] || 0) > 0).length;
    const inactiveLastMonth = total - activeLastMonth;
    const inactive3Plus = locationStores.filter((s) => recentMonths.slice(-3).every((m) => (s.months[m] || 0) === 0) && s.total > 0).length;
    const lastMonthCases = locationStores.reduce((sum, s) => sum + (s.months[lastMonth] || 0), 0);
    const sortedStores = [...locationStores].sort((a, b) => {
      const activeDiff = Number((a.months[lastMonth] || 0) > 0) - Number((b.months[lastMonth] || 0) > 0);
      if (activeDiff !== 0) return activeDiff;
      return a.store.localeCompare(b.store);
    });
    return { location, total, activeLastMonth, inactiveLastMonth, inactive3Plus, lastMonthCases, stores: sortedStores };
  }).sort((a, b) => {
    const ar = a.total ? a.activeLastMonth / a.total : 0;
    const br = b.total ? b.activeLastMonth / b.total : 0;
    return br - ar;
  });

  const winBackCandidates = stores.filter((s) => {
    const last3 = recentMonths.slice(-3);
    const hadOlderVolume = effectiveMonths.some((m) => !last3.includes(m) && (s.months[m] || 0) > 0);
    return hadOlderVolume && last3.length === 3 && last3.every((m) => (s.months[m] || 0) === 0);
  }).sort((a, b) => b.total - a.total);

  const decliningStores = stores.filter((s) => {
    const r = recentMonths;
    if (r.length < 4) return false;
    const prev2avg = ((s.months[r[r.length - 4]] || 0) + (s.months[r[r.length - 3]] || 0)) / 2;
    const last2avg = ((s.months[r[r.length - 2]] || 0) + (s.months[r[r.length - 1]] || 0)) / 2;
    return prev2avg > 0 && last2avg < prev2avg * 0.5;
  }).sort((a, b) => b.total - a.total);

  const activeLastMonth = stores.filter((s) => (s.months[lastMonth] || 0) > 0).length;

  return { allMonths, effectiveMonths, recentMonths, lastMonth, prevMonth, stores, locationSummaries, winBackCandidates, decliningStores, activeLastMonth };
}

function AnalyticsControls({
  ctx,
  rows,
  analyticsSection,
  setAnalyticsSection,
  analyticsSearch,
  setAnalyticsSearch,
  analyticsLocation,
  setAnalyticsLocation,
  analyticsDateMode,
  setAnalyticsDateMode,
}: {
  ctx: ReturnType<typeof buildTonyAnalyticsContext>;
  rows: TonyVelocityRow[];
  analyticsSection: AnalyticsSection;
  setAnalyticsSection: (v: AnalyticsSection) => void;
  analyticsSearch: string;
  setAnalyticsSearch: (v: string) => void;
  analyticsLocation: string;
  setAnalyticsLocation: (v: string) => void;
  analyticsDateMode: "lastMonth" | "past6Months";
  setAnalyticsDateMode: (v: "lastMonth" | "past6Months") => void;
}) {
  const locationOptions = useMemo(() => ["All Locations", ...Array.from(new Set(rows.map((r) => normalize(r.location)).filter(Boolean))).sort((a, b) => a.localeCompare(b))], [rows]);
  if (!ctx) return null;
  const totalStores = ctx.stores.length;
  const activeStores = ctx.activeLastMonth;
  const pullRate = totalStores ? Math.round((activeStores / totalStores) * 100) : 0;

  const cardClass = "rounded-3xl border px-5 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md";
  const activeClass = "ring-2 ring-slate-900/20";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Sales Analytics</h2>
          <p className="mt-1 text-sm text-slate-500">Tony velocity pull rate, win-back, and declining store analysis.</p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-end">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Search</label>
            <SearchBar value={analyticsSearch} onChange={setAnalyticsSearch} placeholder="Search location or store..." />
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
            <select value={analyticsLocation} onChange={(e) => setAnalyticsLocation(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Reference Month</label>
            <select value={analyticsDateMode} onChange={(e) => setAnalyticsDateMode(e.target.value as "lastMonth" | "past6Months")} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
              <option value="lastMonth">Last Month ({ctx.lastMonth || "Latest"})</option>
              <option value="past6Months">Past 6 Months</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => setAnalyticsSection("summary")} className={`${cardClass} border-emerald-200 bg-emerald-50 text-emerald-700 ${analyticsSection === "summary" ? activeClass : ""}`}>
          <div className="text-sm font-semibold">Analytics</div>
          <div className="mt-1 text-xs opacity-70">{pullRate}% pull rate · {ctx.lastMonth || "latest"}</div>
          <div className="mt-2 text-3xl font-extrabold">{activeStores}<span className="text-base font-semibold opacity-50">/{totalStores}</span></div>
        </button>
        <button type="button" onClick={() => setAnalyticsSection("pull-rate")} className={`${cardClass} border-purple-200 bg-purple-50 text-purple-700 ${analyticsSection === "pull-rate" ? activeClass : ""}`}>
          <div className="text-sm font-semibold">Pull Out Rate</div>
          <div className="mt-1 text-xs opacity-70">Active stores / total stores</div>
          <div className="mt-2 text-3xl font-extrabold">{pullRate}%</div>
        </button>
        <button type="button" onClick={() => setAnalyticsSection("win-back")} className={`${cardClass} border-amber-200 bg-slate-50 text-slate-700 ${analyticsSection === "win-back" ? activeClass : ""}`}>
          <div className="text-sm font-semibold">Win-Back Candidates</div>
          <div className="mt-1 text-xs opacity-70">Zero last 3 months, had prior volume</div>
          <div className="mt-2 text-3xl font-extrabold">{ctx.winBackCandidates.length}<span className="ml-1 text-xs font-semibold opacity-50">stores</span></div>
        </button>
        <button type="button" onClick={() => setAnalyticsSection("declining")} className={`${cardClass} border-red-200 bg-slate-50 text-slate-600 ${analyticsSection === "declining" ? activeClass : ""}`}>
          <div className="text-sm font-semibold">Declining Stores</div>
          <div className="mt-1 text-xs opacity-70">Volume dropped 50%+</div>
          <div className="mt-2 text-3xl font-extrabold">{ctx.decliningStores.length}<span className="ml-1 text-xs font-semibold text-red-400">stores</span></div>
        </button>
      </div>
    </div>
  );
}

function AnalyticsTab({ ctx, analyticsSection }: { ctx: ReturnType<typeof buildTonyAnalyticsContext>; analyticsSection: AnalyticsSection }) {
  if (!ctx) return null;

  const winBackByLocation = Array.from(ctx.winBackCandidates.reduce((map, store) => {
    map.set(store.location, (map.get(store.location) || 0) + 1);
    return map;
  }, new Map<string, number>())).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const decliningByLocation = Array.from(ctx.decliningStores.reduce((map, store) => {
    map.set(store.location, (map.get(store.location) || 0) + 1);
    return map;
  }, new Map<string, number>())).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const SummaryPanels = () => (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-800">Top 5 Locations by Pull Rate</h3>
        <p className="mb-3 text-xs text-slate-400">{ctx.lastMonth}</p>
        <div className="space-y-3">
          {ctx.locationSummaries.slice(0, 5).map((area, i) => {
            const rate = area.total > 0 ? Math.round((area.activeLastMonth / area.total) * 100) : 0;
            const barColor = rate >= 70 ? "bg-emerald-500" : rate >= 40 ? "bg-amber-400" : "bg-red-400";
            return (
              <div key={area.location} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-700">{area.location}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${barColor}`} style={{ width: `${rate}%` }} /></div>
                </div>
                <span className="w-10 shrink-0 text-right text-xs font-bold text-emerald-600">{rate}%</span>
                <span className="w-12 shrink-0 text-right text-xs text-slate-400">{area.activeLastMonth}/{area.total}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-3xl border border-amber-200 bg-slate-50 p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Win-Back by Location</h3>
        <p className="mb-3 text-xs text-amber-600">Locations with most win-back stores</p>
        <div className="space-y-2">{winBackByLocation.length ? winBackByLocation.map(([location, count], i) => <div key={location} className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-700">{i + 1}. {location}</span><span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800">{count} win-back</span></div>) : <p className="text-xs text-slate-500">No win-back candidates.</p>}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-900">Declining Stores by Location</h3>
        <p className="mb-3 text-xs text-slate-600">Locations with stores declining 50%+</p>
        <div className="space-y-2">{decliningByLocation.length ? decliningByLocation.map(([location, count], i) => <div key={location} className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-700">{i + 1}. {location}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{count} stores</span></div>) : <p className="text-xs text-slate-500">No declining stores.</p>}</div>
      </div>
    </div>
  );

  const PullRateTable = () => (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-slate-900">Location Pull Rate Breakdown</h3>
      <p className="mb-4 text-sm text-slate-500">Sorted by pull rate. Pull Rate = active stores in {ctx.lastMonth} / total stores.</p>
      <div className="overflow-hidden rounded-2xl border border-slate-200"><div className="max-h-[70vh] overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 z-10 bg-slate-50 shadow-sm"><tr><th className="px-4 py-3 text-left font-semibold text-slate-700">Location</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Total Stores</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Active</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Inactive</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Gone 3+ Months</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Pull Rate</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Cases</th></tr></thead><tbody>{ctx.locationSummaries.map((row) => { const rate = row.total ? Math.round((row.activeLastMonth / row.total) * 100) : 0; return <tr key={row.location} className="border-t border-slate-200 hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-900">{row.location}</td><td className="px-4 py-3 text-right text-slate-700">{row.total}</td><td className="px-4 py-3 text-right font-semibold text-emerald-700">{row.activeLastMonth}</td><td className="px-4 py-3 text-right text-slate-600">{row.inactiveLastMonth}</td><td className="px-4 py-3 text-right text-slate-600">{row.inactive3Plus}</td><td className="px-4 py-3 text-right font-bold text-slate-900">{rate}%</td><td className="px-4 py-3 text-right font-semibold text-slate-900">{row.lastMonthCases}</td></tr>; })}</tbody></table></div></div>
    </div>
  );

  const StoreTable = ({ title, stores, tone }: { title: string; stores: TonyAnalyticsStore[]; tone: "amber" | "red" }) => (
    <div className={`rounded-3xl border ${tone === "amber" ? "border-amber-200 bg-slate-50" : "border-slate-200 bg-white"} p-6 shadow-sm`}>
      <h3 className="mb-1 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mb-4 text-sm text-slate-500">{stores.length} stores found for the current filters.</p>
      {stores.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">No stores found.</div> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="max-h-[70vh] overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 z-10 bg-slate-50 shadow-sm"><tr><th className="px-4 py-3 text-left font-semibold text-slate-700">Store</th><th className="px-4 py-3 text-left font-semibold text-slate-700">Location</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Total Cases</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Cases ({ctx.lastMonth})</th></tr></thead><tbody>{stores.map((s) => <tr key={`${s.location}-${s.store}`} className="border-t border-slate-200 hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-900">{s.store}</td><td className="px-4 py-3 text-slate-700">{s.location}</td><td className="px-4 py-3 text-right font-bold text-slate-900">{s.total}</td><td className="px-4 py-3 text-right text-slate-700">{s.months[ctx.lastMonth] || 0}</td></tr>)}</tbody></table></div></div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {analyticsSection === "summary" && <SummaryPanels />}
      {analyticsSection === "pull-rate" && <PullRateTable />}
      {analyticsSection === "win-back" && <StoreTable title="Win-Back Candidates" stores={ctx.winBackCandidates} tone="amber" />}
      {analyticsSection === "declining" && <StoreTable title="Declining Stores" stores={ctx.decliningStores} tone="red" />}
    </div>
  );
}

function PriorityEditor({ list, setList }: { list: string[]; setList: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const addItems = () => {
    const incoming = draft.split(/\n|,/).map(normalize).filter(Boolean);
    if (!incoming.length) return;
    const seen = new Set(list.map(normalizeKey));
    setList([...list, ...incoming.filter((item) => { const key = normalizeKey(item); if (seen.has(key)) return false; seen.add(key); return true; })]);
    setDraft("");
  };
  const reset = () => setList(DEFAULT_PRIORITY_STORES);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div><h3 className="text-lg font-semibold text-slate-900">Priority Pull Out List</h3><p className="text-sm text-slate-500">Edit this list anytime. It is saved in this browser via localStorage.</p></div>
        <button type="button" onClick={reset} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Reset default</button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Add Store(s)</label>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste one store per line, or comma-separated" className="h-36 w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm outline-none focus:border-slate-400" />
          <button type="button" onClick={addItems} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus className="h-4 w-4" />Add to Priority</button>
        </div>
        <div className="max-h-72 overflow-auto rounded-2xl border border-slate-200">
          {list.map((store) => <div key={store} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0"><span className="font-medium text-slate-800">{store}</span><button type="button" onClick={() => setList(list.filter((x) => x !== store))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button></div>)}
        </div>
      </div>
    </div>
  );
}

function LocationResolutionModal({ missing, suggestions, onCancel, onSave }: { missing: MissingLocation[]; suggestions: TonyLocation[]; onCancel: () => void; onSave: (items: MissingLocation[]) => void }) {
  const [items, setItems] = useState<MissingLocation[]>(missing);
  const updateLocation = (customer: string, location: string) => setItems((prev) => prev.map((item) => item.customer === customer ? { ...item, location } : item));
  const canSave = items.every((item) => item.location.trim());
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6">
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4"><h2 className="text-xl font-bold text-slate-900">New locations need mapping</h2><p className="mt-1 text-sm text-slate-500">Type a location for each new store/customer, then save.</p></div>
        <div className="max-h-[58vh] overflow-y-auto p-6"><div className="space-y-4">{items.map((item) => <div key={item.customer} className="rounded-2xl border border-slate-200 p-4"><div className="grid grid-cols-1 gap-3 lg:grid-cols-2"><div><label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Store</label><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{item.customer}</div></div><div><label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Location</label><input value={item.location} onChange={(e) => updateLocation(item.customer, e.target.value)} placeholder="Type location..." className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" /></div></div><div className="mt-3 flex flex-wrap gap-2">{suggestions.filter((s) => normalizeKey(s.location).includes(normalizeKey(item.location || item.customer)) || normalizeKey(s.customer).includes(normalizeKey(item.customer))).slice(0, 8).map((option) => <button key={`${item.customer}-${option.customer}-${option.location}`} type="button" onClick={() => updateLocation(item.customer, option.location)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">{option.location}</button>)}</div></div>)}</div></div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4"><button type="button" onClick={onCancel} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button type="button" onClick={() => onSave(items)} disabled={!canSave} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">Save locations & continue upload</button></div>
      </div>
    </div>
  );
}

export default function TonyDashboardView() {
  const velocityInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("analytics");
  const [analyticsSection, setAnalyticsSection] = useState<AnalyticsSection>("summary");
  const [analyticsSearch, setAnalyticsSearch] = useState("");
  const [analyticsLocation, setAnalyticsLocation] = useState("All Locations");
  const [analyticsDateMode, setAnalyticsDateMode] = useState<"lastMonth" | "past6Months">("lastMonth");

  const [rows, setRows] = useState<TonyVelocityRow[]>([]);
  const [locations, setLocations] = useState<TonyLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingVelocity, setUploadingVelocity] = useState(false);
  const [uploadingLocations, setUploadingLocations] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [showVelocityUploadOptions, setShowVelocityUploadOptions] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [manualCustomer, setManualCustomer] = useState("");
  const [manualLocation, setManualLocation] = useState("");
  const [pendingRows, setPendingRows] = useState<TonyVelocityRow[]>([]);
  const [pendingSourceName, setPendingSourceName] = useState("");
  const [missingLocations, setMissingLocations] = useState<MissingLocation[]>([]);

  const [velocityMode, setVelocityMode] = useState<PeriodMode>("past6Months");
  const [velocityFrom, setVelocityFrom] = useState(getPastMonthsInputValue(5));
  const [velocityTo, setVelocityTo] = useState(getCurrentMonthInputValue());
  const [selectedVelocityLocation, setSelectedVelocityLocation] = useState("All");

  const [pulloutMode, setPulloutMode] = useState<PeriodMode>("past6Months");
  const [pulloutFrom, setPulloutFrom] = useState(getPastMonthsInputValue(5));
  const [pulloutTo, setPulloutTo] = useState(getCurrentMonthInputValue());
  const [pulloutSearch, setPulloutSearch] = useState("");

  const [priorityList, setPriorityListRaw] = useState<string[]>(DEFAULT_PRIORITY_STORES);
  const setPriorityList = (items: string[]) => setPriorityListRaw(Array.from(new Map(items.map((x) => [normalizeKey(x), normalize(x)])).values()).filter(Boolean));

  useEffect(() => {
    const saved = window.localStorage.getItem("tony-priority-pullout-stores");
    if (saved) {
      try { setPriorityList(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);
  useEffect(() => { window.localStorage.setItem("tony-priority-pullout-stores", JSON.stringify(priorityList)); }, [priorityList]);

  const loadData = async () => {
    setLoading(true); setError("");
    try {
      const pageSize = 1000; let from = 0; let all: TonyVelocityRow[] = [];
      while (true) {
        const { data, error: velocityError } = await supabase.from("tony_velocity").select("*").range(from, from + pageSize - 1);
        if (velocityError) throw velocityError;
        const batch = (data ?? []) as TonyVelocityRow[];
        all = [...all, ...batch];
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      const { data: locationData, error: locationError } = await supabase.from("tony_locations").select("*").order("customer", { ascending: true });
      if (locationError) throw locationError;
      setRows(all);
      setLocations((locationData ?? []) as TonyLocation[]);
    } catch (err: any) { setError(err?.message || "Failed to load Tony dashboard data."); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3500); return () => window.clearTimeout(timer); }, [notice]);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations) map.set(normalizeKey(loc.customer), normalize(loc.location));
    return map;
  }, [locations]);

  const parseVelocityRows = async (file: File) => {
    const rawRows = await readWorkbookRows(file);
    if (!rawRows.length) return [];
    const headers = Object.keys(rawRows[0]);
    const month = monthLabel(selectedMonth, selectedYear);
    return rawRows.map((row) => {
      const customer = normalize(getCell(row, headers, ["sh Long Description", "Customer", "Ship to Customer"]));
      const location = locationMap.get(normalizeKey(customer)) || "";
      const quantityShipped = toNumber(getCell(row, headers, ["Quantity shipped", "Quantity shipped Mar 26 to Mar 26"]));
      return { month, warehouse: normalize(getCell(row, headers, ["Warehouse"])), location, customer, cheesecakes: normalize(getCell(row, headers, ["Cheesecakes"])), item_pack: normalize(getCell(row, headers, ["Item Pack"])), item_size: normalize(getCell(row, headers, ["Item Size"])), vendor_item: normalize(getCell(row, headers, ["Vendor Item"])), quantity_shipped: quantityShipped, eaches: quantityShipped * 12, ext_net_ship_weight: toNumber(getCell(row, headers, ["Ext Net Ship Weight", "Ext Net Ship Weight Mar 26 to Mar 26"])), actual_cost_gross: toNumber(getCell(row, headers, ["Actual Cost Gross", "Actual Cost Gross Mar 26 to Mar 26"])), source_file_name: file.name };
    }).filter((row) => row.customer || row.warehouse || row.vendor_item);
  };

  const uploadVelocityRows = async (uploadRows: TonyVelocityRow[]) => {
    if (!uploadRows.length) { setNotice("No rows found in the uploaded file."); return; }
    const { error: deleteError } = await supabase.from("tony_velocity").delete().eq("month", monthLabel(selectedMonth, selectedYear));
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from("tony_velocity").insert(uploadRows);
    if (insertError) throw insertError;
    setNotice(`Uploaded ${uploadRows.length.toLocaleString()} Tony velocity rows.`);
    setShowVelocityUploadOptions(false);
    await loadData();
  };

  const handleVelocityFile = async (file?: File) => {
    if (!file) return;
    setUploadingVelocity(true); setError(""); setNotice("");
    try {
      const parsed = await parseVelocityRows(file);
      const missingMap = new Map<string, MissingLocation>();
      for (const row of parsed) if (row.customer && !row.location) missingMap.set(row.customer, { customer: row.customer, location: "" });
      if (missingMap.size > 0) { setPendingRows(parsed); setPendingSourceName(file.name); setMissingLocations(Array.from(missingMap.values())); return; }
      await uploadVelocityRows(parsed);
    } catch (err: any) { setError(err?.message || "Failed to upload Tony velocity file."); }
    finally { setUploadingVelocity(false); if (velocityInputRef.current) velocityInputRef.current.value = ""; }
  };

  const handleLocationFile = async (file?: File) => {
    if (!file) return;
    setUploadingLocations(true); setError(""); setNotice("");
    try {
      const rawRows = await readWorkbookRows(file);
      if (!rawRows.length) { setNotice("No location rows found."); return; }
      const headers = Object.keys(rawRows[0]);
      const parsed = rawRows.map((row) => ({ customer: normalize(getCell(row, headers, ["Customer", "Ship to Customer", "sh Long Description"])), location: normalize(getCell(row, headers, ["Location", "Mapped Location"])) })).filter((row) => row.customer && row.location);
      if (!parsed.length) { setNotice("No Customer + Location mappings found in the uploaded file."); return; }
      const { error: upsertError } = await supabase.from("tony_locations").upsert(parsed, { onConflict: "customer" });
      if (upsertError) throw upsertError;
      setNotice(`Uploaded ${parsed.length.toLocaleString()} location mappings.`); setShowLocationModal(false); await loadData();
    } catch (err: any) { setError(err?.message || "Failed to upload Tony location file."); }
    finally { setUploadingLocations(false); if (locationInputRef.current) locationInputRef.current.value = ""; }
  };

  const saveMissingLocations = async (items: MissingLocation[]) => {
    setUploadingVelocity(true); setError(""); setNotice("");
    try {
      const mappings = items.map((item) => ({ customer: normalize(item.customer), location: normalize(item.location) }));
      const { error: upsertError } = await supabase.from("tony_locations").upsert(mappings, { onConflict: "customer" });
      if (upsertError) throw upsertError;
      const newMap = new Map(locationMap); mappings.forEach((item) => newMap.set(normalizeKey(item.customer), item.location));
      const resolvedRows = pendingRows.map((row) => ({ ...row, location: row.location || newMap.get(normalizeKey(row.customer)) || "", source_file_name: pendingSourceName || row.source_file_name }));
      setMissingLocations([]); setPendingRows([]); setPendingSourceName("");
      await uploadVelocityRows(resolvedRows);
    } catch (err: any) { setError(err?.message || "Failed to save location mappings."); }
    finally { setUploadingVelocity(false); }
  };

  const saveManualLocation = async () => {
    const customer = normalize(manualCustomer); const location = normalize(manualLocation);
    if (!customer || !location) { setError("Please enter both Store and Location."); return; }
    setUploadingLocations(true); setError(""); setNotice("");
    try {
      const { error: upsertError } = await supabase.from("tony_locations").upsert([{ customer, location }], { onConflict: "customer" });
      if (upsertError) throw upsertError;
      setManualCustomer(""); setManualLocation(""); setNotice("Location mapping saved."); setShowLocationModal(false); await loadData();
    } catch (err: any) { setError(err?.message || "Failed to save location mapping."); }
    finally { setUploadingLocations(false); }
  };

  const velocityMonths = useMemo(() => selectedMonthsFromMode(velocityMode, velocityFrom, velocityTo), [velocityMode, velocityFrom, velocityTo]);
  const pulloutMonths = useMemo(() => selectedMonthsFromMode(pulloutMode, pulloutFrom, pulloutTo), [pulloutMode, pulloutFrom, pulloutTo]);
  const prioritySet = useMemo(() => new Set(priorityList.map(normalizeKey)), [priorityList]);

  const velocityRows = useMemo(() => rows.filter((r) => velocityMonths.includes(normalizeMonthLabel(r.month))), [rows, velocityMonths]);
  const pulloutRows = useMemo(() => rows.filter((r) => pulloutMonths.includes(normalizeMonthLabel(r.month))), [rows, pulloutMonths]);
  const priorityRows = useMemo(() => pulloutRows.filter((r) => prioritySet.has(normalizeKey(r.customer))), [pulloutRows, prioritySet]);

  const velocityLocationOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const row of rows) {
      const location = normalize(row.location) || "Unmapped Location";
      const key = normalizeKey(location);
      if (key && !unique.has(key)) unique.set(key, location);
    }
    return ["All", ...Array.from(unique.values()).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const selectedVelocityLocationKey = normalizeKey(selectedVelocityLocation);

  const totalCasesSeries = useMemo(() => {
    const months = [...velocityMonths].sort(compareMonthLabelsAsc);
    const totals: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));

    for (const row of velocityRows) {
      const location = normalize(row.location) || "Unmapped Location";
      if (selectedVelocityLocationKey !== "ALL" && normalizeKey(location) !== selectedVelocityLocationKey) continue;

      const month = normalizeMonthLabel(row.month);
      totals[month] = (totals[month] || 0) + getCases(row);
    }

    return {
      months,
      series: [
        {
          name: selectedVelocityLocationKey === "ALL" ? "All Locations" : selectedVelocityLocation,
          fill: "#4a83e7",
          values: months.map((m) => totals[m] || 0),
        },
      ],
    };
  }, [velocityRows, velocityMonths, selectedVelocityLocation, selectedVelocityLocationKey]);

  const pulloutTable = useMemo(() => buildLocationTable(pulloutRows, pulloutMonths), [pulloutRows, pulloutMonths]);

  const analyticsFilteredRows = useMemo(() => {
    const q = normalize(analyticsSearch).toLowerCase();
    return rows.filter((row) => {
      const location = normalize(row.location) || "Unmapped Location";
      const store = normalize(row.customer) || "Unknown Store";
      const textMatch = !q || location.toLowerCase().includes(q) || store.toLowerCase().includes(q) || normalize(row.vendor_item).toLowerCase().includes(q);
      const locationMatch = analyticsLocation === "All Locations" || normalizeKey(location) === normalizeKey(analyticsLocation);
      return textMatch && locationMatch;
    });
  }, [rows, analyticsSearch, analyticsLocation]);

  const analyticsAvailableMonths = useMemo(() => Array.from(new Set(analyticsFilteredRows.map((r) => normalizeMonthLabel(r.month)))).sort(compareMonthLabelsAsc), [analyticsFilteredRows]);
  const analyticsReferenceMonth = analyticsAvailableMonths[analyticsAvailableMonths.length - 1] || "";
  const analyticsRowsByDate = useMemo(() => {
    if (analyticsDateMode === "lastMonth") return analyticsFilteredRows;
    const selected = new Set(analyticsAvailableMonths.slice(-6));
    return analyticsFilteredRows.filter((row) => selected.has(normalizeMonthLabel(row.month)));
  }, [analyticsDateMode, analyticsFilteredRows, analyticsAvailableMonths]);

  const analyticsCtx = useMemo(() => buildTonyAnalyticsContext(analyticsRowsByDate, analyticsReferenceMonth), [analyticsRowsByDate, analyticsReferenceMonth]);

  const renderTabButtons = () => <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-wrap gap-2">{(["analytics", "velocity", "pullout", "priority-pullout"] as TabKey[]).map((tab) => <FilterButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab === "pullout" ? "Pull out" : tab === "priority-pullout" ? "Priority Pull out" : tab === "analytics" ? "Analytics" : tab.charAt(0).toUpperCase() + tab.slice(1)}</FilterButton>)}</div></div>;

  const uploadHeader = (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-end">
      <button type="button" onClick={() => setShowLocationModal(true)} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" disabled={uploadingLocations}><Upload className="h-4 w-4" />{uploadingLocations ? "Uploading..." : "Upload Location"}</button>
      <button type="button" onClick={() => setShowVelocityUploadOptions((open) => !open)} className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800" disabled={uploadingVelocity}><Upload className="h-4 w-4" />{uploadingVelocity ? "Uploading..." : "Upload Velocity File"}</button>
      <button type="button" onClick={loadData} className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Refresh</button>
      <input ref={locationInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleLocationFile(e.target.files?.[0])} />
      <input ref={velocityInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleVelocityFile(e.target.files?.[0])} />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <div className="sticky top-[92px] z-20 shrink-0">
        <div className="z-20 bg-slate-100 px-6 pb-3 pt-3 shadow-[0_2px_8px_0_rgba(0,0,0,0.06)]">
          <div className="pb-2">{renderTabButtons()}</div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {activeTab === "analytics" && analyticsCtx ? (
              <AnalyticsControls
                ctx={analyticsCtx}
                rows={rows}
                analyticsSection={analyticsSection}
                setAnalyticsSection={setAnalyticsSection}
                analyticsSearch={analyticsSearch}
                setAnalyticsSearch={setAnalyticsSearch}
                analyticsLocation={analyticsLocation}
                setAnalyticsLocation={setAnalyticsLocation}
                analyticsDateMode={analyticsDateMode}
                setAnalyticsDateMode={setAnalyticsDateMode}
              />
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold text-slate-900">Tony&apos;s Dashboard</h2>
                  {activeTab === "velocity" && (
                    <p className="text-sm font-medium text-slate-500">Total Cases per Month</p>
                  )}
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-end">
                  {activeTab === "velocity" && (
                    <>
                      <div className="min-w-[260px]">
                        <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
                        <select
                          value={selectedVelocityLocation}
                          onChange={(e) => setSelectedVelocityLocation(e.target.value)}
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none"
                        >
                          {velocityLocationOptions.map((location) => (
                            <option key={location} value={location}>{location}</option>
                          ))}
                        </select>
                      </div>
                      <PeriodFilters mode={velocityMode} setMode={setVelocityMode} from={velocityFrom} setFrom={setVelocityFrom} to={velocityTo} setTo={setVelocityTo} />
                    </>
                  )}

                  {(activeTab === "pullout" || activeTab === "priority-pullout") && (
                    <>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Search</label>
                        <SearchBar value={pulloutSearch} onChange={setPulloutSearch} placeholder="Search store..." />
                      </div>
                      <PeriodFilters mode={pulloutMode} setMode={setPulloutMode} from={pulloutFrom} setFrom={setPulloutFrom} to={pulloutTo} setTo={setPulloutTo} />
                    </>
                  )}
                </div>
              </div>
            )}

            {showVelocityUploadOptions && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_160px_180px]">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Upload Month</label>
                    <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none">
                      {MONTHS.map((month) => <option key={month}>{month}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                    <input value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" />
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => velocityInputRef.current?.click()} disabled={uploadingVelocity} className="h-11 w-full rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                      Choose File for {monthLabel(selectedMonth, selectedYear)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {notice && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 px-6 pb-10 pt-4">
        {loading && <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading Tony dashboard data...</div>}

        {!loading && activeTab === "analytics" && analyticsCtx && (
          <AnalyticsTab ctx={analyticsCtx} analyticsSection={analyticsSection} />
        )}

        {!loading && activeTab === "velocity" && (
          <GroupedMonthlyChart
            title={selectedVelocityLocation === "All" ? "Total Cases per Month" : `Total Cases per Month: ${selectedVelocityLocation}`}
            months={totalCasesSeries.months}
            series={totalCasesSeries.series}
          />
        )}

        {!loading && activeTab === "pullout" && (
          <LocationCasesTable
            title="Pull Out: Monthly Cases per Location"
            table={pulloutTable}
            searchQuery={pulloutSearch}
            emptyText="No pull out rows found for the selected filters."
          />
        )}

        {!loading && activeTab === "priority-pullout" && (
          <StoreCasesTable
            title="Priority Pull Out: Monthly Cases per Store"
            rows={priorityRows}
            months={pulloutMonths}
            searchQuery={pulloutSearch}
            emptyText="No priority pull out rows found for the selected filters."
          />
        )}
      </div>

      {showLocationModal && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6"><div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"><div className="border-b border-slate-200 px-6 py-4"><h2 className="text-xl font-bold text-slate-900">Upload or Add Tony Location</h2><p className="mt-1 text-sm text-slate-500">Add one Store → Location mapping, or bulk upload Excel/CSV with columns Store/Customer and Location.</p></div><div className="space-y-5 p-6"><div className="rounded-2xl border border-slate-200 p-4"><h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Manual Entry</h3><div className="grid grid-cols-1 gap-3 md:grid-cols-2"><div><label className="mb-1 block text-sm font-medium text-slate-700">Store</label><input value={manualCustomer} onChange={(e) => setManualCustomer(e.target.value)} placeholder="Example: ANDRONICO'S #0173" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" /></div><div><label className="mb-1 block text-sm font-medium text-slate-700">Location</label><input value={manualLocation} onChange={(e) => setManualLocation(e.target.value)} placeholder="Example: ANDRONICO'S" className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" /></div></div><div className="mt-4 flex justify-end"><button type="button" onClick={saveManualLocation} disabled={uploadingLocations} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Save Location</button></div></div><div className="rounded-2xl border border-slate-200 p-4"><h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Bulk Upload</h3><p className="mb-3 text-sm text-slate-500">Upload an Excel or CSV file with columns Customer/Store and Location.</p><button type="button" onClick={() => locationInputRef.current?.click()} disabled={uploadingLocations} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Upload className="h-4 w-4" />{uploadingLocations ? "Uploading..." : "Choose Location File"}</button></div></div><div className="flex justify-end border-t border-slate-200 px-6 py-4"><button type="button" onClick={() => setShowLocationModal(false)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button></div></div></div>}
      {missingLocations.length > 0 && <LocationResolutionModal missing={missingLocations} suggestions={locations} onCancel={() => { setMissingLocations([]); setPendingRows([]); setPendingSourceName(""); }} onSave={saveMissingLocations} />}
    </div>
  );
}
