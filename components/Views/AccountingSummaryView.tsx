"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Filter, Lock } from "lucide-react";

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
  invoice_date?: string | null;
  check_date?: string | null;
  created_at?: string | null;
  month_key?: string | null;
};

type AdminUser = {
  email: string;
  name?: string | null;
  isAdmin?: boolean;
  canAccessSummaryDiscrepancy?: boolean;
};

type MonthOption = {
  key: string;
  label: string;
  sortValue: number;
};

type SummaryDiscrepancyAccessProps = {
  currentUserEmail?: string | null;
  isCurrentUserAdmin?: boolean;
  allowedUserEmails?: string[];
  admins?: AdminUser[];
  onAccessChange?: (nextUsers: AdminUser[]) => void;
};

type SummaryDiscrepancyViewProps = SummaryDiscrepancyAccessProps & {
  showAccessManager?: boolean;
};

const DATASET_TABLE = "data_sets";
const DATASET_TYPE_FIELD_FALLBACK = "type";
const DATASET_QUANTITY_FIELD_FALLBACK = "quantity";

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
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

function getMonthOptionFromKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);

  return {
    key: monthKey,
    label: monthLabelFromDate(date),
    sortValue: year * 100 + (month || 1),
  } satisfies MonthOption;
}

function getRowMonthKey(row: Partial<DataSetRow>) {
  if (row.month_key) return row.month_key;

  const possibleDates = [row.invoice_date, row.check_date, row.created_at];
  for (const value of possibleDates) {
    const date = parseUsDate(value);
    if (date) return monthKeyFromDate(date);
  }

  return null;
}

function canAccessSummaryDiscrepancy({
  currentUserEmail,
  isCurrentUserAdmin,
  allowedUserEmails,
}: SummaryDiscrepancyAccessProps) {
  if (isCurrentUserAdmin) return true;
  if (!currentUserEmail) return false;

  const normalizedCurrentUser = currentUserEmail.trim().toLowerCase();
  const allowed = (allowedUserEmails || []).map((email) => email.trim().toLowerCase());

  return allowed.includes(normalizedCurrentUser);
}

function AccessManager({
  admins,
  onAccessChange,
}: {
  admins: AdminUser[];
  onAccessChange?: (nextUsers: AdminUser[]) => void;
}) {
  if (!admins.length) return null;

  const handleToggle = (email: string) => {
    const nextUsers = admins.map((user) =>
      user.email === email
        ? {
            ...user,
            canAccessSummaryDiscrepancy: !user.canAccessSummaryDiscrepancy,
          }
        : user
    );

    onAccessChange?.(nextUsers);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Summary Discrepancy Access
        </h3>
        <p className="text-xs text-slate-500">
          Admins always have access. Turn this on to allow additional users.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {admins.map((user) => {
          const checked = Boolean(user.isAdmin || user.canAccessSummaryDiscrepancy);
          const disabled = Boolean(user.isAdmin);

          return (
            <label
              key={user.email}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {user.name || user.email}
                </p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>

              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => handleToggle(user.email)}
                className="h-4 w-4"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function AccountingSummaryView() {
  const [rows, setRows] = useState<InvoiceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [appliedFromMonth, setAppliedFromMonth] = useState("");
  const [appliedToMonth, setAppliedToMonth] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from("invoices")
          .select("id, check_date, invoice_amt, type")
          .order("check_date", { ascending: false });

        if (error) throw error;

        const safeRows = (data || []).filter((row) => parseUsDate(row.check_date));
        setRows(safeRows);
      } catch (error) {
        console.error("Accounting summary load error:", error);
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

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [rows]);

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
  }, [allMonthOptions, appliedFromMonth, appliedToMonth]);

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

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Accounting Summary</h2>
            <p className="text-sm text-slate-500">Summary by type from invoices.</p>
          </div>

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

            <Button type="button" onClick={handleApply} className="rounded-xl">
              <Filter className="mr-2 h-4 w-4" />
              Apply Filter
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading summary...</p>
        ) : filteredMonthOptions.length === 0 ? (
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
        )}
      </CardContent>
    </Card>
  );
}

export function SummaryDiscrepancyView({
  currentUserEmail,
  isCurrentUserAdmin = false,
  allowedUserEmails = [],
  admins = [],
  onAccessChange,
  showAccessManager = false,
}: SummaryDiscrepancyViewProps) {
  const [invoiceRows, setInvoiceRows] = useState<InvoiceSummaryRow[]>([]);
  const [dataSetRows, setDataSetRows] = useState<DataSetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [appliedMonth, setAppliedMonth] = useState("");
  const [dataSetError, setDataSetError] = useState<string | null>(null);

  const hasAccess = canAccessSummaryDiscrepancy({
    currentUserEmail,
    isCurrentUserAdmin,
    allowedUserEmails,
  });

  useEffect(() => {
    if (!hasAccess) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        setDataSetError(null);

        const [invoiceResponse, dataSetResponse] = await Promise.all([
          supabase
            .from("invoices")
            .select("id, check_date, invoice_amt, type")
            .order("check_date", { ascending: false }),
          supabase
            .from(DATASET_TABLE)
            .select(
              `id, ${DATASET_TYPE_FIELD_FALLBACK}, ${DATASET_QUANTITY_FIELD_FALLBACK}, invoice_date, check_date, created_at, month_key`
            )
            .order("created_at", { ascending: false }),
        ]);

        if (invoiceResponse.error) throw invoiceResponse.error;
        if (dataSetResponse.error) {
          setDataSetError(dataSetResponse.error.message);
        }

        const safeInvoiceRows = (invoiceResponse.data || []).filter((row) =>
          parseUsDate(row.check_date)
        );
        setInvoiceRows(safeInvoiceRows);

        const normalizedDataSets = (dataSetResponse.data || []).map((row: any) => ({
          id: row.id,
          type: row[DATASET_TYPE_FIELD_FALLBACK] || null,
          quantity: Number(row[DATASET_QUANTITY_FIELD_FALLBACK] || 0),
          invoice_date: row.invoice_date || null,
          check_date: row.check_date || null,
          created_at: row.created_at || null,
          month_key: row.month_key || null,
        }));

        setDataSetRows(normalizedDataSets);
      } catch (error) {
        console.error("Summary discrepancy load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [hasAccess]);

  const allMonthOptions = useMemo<MonthOption[]>(() => {
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

    for (const row of dataSetRows) {
      const key = getRowMonthKey(row);
      if (!key || map.has(key)) continue;
      map.set(key, getMonthOptionFromKey(key));
    }

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [invoiceRows, dataSetRows]);

  useEffect(() => {
    if (!allMonthOptions.length) return;
    if (selectedMonth || appliedMonth) return;

    const latestMonth = allMonthOptions[0].key;
    setSelectedMonth(latestMonth);
    setAppliedMonth(latestMonth);
  }, [allMonthOptions, appliedMonth, selectedMonth]);

  const summary = useMemo(() => {
    if (!appliedMonth) {
      return {
        rows: [] as Array<{
          typeName: string;
          accountingSummary: number;
          dataSetSummary: number;
          discrepancy: number;
        }>,
        accountingTotal: 0,
        dataSetTotal: 0,
        discrepancyTotal: 0,
      };
    }

    const invoiceTotals = new Map<string, number>();
    const dataSetTotals = new Map<string, number>();

    for (const row of invoiceRows) {
      const date = parseUsDate(row.check_date);
      if (!date) continue;

      const monthKey = monthKeyFromDate(date);
      if (monthKey !== appliedMonth) continue;

      const typeName = row.type?.trim() || "Unknown";
      const amount = Number(row.invoice_amt || 0);
      invoiceTotals.set(typeName, (invoiceTotals.get(typeName) || 0) + amount);
    }

    for (const row of dataSetRows) {
      const monthKey = getRowMonthKey(row);
      if (monthKey !== appliedMonth) continue;

      const typeName = row.type?.trim() || "Unknown";
      const quantity = Number(row.quantity || 0);
      dataSetTotals.set(typeName, (dataSetTotals.get(typeName) || 0) + quantity);
    }

    const orderedTypes = sortTypesWithWMFirst(
      Array.from(new Set([...invoiceTotals.keys(), ...dataSetTotals.keys()]))
    );

    const rows = orderedTypes.map((typeName) => {
      const accountingSummary = invoiceTotals.get(typeName) || 0;
      const dataSetSummary = dataSetTotals.get(typeName) || 0;
      const discrepancy = accountingSummary - dataSetSummary;

      return {
        typeName,
        accountingSummary,
        dataSetSummary,
        discrepancy,
      };
    });

    const accountingTotal = rows.reduce((sum, row) => sum + row.accountingSummary, 0);
    const dataSetTotal = rows.reduce((sum, row) => sum + row.dataSetSummary, 0);
    const discrepancyTotal = rows.reduce((sum, row) => sum + row.discrepancy, 0);

    return {
      rows,
      accountingTotal,
      dataSetTotal,
      discrepancyTotal,
    };
  }, [appliedMonth, dataSetRows, invoiceRows]);

  const monthLabel =
    allMonthOptions.find((option) => option.key === appliedMonth)?.label || "Selected Month";

  if (!hasAccess) {
    return (
      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="rounded-full bg-slate-100 p-3 text-slate-600">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Summary Discrepancy</h2>
            <p className="text-sm text-slate-500">
              Only admins or users explicitly allowed in Admin &gt; User Account can access this page.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Summary Discrepancy</h2>
            <p className="text-sm text-slate-500">
              Compare the latest month accounting summary against Data Sets totals by type.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Select month</option>
                {[...allMonthOptions]
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
              onClick={() => setAppliedMonth(selectedMonth)}
              className="rounded-xl"
            >
              <Filter className="mr-2 h-4 w-4" />
              Apply Filter
            </Button>
          </div>
        </div>

        {showAccessManager && isCurrentUserAdmin ? (
          <AccessManager admins={admins} onAccessChange={onAccessChange} />
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading discrepancy summary...</p>
        ) : !appliedMonth ? (
          <p className="text-sm text-slate-500">No month available.</p>
        ) : (
          <>
            {dataSetError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Data Sets could not be loaded from the <span className="font-medium">{DATASET_TABLE}</span>
                table. Update the table name or field mapping in this component if your schema is
                different.
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">
                      {monthLabel}
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
                  {summary.rows.map((row) => (
                    <tr key={row.typeName} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.typeName}</td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatCurrency(row.accountingSummary)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatNumber(row.dataSetSummary)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          row.discrepancy === 0
                            ? "text-slate-900"
                            : row.discrepancy > 0
                              ? "text-amber-700"
                              : "text-rose-700"
                        }`}
                      >
                        {formatNumber(row.discrepancy)}
                      </td>
                    </tr>
                  ))}

                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">Monthly Summary Total</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(summary.accountingTotal)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatNumber(summary.dataSetTotal)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {formatNumber(summary.discrepancyTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SummaryDiscrepancyView;
