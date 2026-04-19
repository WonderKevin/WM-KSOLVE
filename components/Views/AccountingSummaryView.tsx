"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceSummaryRow = {
  id: number;
  check_date: string | null;
  invoice_amt: number | null;
  type: string | null;
};

type KsolveInvoiceRow = {
  invoice_number: string | null;
  invoice_amt: number | null;
  type: string | null;
};

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

type BrokerCommissionRow = BrokerCommissionDbRow & {
  adjustedAmt: number;
  derivedMonthKey: string;
};

type MonthOption = {
  key: string;
  label: string;
  sortValue: number;
};

type ViewMode = "accounting" | "discrepancy";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

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

function monthKeyFromDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function monthLabelFromDate(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function formatMonthFromDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function normalizeMonthLabel(value: string) {
  const trimmed = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/['\`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return trimmed;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return `${match[1]} ${year}`;
}

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

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

function isWmInvoiceType(type: string) {
  const t = String(type || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return t === "WMINVOICE" || t === "WM INVOICE";
}

function normalizeType(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sortTypesWithWMFirst(types: string[]) {
  return [...types].sort((a, b) => {
    if (a === "WM Invoice") return -1;
    if (b === "WM Invoice") return 1;
    return a.localeCompare(b);
  });
}

// ─── Discrepancy adjustment — mirrors BrokerCommissionSummaryView exactly ─────

function applyAmountBasedDiscrepancy(
  rawRows: BrokerCommissionDbRow[],
  discrepancyByInvoice: Map<string, number>
): (BrokerCommissionDbRow & { adjustedAmt: number })[] {
  const grouped = new Map<string, BrokerCommissionDbRow[]>();
  for (const row of rawRows) {
    const key = normalizeInvoice(row.invoice ?? "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const result: (BrokerCommissionDbRow & { adjustedAmt: number })[] = [];

  for (const [invoiceKey, invoiceRows] of grouped.entries()) {
    const invoiceDiscrepancy = round2(discrepancyByInvoice.get(invoiceKey) ?? 0);

    const wmRows = invoiceRows.filter(
      (r) => isWmInvoiceType(r.type ?? "") && Number(r.amt ?? 0) !== 0
    );

    const totalWmAmount = round2(
      wmRows.reduce((sum, r) => sum + Number(r.amt ?? 0), 0)
    );

    let runningShare = 0;

    for (const row of invoiceRows) {
      let adjustedAmt = Number(row.amt ?? 0);

      if (
        invoiceDiscrepancy !== 0 &&
        isWmInvoiceType(row.type ?? "") &&
        totalWmAmount !== 0
      ) {
        const wmIndex = wmRows.findIndex((r) => r.id === row.id);
        const isLastWmRow = wmIndex === wmRows.length - 1;

        let share = 0;
        if (isLastWmRow) {
          share = round2(invoiceDiscrepancy - runningShare);
        } else {
          share = round2(invoiceDiscrepancy * (Number(row.amt ?? 0) / totalWmAmount));
          runningShare = round2(runningShare + share);
        }

        adjustedAmt = round2(Number(row.amt ?? 0) + share);
      }

      result.push({ ...row, adjustedAmt });
    }
  }

  return result;
}

// ─── Supabase fetchers ────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

async function fetchAllBrokerCommissionRows(): Promise<BrokerCommissionDbRow[]> {
  let allRows: BrokerCommissionDbRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("broker_commission_datasets")
      .select("id, month, check_date, invoice, type, upc, item, cust_name, amt")
      .order("check_date", { ascending: false, nullsFirst: false })
      .order("invoice", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as BrokerCommissionDbRow[];
    allRows = allRows.concat(batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

async function fetchAllKsolveInvoiceRows(): Promise<KsolveInvoiceRow[]> {
  let allRows: KsolveInvoiceRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("invoices")
      .select("invoice_number, invoice_amt, type")
      .eq("type", "WM Invoice")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as KsolveInvoiceRow[];
    allRows = allRows.concat(batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountingSummaryView() {
  const [invoiceRows, setInvoiceRows] = useState<InvoiceSummaryRow[]>([]);
  const [brokerRows, setBrokerRows] = useState<BrokerCommissionRow[]>([]);
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
        const [rawInvoiceRes, rawBrokerRows, ksolveWmRows] = await Promise.all([
          supabase
            .from("invoices")
            .select("id, check_date, invoice_amt, type")
            .order("check_date", { ascending: false }),
          fetchAllBrokerCommissionRows(),
          fetchAllKsolveInvoiceRows(),
        ]);

        if (!rawInvoiceRes.error) {
          setInvoiceRows(
            (rawInvoiceRes.data || []).filter((r) => parseUsDate(r.check_date))
          );
        } else {
          console.error("Invoice query error:", rawInvoiceRes.error);
        }

        // Build discrepancyByInvoice — same as BrokerCommissionSummaryView
        const ksolveByInvoice = new Map<string, number>();
        for (const row of ksolveWmRows) {
          const inv = normalizeInvoice(row.invoice_number ?? "");
          if (!inv) continue;
          ksolveByInvoice.set(inv, round2((ksolveByInvoice.get(inv) ?? 0) + Number(row.invoice_amt ?? 0)));
        }

        const wmByInvoice = new Map<string, number>();
        for (const row of rawBrokerRows) {
          const inv = normalizeInvoice(row.invoice ?? "");
          if (!inv || !isWmInvoiceType(row.type ?? "")) continue;
          wmByInvoice.set(inv, round2((wmByInvoice.get(inv) ?? 0) + Number(row.amt ?? 0)));
        }

        const discrepancyByInvoice = new Map<string, number>();
        for (const inv of new Set([...ksolveByInvoice.keys(), ...wmByInvoice.keys()])) {
          discrepancyByInvoice.set(
            inv,
            round2((ksolveByInvoice.get(inv) ?? 0) - (wmByInvoice.get(inv) ?? 0))
          );
        }

        // Apply adjustment + derive month key once per row
        const adjusted = applyAmountBasedDiscrepancy(rawBrokerRows, discrepancyByInvoice);

        const withMonthKey: BrokerCommissionRow[] = adjusted.map((row) => {
          const rawMonth = String(row.month ?? "").trim();
          const rawCheckDate = String(row.check_date ?? "").trim();
          const label = normalizeMonthLabel(rawMonth || formatMonthFromDate(rawCheckDate) || "");
          return { ...row, derivedMonthKey: monthLabelToKey(label) ?? "" };
        });

        setBrokerRows(withMonthKey);
      } catch (error) {
        console.error("Summary load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // ── Month options ────────────────────────────────────────────────────────────

  const accountingMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();
    for (const row of invoiceRows) {
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
  }, [invoiceRows]);

  const discrepancyMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();

    for (const row of invoiceRows) {
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

    for (const row of brokerRows) {
      const key = row.derivedMonthKey;
      if (!key || map.has(key)) continue;
      const [yyyy, mm] = key.split("-");
      const date = new Date(Number(yyyy), Number(mm) - 1, 1);
      map.set(key, {
        key,
        label: monthLabelFromDate(date),
        sortValue: Number(yyyy) * 100 + Number(mm),
      });
    }

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [invoiceRows, brokerRows]);

  useEffect(() => {
    if (accountingMonthOptions.length > 0 && !appliedFromMonth && !appliedToMonth) {
      const sortedAsc = [...accountingMonthOptions.slice(0, 6)].sort(
        (a, b) => a.sortValue - b.sortValue
      );
      setFromMonth(sortedAsc[0]?.key || "");
      setToMonth(sortedAsc[sortedAsc.length - 1]?.key || "");
      setAppliedFromMonth(sortedAsc[0]?.key || "");
      setAppliedToMonth(sortedAsc[sortedAsc.length - 1]?.key || "");
    }
  }, [accountingMonthOptions, appliedFromMonth, appliedToMonth]);

  useEffect(() => {
    if (discrepancyMonthOptions.length > 0 && !appliedDiscrepancyMonth) {
      const latest = discrepancyMonthOptions[0]?.key || "";
      setDiscrepancyMonth(latest);
      setAppliedDiscrepancyMonth(latest);
    }
  }, [discrepancyMonthOptions, appliedDiscrepancyMonth]);

  // ── Accounting Summary ───────────────────────────────────────────────────────

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

    for (const row of invoiceRows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;
      const monthKey = monthKeyFromDate(date);
      if (!monthKeySet.has(monthKey)) continue;
      const typeName = row.type?.trim() || "Unknown";
      const amount = Number(row.invoice_amt || 0);
      if (!typeMonthTotals.has(typeName)) typeMonthTotals.set(typeName, {});
      const current = typeMonthTotals.get(typeName)!;
      current[monthKey] = (current[monthKey] || 0) + amount;
    }

    const orderedTypes = sortTypesWithWMFirst(Array.from(typeMonthTotals.keys()));
    const typeRows = orderedTypes.map((typeName) => {
      const monthlyValues = typeMonthTotals.get(typeName) || {};
      const total = monthKeys.reduce((sum, key) => sum + (monthlyValues[key] || 0), 0);
      return { typeName, monthlyValues, total };
    });

    const monthlyTotals: Record<string, number> = {};
    for (const monthKey of monthKeys) {
      monthlyTotals[monthKey] = typeRows.reduce(
        (sum, row) => sum + (row.monthlyValues[monthKey] || 0),
        0
      );
    }

    return {
      monthKeys,
      typeRows,
      monthlyTotals,
      grandTotal: Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0),
    };
  }, [invoiceRows, filteredMonthOptions]);

  // ── Discrepancy Summary ──────────────────────────────────────────────────────
  //
  // Invoice Total = broker_commission_datasets for the selected month, summed by type.
  // WM Invoice lines use adjustedAmt (abs) — identical to what BrokerCommissionSummaryView
  // displays as "WM Invoice Total" across all retailer buckets combined.
  // Deduction lines use raw amt.

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

    // Ksolve totals from invoices table
    const ksolveTypeTotals = new Map<string, number>();
    const displayTypeMap = new Map<string, string>();

    for (const row of invoiceRows) {
      const date = parseUsDate(row.check_date);
      if (!date || monthKeyFromDate(date) !== appliedDiscrepancyMonth) continue;

      const rawType = row.type?.trim() || "Unknown";
      const normType = normalizeType(rawType);
      if (!displayTypeMap.has(normType)) displayTypeMap.set(normType, rawType);
      ksolveTypeTotals.set(
        normType,
        (ksolveTypeTotals.get(normType) || 0) + Number(row.invoice_amt || 0)
      );
    }

    // Invoice totals from broker_commission_datasets (all retailers combined)
    // WM Invoice → adjustedAmt (abs), deductions → raw amt
    const brokerTypeTotals = new Map<string, number>();

    for (const row of brokerRows) {
      if (row.derivedMonthKey !== appliedDiscrepancyMonth) continue;

      const rawType = String(row.type ?? "").trim() || "Unknown";
      const normType = normalizeType(rawType);
      if (!displayTypeMap.has(normType)) displayTypeMap.set(normType, rawType);

      const amount = isWmInvoiceType(row.type ?? "")
        ? Math.abs(row.adjustedAmt)   // adjusted, matches BrokerCommissionSummaryView
        : Number(row.amt ?? 0);       // raw for deductions

      brokerTypeTotals.set(normType, round2((brokerTypeTotals.get(normType) || 0) + amount));
    }

    const allNormTypes = Array.from(
      new Set([...ksolveTypeTotals.keys(), ...brokerTypeTotals.keys()])
    );

    const orderedTypes = sortTypesWithWMFirst(
      allNormTypes.map((k) => displayTypeMap.get(k) || k)
    );

    const typeRows = orderedTypes.map((displayTypeName) => {
      const normType = normalizeType(displayTypeName);
      const typeName = displayTypeMap.get(normType) || displayTypeName;
      const ksolveTotal = ksolveTypeTotals.get(normType) || 0;
      const invoiceTotal = brokerTypeTotals.get(normType) || 0;
      return {
        typeName,
        ksolveTotal,
        invoiceTotal,
        discrepancy: round2(ksolveTotal - invoiceTotal),
      };
    });

    const ksolveGrandTotal = round2(typeRows.reduce((s, r) => s + r.ksolveTotal, 0));
    const invoiceGrandTotal = round2(typeRows.reduce((s, r) => s + r.invoiceTotal, 0));

    return {
      selectedMonthLabel: selectedMonthOption?.label || "",
      typeRows,
      ksolveGrandTotal,
      invoiceGrandTotal,
      discrepancyGrandTotal: round2(ksolveGrandTotal - invoiceGrandTotal),
    };
  }, [invoiceRows, brokerRows, appliedDiscrepancyMonth, discrepancyMonthOptions]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleApply = () => {
    if (!fromMonth && !toMonth) return;
    setAppliedFromMonth(fromMonth || toMonth);
    setAppliedToMonth(toMonth || fromMonth);
  };

  const handleApplyDiscrepancyMonth = () => {
    if (!discrepancyMonth) return;
    setAppliedDiscrepancyMonth(discrepancyMonth);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

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
                    .map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
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
                    .map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
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
                    .map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
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
                    {filteredMonthOptions.map((m) => (
                      <th key={m.key} className="px-4 py-3 text-right font-semibold text-slate-700">
                        {m.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.typeRows.map((row) => (
                    <tr key={row.typeName} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.typeName}</td>
                      {filteredMonthOptions.map((m) => (
                        <td key={m.key} className="px-4 py-3 text-right text-slate-700">
                          {formatCurrency(row.monthlyValues[m.key] || 0)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">Monthly Summary Total</td>
                    {filteredMonthOptions.map((m) => (
                      <td key={m.key} className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(summary.monthlyTotals[m.key] || 0)}
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
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Ksolve Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Invoice Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Discrepancy</th>
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