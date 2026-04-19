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

// Matches the actual broker_commission_datasets schema
type BrokerCommissionDbRow = {
  id: string;
  month: string | null;
  check_date: string | null;
  invoice: string | null;
  type: string | null;
  upc: string | null;
  item: string | null;
  cust_name: string | null;
  amt: number | null;
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

function parseMonthValue(value: string | null | undefined) {
  if (!value) return null;

  const trimmed = String(value).trim();

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm] = trimmed.split("-");
    const date = new Date(Number(yyyy), Number(mm) - 1, 1);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const monthYearDate = new Date(`${trimmed} 1`);
  if (!Number.isNaN(monthYearDate.getTime())) return monthYearDate;

  return parseUsDate(trimmed);
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
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

function normalizeType(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ─── Helpers that match broker_commission_datasets actual schema ──────────────

function normalizeMonthLabel(value: string) {
  const trimmed = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/['`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) return "";

  const match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return trimmed;

  const monthName = match[1];
  const yearRaw = match[2];
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

  return `${monthName} ${year}`;
}

function formatMonthFromDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Derives the month string from a broker_commission_datasets row,
 * using the same logic as BrokerCommissionSummaryView.
 */
function getBrokerRowMonthLabel(row: BrokerCommissionDbRow): string {
  const rawMonth = String(row.month ?? "").trim();
  const rawCheckDate = String(row.check_date ?? "").trim();
  return normalizeMonthLabel(rawMonth || formatMonthFromDate(rawCheckDate) || "");
}

/**
 * Converts a month label like "March 2026" → "2026-03" for use as a map key.
 */
function monthLabelToKey(label: string): string | null {
  const monthMap: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };

  const match = label.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;

  const mm = monthMap[match[1].toLowerCase()];
  if (!mm) return null;

  return `${match[2]}-${mm}`;
}

/**
 * Returns the actual type label from a broker_commission_datasets row.
 * The field is simply `type` (e.g. "WM Invoice", "$1 Promotion", etc.)
 */
function getBrokerRowType(row: BrokerCommissionDbRow): string {
  return String(row.type ?? "").trim() || "Unknown";
}

/**
 * Returns the amount from a broker_commission_datasets row.
 * The field is `amt`.
 */
function getBrokerRowAmount(row: BrokerCommissionDbRow): number {
  return Number(row.amt ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

async function fetchAllBrokerCommissionRows(): Promise<BrokerCommissionDbRow[]> {
  let allRows: BrokerCommissionDbRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("broker_commission_datasets")
      .select("id, month, check_date, invoice, type, upc, item, cust_name, amt")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as BrokerCommissionDbRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

export default function AccountingSummaryView() {
  const [rows, setRows] = useState<InvoiceSummaryRow[]>([]);
  const [brokerCommissionRows, setBrokerCommissionRows] = useState<BrokerCommissionDbRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("accounting");

  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [appliedFromMonth, setAppliedFromMonth] = useState("");
  const [appliedToMonth, setAppliedToMonth] = useState("");

  const [discrepancyMonth, setDiscrepancyMonth] = useState("");
  const [appliedDiscrepancyMonth, setAppliedDiscrepancyMonth] = useState("");

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      try {
        const invoiceRes = await supabase
          .from("invoices")
          .select("id, check_date, invoice_amt, type")
          .order("check_date", { ascending: false });

        if (!invoiceRes.error) {
          const safeInvoiceRows = (invoiceRes.data || []).filter((row) =>
            parseUsDate(row.check_date)
          );
          setRows(safeInvoiceRows);
        } else {
          console.error("Invoice query error:", invoiceRes.error);
        }

        const commissionRows = await fetchAllBrokerCommissionRows();
        setBrokerCommissionRows(commissionRows);
      } catch (error) {
        console.error("Summary load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const accountingMonthOptions = useMemo<MonthOption[]>(() => {
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

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [rows]);

  // Build month options for discrepancy from broker_commission_datasets rows
  const discrepancyMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();

    // From invoices (ksolve side)
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

    // From broker_commission_datasets (invoice side)
    for (const row of brokerCommissionRows) {
      const label = getBrokerRowMonthLabel(row);
      if (!label) continue;

      const key = monthLabelToKey(label);
      if (!key) continue;

      if (!map.has(key)) {
        // Parse sortValue from the key
        const [yyyy, mm] = key.split("-");
        const sortValue = Number(yyyy) * 100 + Number(mm);
        const date = new Date(Number(yyyy), Number(mm) - 1, 1);
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [rows, brokerCommissionRows]);

  useEffect(() => {
    if (accountingMonthOptions.length > 0 && !appliedFromMonth && !appliedToMonth) {
      const defaultMonths = accountingMonthOptions.slice(0, 6);
      const sortedAsc = [...defaultMonths].sort((a, b) => a.sortValue - b.sortValue);

      const defaultFrom = sortedAsc[0]?.key || "";
      const defaultTo = sortedAsc[sortedAsc.length - 1]?.key || "";

      setFromMonth(defaultFrom);
      setToMonth(defaultTo);
      setAppliedFromMonth(defaultFrom);
      setAppliedToMonth(defaultTo);
    }
  }, [accountingMonthOptions, appliedFromMonth, appliedToMonth]);

  useEffect(() => {
    if (discrepancyMonthOptions.length > 0 && !appliedDiscrepancyMonth) {
      const latestMonth = discrepancyMonthOptions[0]?.key || "";
      setDiscrepancyMonth(latestMonth);
      setAppliedDiscrepancyMonth(latestMonth);
    }
  }, [discrepancyMonthOptions, appliedDiscrepancyMonth]);

  const filteredMonthOptions = useMemo(() => {
    if (!appliedFromMonth || !appliedToMonth) return [];

    const fromVal = Number(appliedFromMonth.replace("-", ""));
    const toVal = Number(appliedToMonth.replace("-", ""));
    const minVal = Math.min(fromVal, toVal);
    const maxVal = Math.max(fromVal, toVal);

    return [...accountingMonthOptions]
      .filter((m) => m.sortValue >= minVal && m.sortValue <= maxVal)
      .sort((a, b) => a.sortValue - b.sortValue);
  }, [accountingMonthOptions, appliedFromMonth, appliedToMonth]);

  const summary = useMemo(() => {
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

  /**
   * Discrepancy summary:
   *
   * - Ksolve Total  → from `invoices` table, grouped by type, filtered by month
   * - Invoice Total → from `broker_commission_datasets`, grouped by type, filtered by month
   *                   Combines ALL retailer rows (Kroger + Fresh Thyme + INFRA & Others)
   *                   and sums `amt` per `type`.
   */
  const discrepancySummary = useMemo(() => {
    if (!appliedDiscrepancyMonth) {
      return {
        selectedMonthLabel: "",
        typeRows: [] as Array<{
          typeName: string;
          ksolveTotal: number;
          invoiceTotal: number;
          discrepancy: number;
        }>,
        ksolveGrandTotal: 0,
        invoiceGrandTotal: 0,
        discrepancyGrandTotal: 0,
      };
    }

    const selectedMonthOption = discrepancyMonthOptions.find(
      (m) => m.key === appliedDiscrepancyMonth
    );

    // ── Ksolve totals from `invoices` table ────────────────────────────────
    const ksolveTypeTotals = new Map<string, number>();
    const displayTypeMap = new Map<string, string>(); // normalizedType → display label

    for (const row of rows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;

      const monthKey = monthKeyFromDate(date);
      if (monthKey !== appliedDiscrepancyMonth) continue;

      const rawType = row.type?.trim() || "Unknown";
      const normalizedType = normalizeType(rawType);
      const amount = Number(row.invoice_amt || 0);

      if (!displayTypeMap.has(normalizedType)) {
        displayTypeMap.set(normalizedType, rawType);
      }

      ksolveTypeTotals.set(
        normalizedType,
        (ksolveTypeTotals.get(normalizedType) || 0) + amount
      );
    }

    // ── Invoice totals from `broker_commission_datasets` ───────────────────
    // Sum `amt` per `type` for the selected month, across ALL retailers.
    const brokerTypeTotals = new Map<string, number>();

    for (const row of brokerCommissionRows) {
      // Derive the month key for this row using the same logic as BrokerCommissionSummaryView
      const monthLabel = getBrokerRowMonthLabel(row);
      if (!monthLabel) continue;

      const rowMonthKey = monthLabelToKey(monthLabel);
      if (rowMonthKey !== appliedDiscrepancyMonth) continue;

      const rawType = getBrokerRowType(row);
      const normalizedType = normalizeType(rawType);
      const amount = getBrokerRowAmount(row);

      if (!displayTypeMap.has(normalizedType)) {
        displayTypeMap.set(normalizedType, rawType);
      }

      brokerTypeTotals.set(
        normalizedType,
        (brokerTypeTotals.get(normalizedType) || 0) + amount
      );
    }

    // ── Merge all types ────────────────────────────────────────────────────
    const allNormalizedTypes = Array.from(
      new Set([...ksolveTypeTotals.keys(), ...brokerTypeTotals.keys()])
    );

    const orderedTypes = sortTypesWithWMFirst(
      allNormalizedTypes.map((key) => displayTypeMap.get(key) || key)
    );

    const typeRows = orderedTypes.map((displayTypeName) => {
      const normalizedType = normalizeType(displayTypeName);
      const typeName = displayTypeMap.get(normalizedType) || displayTypeName;
      const ksolveTotal = ksolveTypeTotals.get(normalizedType) || 0;
      const invoiceTotal = brokerTypeTotals.get(normalizedType) || 0;

      return {
        typeName,
        ksolveTotal,
        invoiceTotal,
        discrepancy: ksolveTotal - invoiceTotal,
      };
    });

    const ksolveGrandTotal = typeRows.reduce((sum, row) => sum + row.ksolveTotal, 0);
    const invoiceGrandTotal = typeRows.reduce((sum, row) => sum + row.invoiceTotal, 0);
    const discrepancyGrandTotal = typeRows.reduce((sum, row) => sum + row.discrepancy, 0);

    return {
      selectedMonthLabel: selectedMonthOption?.label || "",
      typeRows,
      ksolveGrandTotal,
      invoiceGrandTotal,
      discrepancyGrandTotal,
    };
  }, [rows, brokerCommissionRows, appliedDiscrepancyMonth, discrepancyMonthOptions]);

  const handleApply = () => {
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

  const handleApplyDiscrepancyMonth = () => {
    if (!discrepancyMonth) return;
    setAppliedDiscrepancyMonth(discrepancyMonth);
  };

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={viewMode === "accounting" ? "default" : "outline"}
              className="rounded-xl"
              onClick={() => setViewMode("accounting")}
            >
              Accounting Summary
            </Button>

            <Button
              type="button"
              variant={viewMode === "discrepancy" ? "default" : "outline"}
              className="rounded-xl"
              onClick={() => setViewMode("discrepancy")}
            >
              Summary Discrepancy
            </Button>
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
                  {[...accountingMonthOptions]
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
                  {[...accountingMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((month) => (
                      <option key={month.key} value={month.key}>
                        {month.label}
                      </option>
                    ))}
                </select>
              </div>

              <Button type="button" onClick={handleApply} className="rounded-xl">
                <Filter className="mr-2 h-4 w-4" />
                Apply Filter
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">Month</label>
                <select
                  value={discrepancyMonth}
                  onChange={(e) => setDiscrepancyMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>
                  {[...discrepancyMonthOptions]
                    .sort((a, b) => b.sortValue - a.sortValue)
                    .map((month) => (
                      <option key={month.key} value={month.key}>
                        {month.label}
                      </option>
                    ))}
                </select>
              </div>

              <Button
                type="button"
                onClick={handleApplyDiscrepancyMonth}
                className="rounded-xl"
              >
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
                  {summary.typeRows.map((row) => (
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
                        {formatCurrency(summary.monthlyTotals[month.key] || 0)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {formatCurrency(summary.grandTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        ) : !appliedDiscrepancyMonth ? (
          <p className="text-sm text-slate-500">No discrepancy month selected.</p>
        ) : discrepancySummary.typeRows.length === 0 ? (
          <p className="text-sm text-slate-500">No discrepancy data found.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Ksolve Total
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Invoice Total
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Discrepancy
                  </th>
                </tr>
              </thead>

              <tbody>
                {discrepancySummary.typeRows.map((row) => (
                  <tr key={row.typeName} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.typeName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(row.ksolveTotal)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(row.invoiceTotal)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        Math.abs(row.discrepancy) < 0.01
                          ? "text-slate-900"
                          : row.discrepancy > 0
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {formatCurrency(row.discrepancy)}
                    </td>
                  </tr>
                ))}

                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {discrepancySummary.selectedMonthLabel || "Monthly Total"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(discrepancySummary.ksolveGrandTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(discrepancySummary.invoiceGrandTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {formatCurrency(discrepancySummary.discrepancyGrandTotal)}
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