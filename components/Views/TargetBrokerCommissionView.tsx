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

function getTotals(rows: TargetInvoiceRow[]) {
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

function groupByCheck(rows: TargetInvoiceRow[]) {
  const map = new Map<string, TargetInvoiceRow[]>();

  for (const row of rows) {
    const key = `${row.check_date || ""}__${row.check_number || ""}`;

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key)!.push(row);
  }

  return Array.from(map.entries()).map(([key, checkRows]) => {
    const first = checkRows[0];

    return {
      key,
      checkDate: first?.check_date || "",
      checkNumber: first?.check_number || "",
      rows: checkRows,
      totals: getTotals(checkRows),
    };
  });
}

export default function TargetBrokerCommissionView() {
  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});

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
                              <div className="border-t border-slate-200">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-100">
                                    <tr>
                                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                                        Line Item
                                      </th>
                                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                                        Doc.Header Text
                                      </th>
                                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                                        SAP Doc #
                                      </th>
                                      <th className="px-4 py-3 text-left font-semibold text-slate-700">
                                        Doc Date
                                      </th>
                                      <th className="px-4 py-3 text-right font-semibold text-slate-700">
                                        Amount
                                      </th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {checkGroup.rows.map((row) => {
                                      const isDeduction = !isWmInvoice(row);

                                      return (
                                        <tr
                                          key={row.id}
                                          className="border-t border-slate-200"
                                        >
                                          <td className="px-4 py-3 font-medium text-slate-900">
                                            {row.reason_code_description ||
                                              "Unknown"}
                                          </td>
                                          <td className="px-4 py-3 text-slate-700">
                                            {row.doc_header_text}
                                          </td>
                                          <td className="px-4 py-3 text-slate-700">
                                            {row.sap_doc_number}
                                          </td>
                                          <td className="px-4 py-3 text-slate-700">
                                            {row.doc_date}
                                          </td>
                                          <td
                                            className={`px-4 py-3 text-right font-medium ${
                                              isDeduction
                                                ? "text-red-600"
                                                : "text-slate-900"
                                            }`}
                                          >
                                            {formatCurrency(row.net_amount)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
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