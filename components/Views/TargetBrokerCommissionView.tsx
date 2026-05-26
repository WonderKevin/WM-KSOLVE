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

type MonthGroup = {
  month: string;
  sortValue: number;
  rows: TargetInvoiceRow[];
};

type CheckGroup = {
  key: string;
  checkDate: string;
  checkNumber: string;
  rows: TargetInvoiceRow[];
  totals: Totals;
};

type Totals = {
  wmInvoiceTotal: number;
  deductions: number;
  netTotal: number;
  brokerFee: number;
};

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function monthSortValue(month: string | null) {
  if (!month) return 0;

  const date = new Date(`1 ${month}`);

  if (Number.isNaN(date.getTime())) return 0;

  return date.getFullYear() * 100 + date.getMonth() + 1;
}

function isWmInvoice(row: TargetInvoiceRow) {
  return row.reason_code_description === "WM Invoice";
}

function getTotals(rows: TargetInvoiceRow[]): Totals {
  const wmInvoiceTotal = rows
    .filter(isWmInvoice)
    .reduce((sum, row) => sum + Number(row.net_amount || 0), 0);

  const deductions = rows
    .filter((row) => !isWmInvoice(row))
    .reduce((sum, row) => sum + Number(row.net_amount || 0), 0);

  const netTotal = wmInvoiceTotal + deductions;
  const brokerFee = netTotal * 0.04;

  return {
    wmInvoiceTotal,
    deductions,
    netTotal,
    brokerFee,
  };
}

function groupByMonth(rows: TargetInvoiceRow[]) {
  const map = new Map<string, MonthGroup>();

  for (const row of rows) {
    const month = row.month || "Unknown";

    if (!map.has(month)) {
      map.set(month, {
        month,
        sortValue: monthSortValue(month),
        rows: [],
      });
    }

    map.get(month)!.rows.push(row);
  }

  return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
}

function groupByCheck(rows: TargetInvoiceRow[]): CheckGroup[] {
  const map = new Map<string, TargetInvoiceRow[]>();

  for (const row of rows) {
    const key = `${row.check_date || ""}__${row.check_number || ""}`;

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key)!.push(row);
  }

  return Array.from(map.entries())
    .map(([key, checkRows]) => {
      const first = checkRows[0];

      return {
        key,
        checkDate: first?.check_date || "",
        checkNumber: first?.check_number || "",
        rows: checkRows,
        totals: getTotals(checkRows),
      };
    })
    .sort((a, b) => {
      const dateCompare = b.checkDate.localeCompare(a.checkDate);

      if (dateCompare !== 0) return dateCompare;

      return b.checkNumber.localeCompare(a.checkNumber);
    });
}

function groupByReason(rows: TargetInvoiceRow[]) {
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
      amount: reasonRows.reduce(
        (sum, row) => sum + Number(row.net_amount || 0),
        0
      ),
      rows: reasonRows,
    }))
    .sort((a, b) => {
      if (a.reason === "WM Invoice") return -1;
      if (b.reason === "WM Invoice") return 1;

      return a.reason.localeCompare(b.reason);
    });
}

export default function TargetBrokerCommissionView() {
  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [openReasons, setOpenReasons] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadRows = async () => {
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

    loadRows();
  }, []);

  const monthGroups = useMemo(() => groupByMonth(rows), [rows]);

  const toggleMonth = (month: string) => {
    setOpenMonths((prev) => ({
      ...prev,
      [month]: !prev[month],
    }));
  };

  const toggleCheck = (key: string) => {
    setOpenChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleReason = (key: string) => {
    setOpenReasons((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        {loading ? (
          <p className="text-sm text-slate-500">
            Loading Target broker commission...
          </p>
        ) : monthGroups.length === 0 ? (
          <p className="text-sm text-slate-500">
            No Target broker commission data found.
          </p>
        ) : (
          monthGroups.map((monthGroup) => {
            const monthTotals = getTotals(monthGroup.rows);
            const isMonthOpen = !!openMonths[monthGroup.month];
            const checkGroups = groupByCheck(monthGroup.rows);

            return (
              <div
                key={monthGroup.month}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggleMonth(monthGroup.month)}
                  className="grid w-full grid-cols-[40px_1fr_140px_140px_140px_140px] items-center gap-4 px-5 py-4 text-left hover:bg-slate-50"
                >
                  <div>
                    {isMonthOpen ? (
                      <ChevronDown className="h-4 w-4 text-slate-600" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-600" />
                    )}
                  </div>

                  <div>
                    <div className="text-lg font-bold text-slate-900">
                      {monthGroup.month}
                    </div>
                    <div className="text-sm text-slate-500">
                      {checkGroups.length} check buckets
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">WM Invoice</div>
                    <div className="font-bold text-slate-900">
                      {formatCurrency(monthTotals.wmInvoiceTotal)}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Deductions</div>
                    <div className="font-bold text-red-600">
                      {formatCurrency(monthTotals.deductions)}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Net</div>
                    <div className="font-bold text-slate-900">
                      {formatCurrency(monthTotals.netTotal)}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">4% Fee</div>
                    <div className="font-bold text-emerald-700">
                      {formatCurrency(monthTotals.brokerFee)}
                    </div>
                  </div>
                </button>

                {isMonthOpen && (
                  <div className="border-t border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-4">
                      {checkGroups.map((checkGroup) => {
                        const isCheckOpen = !!openChecks[checkGroup.key];
                        const reasonGroups = groupByReason(checkGroup.rows);

                        return (
                          <div
                            key={checkGroup.key}
                            className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
                          >
                            <button
                              type="button"
                              onClick={() => toggleCheck(checkGroup.key)}
                              className="grid w-full grid-cols-[40px_1fr_150px_150px_150px_150px] items-center gap-4 px-5 py-4 text-left hover:bg-slate-50"
                            >
                              <div>
                                {isCheckOpen ? (
                                  <ChevronDown className="h-4 w-4 text-slate-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-slate-600" />
                                )}
                              </div>

                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Check
                                </div>
                                <div className="font-bold text-slate-900">
                                  #{checkGroup.checkNumber}
                                </div>
                                <div className="text-sm text-slate-500">
                                  {checkGroup.checkDate}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs text-slate-500">
                                  WM Invoice Total
                                </div>
                                <div className="font-bold text-slate-900">
                                  {formatCurrency(
                                    checkGroup.totals.wmInvoiceTotal
                                  )}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs text-slate-500">
                                  Deductions
                                </div>
                                <div className="font-bold text-red-600">
                                  {formatCurrency(checkGroup.totals.deductions)}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs text-slate-500">
                                  Net Total
                                </div>
                                <div className="font-bold text-slate-900">
                                  {formatCurrency(checkGroup.totals.netTotal)}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs text-slate-500">
                                  4% Broker Fee
                                </div>
                                <div className="font-bold text-emerald-700">
                                  {formatCurrency(checkGroup.totals.brokerFee)}
                                </div>
                              </div>
                            </button>

                            {isCheckOpen && (
                              <div className="border-t border-slate-200 bg-slate-50 p-4">
                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                  <div className="grid grid-cols-[1fr_180px] bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
                                    <div>Line Item</div>
                                    <div className="text-right">Amount</div>
                                  </div>

                                  {reasonGroups.map((reasonGroup) => {
                                    const reasonKey = `${checkGroup.key}__${reasonGroup.reason}`;
                                    const isReasonOpen =
                                      !!openReasons[reasonKey];
                                    const isDeduction =
                                      reasonGroup.reason !== "WM Invoice";

                                    return (
                                      <div
                                        key={reasonKey}
                                        className="border-t border-slate-200 first:border-t-0"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleReason(reasonKey)
                                          }
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
                                              isDeduction
                                                ? "text-red-600"
                                                : "text-slate-900"
                                            }`}
                                          >
                                            {formatCurrency(reasonGroup.amount)}
                                          </div>
                                        </button>

                                        {isReasonOpen && (
                                          <div className="border-t border-slate-200 bg-slate-50">
                                            <div className="grid grid-cols-[1fr_160px_160px_160px] bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600">
                                              <div>Doc.Header Text</div>
                                              <div>SAP Doc #</div>
                                              <div>Doc Date</div>
                                              <div className="text-right">
                                                Amount
                                              </div>
                                            </div>

                                            {reasonGroup.rows.map((row) => (
                                              <div
                                                key={row.id}
                                                className="grid grid-cols-[1fr_160px_160px_160px] border-t border-slate-200 px-4 py-3 text-sm text-slate-700"
                                              >
                                                <div>{row.doc_header_text}</div>
                                                <div>{row.sap_doc_number}</div>
                                                <div>{row.doc_date}</div>
                                                <div
                                                  className={`text-right font-medium ${
                                                    row.reason_code_description ===
                                                    "WM Invoice"
                                                      ? "text-slate-900"
                                                      : "text-red-600"
                                                  }`}
                                                >
                                                  {formatCurrency(
                                                    row.net_amount
                                                  )}
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
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}