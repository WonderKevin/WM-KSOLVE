"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

type InvoiceSummaryRow = {
  id: number;
  check_date: string | null;
  invoice_amt: number | null;
  type: string | null;
};

type DataSetRow = {
  id: number;
  type: string | null;
  quantity: number | null;
  check_date?: string | null;
  invoice_date?: string | null;
  created_at?: string | null;
  month_key?: string | null;
};

type MonthOption = {
  key: string;
  label: string;
  sortValue: number;
};

type ViewMode = "accounting" | "discrepancy";

function parseUsDate(value: string | null | undefined) {
  if (!value) return null;

  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, mm, dd, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) return fallback;

  return null;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function monthKeyFromDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function monthLabelFromDate(date: Date) {
  return date.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function sortTypesWithWMFirst(types: string[]) {
  return [...types].sort((a, b) => {
    if (a === "WM Invoice") return -1;
    if (b === "WM Invoice") return 1;
    return a.localeCompare(b);
  });
}

function getDataSetMonthKey(row: DataSetRow) {
  if (row.month_key) return row.month_key;

  const date =
    parseUsDate(row.check_date) ||
    parseUsDate(row.invoice_date) ||
    parseUsDate(row.created_at);

  if (!date) return null;
  return monthKeyFromDate(date);
}

export default function AccountingSummaryView() {
  const [rows, setRows] = useState<InvoiceSummaryRow[]>([]);
  const [dataSetRows, setDataSetRows] = useState<DataSetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("accounting");

  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [appliedFromMonth, setAppliedFromMonth] = useState("");
  const [appliedToMonth, setAppliedToMonth] = useState("");

  const [selectedMonth, setSelectedMonth] = useState("");
  const [appliedSelectedMonth, setAppliedSelectedMonth] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const [{ data: invoices, error: invoiceError }, { data: dataSets, error: dataSetError }] =
          await Promise.all([
            supabase
              .from("invoices")
              .select("id, check_date, invoice_amt, type")
              .order("check_date", { ascending: false }),

            supabase
              .from("data_sets")
              .select("id, type, quantity, check_date, invoice_date, created_at, month_key"),
          ]);

        if (invoiceError) throw invoiceError;
        if (dataSetError) throw dataSetError;

        const safeRows = (invoices || []).filter((row) => parseUsDate(row.check_date));
        setRows(safeRows);
        setDataSetRows(dataSets || []);
      } catch (error) {
        console.error("Summary load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const allMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();

    for (const row of rows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;

      const key = monthKeyFromDate(date);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + (date.getMonth() + 1),
        });
      }
    }

    for (const row of dataSetRows) {
      const monthKey = getDataSetMonthKey(row);
      if (!monthKey) continue;

      const [yyyy, mm] = monthKey.split("-");
      const date = new Date(Number(yyyy), Number(mm) - 1, 1);

      if (!map.has(monthKey)) {
        map.set(monthKey, {
          key: monthKey,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + (date.getMonth() + 1),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [rows, dataSetRows]);

  useEffect(() => {
    if (allMonthOptions.length === 0) return;

    if (!appliedFromMonth && !appliedToMonth) {
      const defaultMonths = allMonthOptions.slice(0, 3);
      const sortedAsc = [...defaultMonths].sort((a, b) => a.sortValue - b.sortValue);

      const defaultFrom = sortedAsc[0]?.key || "";
      const defaultTo = sortedAsc[sortedAsc.length - 1]?.key || "";

      setFromMonth(defaultFrom);
      setToMonth(defaultTo);
      setAppliedFromMonth(defaultFrom);
      setAppliedToMonth(defaultTo);
    }

    if (!appliedSelectedMonth) {
      const latestMonth = allMonthOptions[0]?.key || "";
      setSelectedMonth(latestMonth);
      setAppliedSelectedMonth(latestMonth);
    }
  }, [allMonthOptions, appliedFromMonth, appliedToMonth, appliedSelectedMonth]);

  const filteredMonthOptions = useMemo(() => {
    if (!appliedFromMonth || !appliedToMonth) return [];

    const fromVal = Number(appliedFromMonth.replace("-", ""));
    const toVal = Number(appliedToMonth.replace("-", ""));
    const minVal = Math.min(fromVal, toVal);
    const maxVal = Math.max(fromVal, toVal);

    return [...allMonthOptions]
      .filter((m) => m.sortValue >= minVal && m.sortValue <= maxVal)
      .sort((a, b) => a.sortValue - b.sortValue);
  }, [allMonthOptions, appliedFromMonth, appliedToMonth]);

  const accountingSummary = useMemo(() => {
    const monthKeys = filteredMonthOptions.map((m) => m.key);
    const monthKeySet = new Set(monthKeys);

    const typeMonthTotals = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;

      const monthKey = monthKeyFromDate(date);
      if (!monthKeySet.has(monthKey)) continue;

      const typeName = row.type?.trim() || "Unknown";
      const amount = Number(row.invoice_amt || 0);

      if (!typeMonthTotals.has(typeName)) {
        typeMonthTotals.set(typeName, {});
      }

      const current = typeMonthTotals.get(typeName)!;
      current[monthKey] = (current[monthKey] || 0) + amount;
    }

    const orderedTypes = sortTypesWithWMFirst(Array.from(typeMonthTotals.keys()));

    const typeRows = orderedTypes.map((typeName) => {
      const monthlyValues = typeMonthTotals.get(typeName) || {};
      const total = monthKeys.reduce((sum, key) => sum + (monthlyValues[key] || 0), 0);

      return {
        typeName,
        monthlyValues,
        total,
      };
    });

    const monthlyTotals: Record<string, number> = {};
    for (const monthKey of monthKeys) {
      monthlyTotals[monthKey] = typeRows.reduce(
        (sum, row) => sum + (row.monthlyValues[monthKey] || 0),
        0
      );
    }

    const grandTotal = Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0);

    return {
      monthKeys,
      typeRows,
      monthlyTotals,
      grandTotal,
    };
  }, [rows, filteredMonthOptions]);

  const discrepancySummary = useMemo(() => {
    if (!appliedSelectedMonth) {
      return {
        rows: [],
        accountingTotal: 0,
        dataSetTotal: 0,
        discrepancyTotal: 0,
      };
    }

    const accountingByType = new Map<string, number>();
    const dataSetByType = new Map<string, number>();

    for (const row of rows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;

      const monthKey = monthKeyFromDate(date);
      if (monthKey !== appliedSelectedMonth) continue;

      const typeName = row.type?.trim() || "Unknown";
      const amount = Number(row.invoice_amt || 0);

      accountingByType.set(typeName, (accountingByType.get(typeName) || 0) + amount);
    }

    for (const row of dataSetRows) {
      const monthKey = getDataSetMonthKey(row);
      if (monthKey !== appliedSelectedMonth) continue;

      const typeName = row.type?.trim() || "Unknown";
      const qty = Number(row.quantity || 0);

      dataSetByType.set(typeName, (dataSetByType.get(typeName) || 0) + qty);
    }

    const allTypes = sortTypesWithWMFirst(
      Array.from(new Set([...accountingByType.keys(), ...dataSetByType.keys()]))
    );

    const resultRows = allTypes.map((typeName) => {
      const accountingValue = accountingByType.get(typeName) || 0;
      const dataSetValue = dataSetByType.get(typeName) || 0;

      return {
        typeName,
        accountingValue,
        dataSetValue,
        discrepancy: accountingValue - dataSetValue,
      };
    });

    return {
      rows: resultRows,
      accountingTotal: resultRows.reduce((sum, row) => sum + row.accountingValue, 0),
      dataSetTotal: resultRows.reduce((sum, row) => sum + row.dataSetValue, 0),
      discrepancyTotal: resultRows.reduce((sum, row) => sum + row.discrepancy, 0),
    };
  }, [rows, dataSetRows, appliedSelectedMonth]);

  const handleApplyAccountingFilter = () => {
    if (!fromMonth && !toMonth) return;

    if (fromMonth && !toMonth) {
      setAppliedFromMonth(fromMonth);
      setAppliedToMonth(fromMonth);
      return;
    }

    if (!fromMonth && toMonth) {
      setAppliedFromMonth(toMonth);
      setAppliedToMonth(toMonth);
      return;
    }

    setAppliedFromMonth(fromMonth);
    setAppliedToMonth(toMonth);
  };

  const handleApplyDiscrepancyFilter = () => {
    if (!selectedMonth) return;
    setAppliedSelectedMonth(selectedMonth);
  };

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                {viewMode === "accounting" ? "Accounting Summary" : "Summary Discrepancy"}
              </h2>
              <p className="text-sm text-slate-500">
                {viewMode === "accounting"
                  ? "Summary by type from invoices."
                  : "Compare selected month accounting summary with data sets totals."}
              </p>
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("accounting")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  viewMode === "accounting"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Accounting Summary
              </button>

              <button
                type="button"
                onClick={() => setViewMode("discrepancy")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  viewMode === "discrepancy"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Summary Discrepancy
              </button>
            </div>
          </div>

          {viewMode === "accounting" ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">From</label>
                <select
                  value={fromMonth}
                  onChange={(e) => setFromMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>
                  {[...allMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((month) => (
                      <option key={month.key} value={month.key}>
                        {month.label}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">To</label>
                <select
                  value={toMonth}
                  onChange={(e) => setToMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>
                  {[...allMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((month) => (
                      <option key={month.key} value={month.key}>
                        {month.label}
                      </option>
                    ))}
                </select>
              </div>

              <Button type="button" onClick={handleApplyAccountingFilter} className="rounded-xl">
                <Filter className="mr-2 h-4 w-4" />
                Apply Filter
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>
                  {[...allMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((month) => (
                      <option key={month.key} value={month.key}>
                        {month.label}
                      </option>
                    ))}
                </select>
              </div>

              <Button type="button" onClick={handleApplyDiscrepancyFilter} className="rounded-xl">
                <Filter className="mr-2 h-4 w-4" />
                Apply Filter
              </Button>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading summary...</p>
        ) : viewMode === "accounting" ? (
          filteredMonthOptions.length === 0 ? (
            <p className="text-sm text-slate-500">No summary data found.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                    {filteredMonthOptions.map((month) => (
                      <th
                        key={month.key}
                        className="px-4 py-3 text-right font-semibold text-slate-700"
                      >
                        {month.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {accountingSummary.typeRows.map((row) => (
                    <tr key={row.typeName} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.typeName}</td>
                      {filteredMonthOptions.map((month) => (
                        <td key={month.key} className="px-4 py-3 text-right text-slate-700">
                          {formatCurrency(row.monthlyValues[month.key] || 0)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}

                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      Monthly Summary Total
                    </td>
                    {filteredMonthOptions.map((month) => (
                      <td
                        key={month.key}
                        className="px-4 py-3 text-right font-semibold text-slate-900"
                      >
                        {formatCurrency(accountingSummary.monthlyTotals[month.key] || 0)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {formatCurrency(accountingSummary.grandTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        ) : !appliedSelectedMonth ? (
          <p className="text-sm text-slate-500">No discrepancy data found.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    {allMonthOptions.find((m) => m.key === appliedSelectedMonth)?.label || "Month"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Summary from Data Sets
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Discrepancy
                  </th>
                </tr>
              </thead>

              <tbody>
                {discrepancySummary.rows.map((row) => (
                  <tr key={row.typeName} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.typeName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(row.accountingValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatNumber(row.dataSetValue)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(row.discrepancy)}
                    </td>
                  </tr>
                ))}

                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">Monthly Summary Total</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(discrepancySummary.accountingTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatNumber(discrepancySummary.dataSetTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {formatCurrency(discrepancySummary.discrepancyTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}