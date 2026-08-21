"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";
import { readBrowserCache, writeBrowserCache } from "@/lib/browser-cache";

type HyveeInvoiceRow = {
  id: number;
  month: string | null;
  type: string | null;
  check_number: string | null;
  check_date: string | null;
  check_amount: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number | null;
  discount_amount: number | null;
  adjustment_amount: number | null;
  net_amount: number | null;
  explanation: string | null;
  line_number: number | null;
  source_file_name: string | null;
};

type LineGroup = {
  label: string;
  rows: HyveeInvoiceRow[];
  total: number;
  isInvoice: boolean;
};

const PAGE_SIZE = 1000;
const HYVEE_WM_INVOICE_TYPE = "Hy-Vee WM Invoice";
const HYVEE_BROKER_COMMISSION_CACHE_KEY =
  "wmksolve:report-cache:hyvee-broker-commission:v1";

type HyveeBrokerCommissionCache = {
  rows: HyveeInvoiceRow[];
};

const MONTH_NAMES = [
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

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;

  return `${month}/${day}/${year}`;
}

function normalizeType(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isExplicitWMInvoice(row: HyveeInvoiceRow) {
  return normalizeType(row.type).includes("hyveewminvoice");
}

function isInferredWMInvoice(row: HyveeInvoiceRow) {
  return (
    Number(row.gross_amount || 0) > 0 &&
    Number(row.net_amount || 0) > 0 &&
    normalizeType(row.explanation).includes("balances")
  );
}

function isWMInvoice(row: HyveeInvoiceRow) {
  return isExplicitWMInvoice(row) || isInferredWMInvoice(row);
}

function getMonthLabel(row: HyveeInvoiceRow) {
  if (row.check_date) {
    const [year, month] = row.check_date.split("-").map(Number);
    if (year && month) {
      return `${MONTH_NAMES[month - 1]} '${String(year).slice(-2)}`;
    }
  }

  return row.month || "Unknown";
}

function getMonthSortValue(rows: HyveeInvoiceRow[]) {
  const dates = rows
    .map((row) => row.check_date || "")
    .filter(Boolean)
    .sort();

  if (dates.length) {
    const [year, month] = dates[dates.length - 1].split("-").map(Number);
    return year * 100 + month;
  }

  const month = getMonthLabel(rows[0]);
  const parsed = new Date(`1 ${month}`);

  if (Number.isNaN(parsed.getTime())) return 0;

  return parsed.getFullYear() * 100 + parsed.getMonth() + 1;
}

function getLineLabel(row: HyveeInvoiceRow) {
  if (isWMInvoice(row)) {
    return row.invoice_number
      ? `${HYVEE_WM_INVOICE_TYPE} ${row.invoice_number}`
      : HYVEE_WM_INVOICE_TYPE;
  }

  return row.type || row.explanation || "Hy-Vee Charge";
}

function isNoiseRow(row: HyveeInvoiceRow) {
  return /amount\s*=\s*amount\s*bsr/i.test(row.explanation || "");
}

function filterBrokerRows(rows: HyveeInvoiceRow[]) {
  return rows.filter((row) => !isNoiseRow(row));
}

function getTotals(rows: HyveeInvoiceRow[]) {
  const wmInvoiceTotal = round2(
    rows
      .filter(isWMInvoice)
      .reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
  );

  const charges = round2(
    rows
      .filter((row) => !isWMInvoice(row))
      .reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
  );

  const netTotal = round2(wmInvoiceTotal + charges);
  const brokerFee = round2(netTotal * 0.05);

  return {
    wmInvoiceTotal,
    charges,
    netTotal,
    brokerFee,
  };
}

function groupRowsByMonth(rows: HyveeInvoiceRow[]) {
  const map = new Map<string, HyveeInvoiceRow[]>();

  for (const row of rows) {
    const month = getMonthLabel(row);
    if (!map.has(month)) map.set(month, []);
    map.get(month)!.push(row);
  }

  return Array.from(map.entries())
    .map(([month, monthRows]) => ({
      month,
      rows: monthRows,
      totals: getTotals(monthRows),
      sortValue: getMonthSortValue(monthRows),
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
}

function groupRowsByLine(rows: HyveeInvoiceRow[]): LineGroup[] {
  const map = new Map<string, HyveeInvoiceRow[]>();

  for (const row of rows) {
    const label = getLineLabel(row);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(row);
  }

  return Array.from(map.entries())
    .map(([label, lineRows]) => ({
      label,
      rows: lineRows,
      total: round2(lineRows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0)),
      isInvoice: lineRows.some(isWMInvoice),
    }))
    .sort((a, b) => {
      if (a.isInvoice && !b.isInvoice) return -1;
      if (!a.isInvoice && b.isInvoice) return 1;
      return a.label.localeCompare(b.label);
    });
}

async function fetchAllHyveeRows() {
  let from = 0;
  let allRows: HyveeInvoiceRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("hyvee_invoices")
      .select("*")
      .order("check_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data || []) as HyveeInvoiceRow[];
    allRows = [...allRows, ...batch];

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export default function HyveeBrokerCommissionView() {
  const [startupCache] = useState<HyveeBrokerCommissionCache | null>(() =>
    readBrowserCache<HyveeBrokerCommissionCache>(HYVEE_BROKER_COMMISSION_CACHE_KEY)
  );
  const [rows, setRows] = useState<HyveeInvoiceRow[]>(() =>
    filterBrokerRows(startupCache?.rows || [])
  );
  const [loading, setLoading] = useState(() => !startupCache);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  const loadData = async (hasCachedData = false) => {
    if (!hasCachedData) setLoading(true);

    try {
      const nextRows = filterBrokerRows(await fetchAllHyveeRows());
      setRows(nextRows);
      writeBrowserCache<HyveeBrokerCommissionCache>(
        HYVEE_BROKER_COMMISSION_CACHE_KEY,
        { rows: nextRows }
      );
    } catch (error) {
      console.error("Hy-Vee broker commission load error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void loadData(Boolean(startupCache));
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [startupCache]);

  const monthGroups = useMemo(() => groupRowsByMonth(rows), [rows]);

  const toggleMonth = (month: string) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [month]: !prev[month],
    }));
  };

  const toggleLine = (key: string) => {
    setExpandedLines((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Hy-Vee Broker Commission Summary
        </h1>

        <p className="mt-1 text-xs text-slate-500">
          Hy-Vee invoices less charges, calculated at a 5% broker fee.
        </p>
      </div>

      {loading ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-8 text-sm text-slate-500">
            Loading Hy-Vee broker commission...
          </CardContent>
        </Card>
      ) : monthGroups.length === 0 ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-8 text-sm text-slate-500">
            No Hy-Vee invoice data found.
          </CardContent>
        </Card>
      ) : (
        monthGroups.map((monthGroup) => {
          const isMonthOpen = !!expandedMonths[monthGroup.month];
          const lineGroups = groupRowsByLine(monthGroup.rows);

          return (
            <Card
              key={monthGroup.month}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <CardContent className="p-0">
                <div className="flex w-full items-center justify-between px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleMonth(monthGroup.month)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <div>
                      {isMonthOpen ? (
                        <ChevronDown className="h-4 w-4 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      )}
                    </div>

                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        {monthGroup.month}
                      </h2>

                      <p className="text-xs text-slate-500">
                        {lineGroups.length} line item buckets
                      </p>
                    </div>
                  </button>

                  <div className="grid grid-cols-[130px_130px_130px_130px] items-end gap-8 text-right">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        WM Invoice
                      </div>

                      <div className="text-sm font-bold text-slate-900">
                        {formatCurrency(monthGroup.totals.wmInvoiceTotal)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Charges
                      </div>

                      <div className="text-sm font-bold text-red-600">
                        {formatCurrency(monthGroup.totals.charges)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Net
                      </div>

                      <div className="text-sm font-bold text-slate-900">
                        {formatCurrency(monthGroup.totals.netTotal)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        5% Fee
                      </div>

                      <div className="text-sm font-bold text-emerald-600">
                        {formatCurrency(monthGroup.totals.brokerFee)}
                      </div>
                    </div>
                  </div>
                </div>

                {isMonthOpen && (
                  <div className="border-t border-slate-200 bg-slate-50 p-3">
                    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-6 border-b border-slate-200 px-4 py-3">
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            Retailer
                          </div>

                          <div className="text-sm font-bold text-slate-900">
                            Hy-Vee
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            WM Invoice Total
                          </div>

                          <div className="text-sm font-bold text-slate-900">
                            {formatCurrency(monthGroup.totals.wmInvoiceTotal)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            Charges
                          </div>

                          <div className="text-sm font-bold text-red-600">
                            {formatCurrency(monthGroup.totals.charges)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            Net Total / 5% Broker Fee
                          </div>

                          <div className="text-sm font-bold text-slate-900">
                            {formatCurrency(monthGroup.totals.netTotal)}
                          </div>

                          <div className="text-sm font-bold text-emerald-600">
                            {formatCurrency(monthGroup.totals.brokerFee)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_160px] bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700">
                        <div>Line Item</div>
                        <div className="text-right">Amount</div>
                      </div>

                      {lineGroups.map((lineGroup) => {
                        const lineKey = `${monthGroup.month}__${lineGroup.label}`;
                        const isLineOpen = !!expandedLines[lineKey];

                        return (
                          <div
                            key={lineKey}
                            className="border-t border-slate-200 first:border-t-0"
                          >
                            <button
                              type="button"
                              onClick={() => toggleLine(lineKey)}
                              className="grid w-full grid-cols-[24px_1fr_160px] items-center px-4 py-2.5 text-left hover:bg-slate-50"
                            >
                              <div>
                                {isLineOpen ? (
                                  <ChevronDown className="h-4 w-4 text-slate-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-slate-600" />
                                )}
                              </div>

                              <div className="text-sm font-medium text-slate-900">
                                {lineGroup.label}
                              </div>

                              <div
                                className={`text-right text-sm font-medium ${
                                  lineGroup.isInvoice ? "text-slate-900" : "text-red-600"
                                }`}
                              >
                                {formatCurrency(lineGroup.total)}
                              </div>
                            </button>

                            {isLineOpen && (
                              <div className="border-t border-slate-200 bg-slate-50">
                                <div className="grid grid-cols-[120px_120px_120px_1fr_130px] bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                                  <div>Invoice #</div>
                                  <div>Check #</div>
                                  <div>Invoice Date</div>
                                  <div>Explanation</div>
                                  <div className="text-right">Amount</div>
                                </div>

                                {lineGroup.rows.map((row) => (
                                  <div
                                    key={row.id}
                                    className="grid grid-cols-[120px_120px_120px_1fr_130px] border-t border-slate-200 px-4 py-2 text-xs text-slate-700"
                                  >
                                    <div>{row.invoice_number || "-"}</div>
                                    <div>{row.check_number || "-"}</div>
                                    <div>{formatDate(row.invoice_date)}</div>
                                    <div>{row.explanation || "-"}</div>
                                    <div
                                      className={`text-right font-medium ${
                                        isWMInvoice(row)
                                          ? "text-slate-900"
                                          : "text-red-600"
                                      }`}
                                    >
                                      {formatCurrency(row.net_amount)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
