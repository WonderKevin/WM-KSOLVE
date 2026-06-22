"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";

type BrokerageStatus = "" | "Invoice Confirmed" | "Bill Paid";

type TargetInvoiceRow = {
  id: number;
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  doc_header_text: string | null;
  reason_code_description: string | null;
  sap_doc_number: string | null;
  doc_date: string | null;
  gross_amount: number | null;
  cash_discount: number | null;
  withholding_tax_amount: number | null;
  net_amount: number | null;
  brokerage_status?: BrokerageStatus | null;
  brokerage_invoice_number?: string | null;
};

type ReasonGroup = {
  reason: string;
  rows: TargetInvoiceRow[];
  total: number;
};

const STATUS_OPTIONS: Array<{ value: BrokerageStatus; label: string }> = [
  { value: "", label: "Select Status" },
  { value: "Invoice Confirmed", label: "Invoice Confirmed" },
  { value: "Bill Paid", label: "Bill Paid" },
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

function normalizeReason(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isWMInvoice(reason: string | null | undefined) {
  return normalizeReason(reason) === "wminvoice";
}

function monthSortValue(month: string | null | undefined) {
  if (!month) return 0;

  const parsed = new Date(`1 ${month}`);

  if (Number.isNaN(parsed.getTime())) return 0;

  return parsed.getFullYear() * 100 + parsed.getMonth() + 1;
}

function getTotals(rows: TargetInvoiceRow[]) {
  const wmInvoiceTotal = round2(
    rows
      .filter((row) => isWMInvoice(row.reason_code_description))
      .reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
  );

  const deductions = round2(
    rows
      .filter((row) => !isWMInvoice(row.reason_code_description))
      .reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
  );

  const netTotal = round2(wmInvoiceTotal + deductions);
  const brokerFee = round2(netTotal * 0.04);

  return {
    wmInvoiceTotal,
    deductions,
    netTotal,
    brokerFee,
  };
}

function groupRowsByMonth(rows: TargetInvoiceRow[]) {
  const map = new Map<string, TargetInvoiceRow[]>();

  for (const row of rows) {
    const month = row.month || "Unknown";

    if (!map.has(month)) {
      map.set(month, []);
    }

    map.get(month)!.push(row);
  }

  return Array.from(map.entries())
    .map(([month, monthRows]) => ({
      month,
      rows: monthRows,
      totals: getTotals(monthRows),
      sortValue: monthSortValue(month),
    }))
    .sort((a, b) => b.sortValue - a.sortValue);
}

function groupRowsByReason(rows: TargetInvoiceRow[]): ReasonGroup[] {
  const map = new Map<string, TargetInvoiceRow[]>();

  for (const row of rows) {
    const reason = row.reason_code_description || "Unknown";

    if (!map.has(reason)) {
      map.set(reason, []);
    }

    map.get(reason)!.push(row);
  }

  return Array.from(map.entries())
    .map(([reason, reasonRows]) => ({
      reason,
      rows: reasonRows,
      total: round2(
        reasonRows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
      ),
    }))
    .sort((a, b) => {
      if (isWMInvoice(a.reason)) return -1;
      if (isWMInvoice(b.reason)) return 1;

      return a.reason.localeCompare(b.reason);
    });
}

function getStatusForRows(rows: TargetInvoiceRow[]): BrokerageStatus {
  const statuses = Array.from(
    new Set(
      rows
        .map((row) => row.brokerage_status || "")
        .filter((status): status is BrokerageStatus => status !== "")
    )
  );

  if (statuses.length === 1) return statuses[0];

  return "";
}

function getInvoiceNumberForRows(rows: TargetInvoiceRow[]) {
  const invoiceNumbers = Array.from(
    new Set(
      rows
        .map((row) => String(row.brokerage_invoice_number || "").trim())
        .filter(Boolean)
    )
  );

  if (invoiceNumbers.length === 1) return invoiceNumbers[0];

  return "";
}

function getStatusRowClass(status: BrokerageStatus) {
  if (status === "Invoice Confirmed") return "bg-[#C1EBE9]";
  if (status === "Bill Paid") return "bg-[#FFE0C5]";
  return "bg-white";
}

type TargetBrokerCommissionViewProps = {
  title?: string;
  subtitle?: string;
};

export default function TargetBrokerCommissionView({
  title = "Target Brokerage Commission",
  subtitle = "Target brokerage summary by month and reason code description.",
}: TargetBrokerCommissionViewProps) {
  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatusKey, setSavingStatusKey] = useState<string | null>(null);
  const [savingInvoiceKey, setSavingInvoiceKey] = useState<string | null>(null);

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );

  const [expandedReasons, setExpandedReasons] = useState<
    Record<string, boolean>
  >({});

  const loadData = async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("target_invoices")
        .select(
          "id, month, check_date, check_number, doc_header_text, reason_code_description, sap_doc_number, doc_date, gross_amount, cash_discount, withholding_tax_amount, net_amount, brokerage_status, brokerage_invoice_number"
        )
        .order("check_date", { ascending: false })
        .order("check_number", { ascending: false });

      if (error) throw error;

      setRows((data || []) as TargetInvoiceRow[]);
    } catch (error) {
      console.error("Target broker commission load error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const monthGroups = useMemo(() => groupRowsByMonth(rows), [rows]);

  const toggleMonth = (month: string) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [month]: !prev[month],
    }));
  };

  const toggleReason = (key: string) => {
    setExpandedReasons((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const updateMonthStatus = async (
    month: string,
    monthRows: TargetInvoiceRow[],
    status: BrokerageStatus
  ) => {
    const rowIds = monthRows.map((row) => row.id);
    const dbStatus = status || null;

    setSavingStatusKey(month);

    setRows((prev) =>
      prev.map((row) =>
        rowIds.includes(row.id)
          ? {
              ...row,
              brokerage_status: status,
            }
          : row
      )
    );

    const { error } = await supabase
      .from("target_invoices")
      .update({ brokerage_status: dbStatus })
      .in("id", rowIds);

    if (error) {
      console.error("Status update error:", error);
      await loadData();
      alert("Could not update status.");
    }

    setSavingStatusKey(null);
  };

  const updateMonthInvoiceNumber = async (
    month: string,
    monthRows: TargetInvoiceRow[],
    invoiceNumber: string
  ) => {
    const cleanInvoiceNumber = invoiceNumber.slice(0, 10);
    const rowIds = monthRows.map((row) => row.id);

    setSavingInvoiceKey(month);

    setRows((prev) =>
      prev.map((row) =>
        rowIds.includes(row.id)
          ? {
              ...row,
              brokerage_invoice_number: cleanInvoiceNumber,
            }
          : row
      )
    );

    const { error } = await supabase
      .from("target_invoices")
      .update({
        brokerage_invoice_number: cleanInvoiceNumber || null,
      })
      .in("id", rowIds);

    if (error) {
      console.error("Invoice number update error:", error);
      await loadData();
      alert("Could not update invoice number.");
    }

    setSavingInvoiceKey(null);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>

        <p className="mt-1 text-xs text-slate-500">
          {subtitle}
        </p>
      </div>

      {loading ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-8 text-sm text-slate-500">
            Loading Target brokerage commission...
          </CardContent>
        </Card>
      ) : monthGroups.length === 0 ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-8 text-sm text-slate-500">
            No Target brokerage commission data found.
          </CardContent>
        </Card>
      ) : (
        monthGroups.map((monthGroup) => {
          const isMonthOpen = !!expandedMonths[monthGroup.month];
          const reasonGroups = groupRowsByReason(monthGroup.rows);
          const monthStatus = getStatusForRows(monthGroup.rows);
          const statusClass = getStatusRowClass(monthStatus);
          const monthInvoiceNumber = getInvoiceNumberForRows(monthGroup.rows);

          return (
            <Card
              key={monthGroup.month}
              className={`overflow-hidden rounded-3xl border border-slate-200 shadow-sm ${statusClass}`}
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
                      <div className="flex items-center gap-3">
                        <h2 className="text-base font-bold text-slate-900">
                          {monthGroup.month}
                        </h2>

                        <div className="flex items-center gap-2">
                          <label className="text-xs font-semibold text-slate-500">
                            Invoice#
                          </label>

                          <input
                            value={monthInvoiceNumber}
                            maxLength={10}
                            disabled={savingInvoiceKey === monthGroup.month}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              updateMonthInvoiceNumber(
                                monthGroup.month,
                                monthGroup.rows,
                                event.target.value
                              )
                            }
                            className="w-[10ch] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-sm"
                          />
                        </div>
                      </div>

                      <p className="text-xs text-slate-500">
                        {reasonGroups.length} reason code buckets
                      </p>
                    </div>
                  </button>

                  <div className="grid grid-cols-[120px_120px_120px_120px_170px] items-end gap-8 text-right">
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
                        Deductions
                      </div>

                      <div className="text-sm font-bold text-red-600">
                        {formatCurrency(monthGroup.totals.deductions)}
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
                        4% Fee
                      </div>

                      <div className="text-sm font-bold text-emerald-600">
                        {formatCurrency(monthGroup.totals.brokerFee)}
                      </div>
                    </div>

                    <div className="text-left">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Status
                      </div>

                      <select
                        value={monthStatus}
                        disabled={savingStatusKey === monthGroup.month}
                        onChange={(event) =>
                          updateMonthStatus(
                            monthGroup.month,
                            monthGroup.rows,
                            event.target.value as BrokerageStatus
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option
                            key={option.value || "blank"}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
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
                            Target
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
                            Deductions
                          </div>

                          <div className="text-sm font-bold text-red-600">
                            {formatCurrency(monthGroup.totals.deductions)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            Net Total / 4% Broker Fee
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

                      {reasonGroups.map((reasonGroup) => {
                        const reasonKey = `${monthGroup.month}__${reasonGroup.reason}`;
                        const isReasonOpen = !!expandedReasons[reasonKey];
                        const isDeduction = !isWMInvoice(reasonGroup.reason);

                        return (
                          <div
                            key={reasonKey}
                            className="border-t border-slate-200 first:border-t-0"
                          >
                            <button
                              type="button"
                              onClick={() => toggleReason(reasonKey)}
                              className="grid w-full grid-cols-[24px_1fr_160px] items-center px-4 py-2.5 text-left hover:bg-slate-50"
                            >
                              <div>
                                {isReasonOpen ? (
                                  <ChevronDown className="h-4 w-4 text-slate-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-slate-600" />
                                )}
                              </div>

                              <div className="text-sm font-medium text-slate-900">
                                {reasonGroup.reason}
                              </div>

                              <div
                                className={`text-right text-sm font-medium ${
                                  isDeduction ? "text-red-600" : "text-slate-900"
                                }`}
                              >
                                {formatCurrency(reasonGroup.total)}
                              </div>
                            </button>

                            {isReasonOpen && (
                              <div className="border-t border-slate-200 bg-slate-50">
                                <div className="grid grid-cols-[1fr_130px_130px_130px_130px] bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                                  <div>Doc.Header Text</div>
                                  <div>Check #</div>
                                  <div>SAP Doc #</div>
                                  <div>Doc Date</div>
                                  <div className="text-right">Amount</div>
                                </div>

                                {reasonGroup.rows.map((row) => {
                                  const rowIsDeduction = !isWMInvoice(
                                    row.reason_code_description
                                  );

                                  return (
                                    <div
                                      key={row.id}
                                      className="grid grid-cols-[1fr_130px_130px_130px_130px] border-t border-slate-200 px-4 py-2 text-xs text-slate-700"
                                    >
                                      <div>{row.doc_header_text}</div>
                                      <div>{row.check_number}</div>
                                      <div>{row.sap_doc_number}</div>
                                      <div>{row.doc_date}</div>
                                      <div
                                        className={`text-right font-medium ${
                                          rowIsDeduction
                                            ? "text-red-600"
                                            : "text-slate-900"
                                        }`}
                                      >
                                        {formatCurrency(row.net_amount)}
                                      </div>
                                    </div>
                                  );
                                })}
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
