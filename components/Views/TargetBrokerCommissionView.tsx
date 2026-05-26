"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";

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
};

type ReasonGroup = {
  reason: string;
  rows: TargetInvoiceRow[];
  total: number;
};

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

function formatMonthLabel(month: string | null | undefined) {
  return month || "Unknown";
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

export default function TargetBrokerCommissionView() {
  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );

  const [expandedReasons, setExpandedReasons] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from("target_invoices")
          .select(
            "id, month, check_date, check_number, doc_header_text, reason_code_description, sap_doc_number, doc_date, gross_amount, cash_discount, withholding_tax_amount, net_amount"
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

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">
          Target Brokerage Commission
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Target brokerage summary by month and reason code description.
        </p>
      </div>

      {loading ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-10 text-sm text-slate-500">
            Loading Target brokerage commission...
          </CardContent>
        </Card>
      ) : monthGroups.length === 0 ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-10 text-sm text-slate-500">
            No Target brokerage commission data found.
          </CardContent>
        </Card>
      ) : (
        monthGroups.map((monthGroup) => {
          const isMonthOpen = !!expandedMonths[monthGroup.month];
          const reasonGroups = groupRowsByReason(monthGroup.rows);

          return (
            <Card
              key={monthGroup.month}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <CardContent className="p-0">
                <button
                  type="button"
                  onClick={() => toggleMonth(monthGroup.month)}
                  className="flex w-full items-start justify-between px-6 py-5 text-left hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-1">
                      {isMonthOpen ? (
                        <ChevronDown className="h-4 w-4 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      )}
                    </div>

                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">
                        {formatMonthLabel(monthGroup.month)}
                      </h2>

                      <p className="text-sm text-slate-500">
                        {reasonGroups.length} reason code buckets
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-10 text-right">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">
                        WM Invoice
                      </div>

                      <div className="text-xl font-bold text-slate-900">
                        {formatCurrency(monthGroup.totals.wmInvoiceTotal)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">
                        Deductions
                      </div>

                      <div className="text-xl font-bold text-red-600">
                        {formatCurrency(monthGroup.totals.deductions)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">
                        Net
                      </div>

                      <div className="text-xl font-bold text-slate-900">
                        {formatCurrency(monthGroup.totals.netTotal)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">
                        4% Fee
                      </div>

                      <div className="text-xl font-bold text-emerald-600">
                        {formatCurrency(monthGroup.totals.brokerFee)}
                      </div>
                    </div>
                  </div>
                </button>

                {isMonthOpen && (
                  <div className="border-t border-slate-200 bg-slate-50 p-4">
                    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-6 border-b border-slate-200 px-4 py-4">
                        <div>
                          <div className="text-xs font-medium text-slate-400">
                            Retailer
                          </div>

                          <div className="font-bold text-slate-900">
                            Target
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-400">
                            WM Invoice Total
                          </div>

                          <div className="font-bold text-slate-900">
                            {formatCurrency(monthGroup.totals.wmInvoiceTotal)}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-400">
                            Deductions
                          </div>

                          <div className="font-bold text-red-600">
                            {formatCurrency(monthGroup.totals.deductions)}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-400">
                            Net Total / 4% Broker Fee
                          </div>

                          <div className="font-bold text-slate-900">
                            {formatCurrency(monthGroup.totals.netTotal)}
                          </div>

                          <div className="font-bold text-emerald-600">
                            {formatCurrency(monthGroup.totals.brokerFee)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_180px] bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
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
                              className="grid w-full grid-cols-[24px_1fr_180px] items-center px-4 py-3 text-left hover:bg-slate-50"
                            >
                              <div>
                                {isReasonOpen ? (
                                  <ChevronDown className="h-4 w-4 text-slate-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-slate-600" />
                                )}
                              </div>

                              <div className="font-medium text-slate-900">
                                {reasonGroup.reason}
                              </div>

                              <div
                                className={`text-right font-medium ${
                                  isDeduction ? "text-red-600" : "text-slate-900"
                                }`}
                              >
                                {formatCurrency(reasonGroup.total)}
                              </div>
                            </button>

                            {isReasonOpen && (
                              <div className="border-t border-slate-200 bg-slate-50">
                                <div className="grid grid-cols-[1fr_150px_150px_150px_150px] bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600">
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
                                      className="grid grid-cols-[1fr_150px_150px_150px_150px] border-t border-slate-200 px-4 py-3 text-sm text-slate-700"
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