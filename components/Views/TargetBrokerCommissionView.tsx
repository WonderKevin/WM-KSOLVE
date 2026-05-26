"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isWMInvoice(reason: string | null | undefined) {
  return String(reason || "")
    .trim()
    .toLowerCase() === "wminvoice";
}

function formatMonthLabel(month: string | null | undefined) {
  if (!month) return "Unknown";

  const parsed = new Date(`${month}-01`);

  if (Number.isNaN(parsed.getTime())) {
    return month;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────

export default function TargetBrokerCommissionView() {
  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);

  const [loading, setLoading] = useState(true);

  const [expandedMonths, setExpandedMonths] =
    useState<Record<string, boolean>>({});

  const [expandedChecks, setExpandedChecks] =
    useState<Record<string, boolean>>({});

  // ───────────────────────────────────────────────────────────
  // LOAD DATA
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("target_invoices")
        .select("*")
        .order("check_date", {
          ascending: false,
        });

      if (error) {
        console.error(error);
      } else {
        setRows((data || []) as TargetInvoiceRow[]);
      }

      setLoading(false);
    };

    loadData();
  }, []);

  // ───────────────────────────────────────────────────────────
  // GROUPED DATA
  // ───────────────────────────────────────────────────────────

  const groupedByMonth = useMemo(() => {
    const grouped: Record<
      string,
      Record<string, TargetInvoiceRow[]>
    > = {};

    for (const row of rows) {
      const month = row.month || "Unknown";

      const check =
        row.check_number || "Unknown";

      if (!grouped[month]) {
        grouped[month] = {};
      }

      if (!grouped[month][check]) {
        grouped[month][check] = [];
      }

      grouped[month][check].push(row);
    }

    return grouped;
  }, [rows]);

  // ───────────────────────────────────────────────────────────
  // TOGGLES
  // ───────────────────────────────────────────────────────────

  const toggleMonth = (month: string) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [month]: !prev[month],
    }));
  };

  const toggleCheck = (check: string) => {
    setExpandedChecks((prev) => ({
      ...prev,
      [check]: !prev[check],
    }));
  };

  // ───────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">
          Target Brokerage Commission
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Target brokerage summary by check number with deductions,
          net totals, and 4% broker fee.
        </p>
      </div>

      {/* CONTENT */}
      {loading ? (
        <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-10 text-sm text-slate-500">
            Loading Target brokerage commission...
          </CardContent>
        </Card>
      ) : (
        Object.entries(groupedByMonth).map(
          ([month, checks]) => {
            const monthRows =
              Object.values(checks).flat();

            const monthWM = round2(
              monthRows
                .filter((r) =>
                  isWMInvoice(
                    r.reason_code_description
                  )
                )
                .reduce(
                  (sum, r) =>
                    sum +
                    Number(r.net_amount || 0),
                  0
                )
            );

            const monthDeductions = round2(
              monthRows
                .filter(
                  (r) =>
                    !isWMInvoice(
                      r.reason_code_description
                    )
                )
                .reduce(
                  (sum, r) =>
                    sum +
                    Number(r.net_amount || 0),
                  0
                )
            );

            const monthNet = round2(
              monthWM + monthDeductions
            );

            const monthFee = round2(
              monthNet * 0.04
            );

            return (
              <Card
                key={month}
                className="rounded-3xl border border-slate-200 bg-white shadow-sm"
              >
                <CardContent className="p-0">
                  {/* MONTH HEADER */}
                  <button
                    onClick={() =>
                      toggleMonth(month)
                    }
                    className="flex w-full items-start justify-between px-6 py-5 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-1">
                        {expandedMonths[month] ? (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-500" />
                        )}
                      </div>

                      <div>
                        <h2 className="text-2xl font-bold text-slate-900">
                          {formatMonthLabel(
                            month
                          )}
                        </h2>

                        <p className="text-sm text-slate-500">
                          {
                            Object.keys(checks)
                              .length
                          }{" "}
                          check buckets
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-10 text-right">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">
                          WM Invoice
                        </div>

                        <div className="text-xl font-bold text-slate-900">
                          {formatCurrency(
                            monthWM
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">
                          Deductions
                        </div>

                        <div className="text-xl font-bold text-red-600">
                          {formatCurrency(
                            monthDeductions
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">
                          Net
                        </div>

                        <div className="text-xl font-bold text-slate-900">
                          {formatCurrency(
                            monthNet
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">
                          4% Fee
                        </div>

                        <div className="text-xl font-bold text-emerald-600">
                          {formatCurrency(
                            monthFee
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* CHECKS */}
                  {expandedMonths[month] && (
                    <div className="space-y-4 border-t border-slate-200 px-4 py-4">
                      {Object.entries(
                        checks
                      ).map(
                        ([
                          checkNumber,
                          checkRows,
                        ]) => {
                          const wmTotal =
                            round2(
                              checkRows
                                .filter((r) =>
                                  isWMInvoice(
                                    r.reason_code_description
                                  )
                                )
                                .reduce(
                                  (
                                    sum,
                                    r
                                  ) =>
                                    sum +
                                    Number(
                                      r.net_amount ||
                                        0
                                    ),
                                  0
                                )
                            );

                          const deductions =
                            round2(
                              checkRows
                                .filter(
                                  (r) =>
                                    !isWMInvoice(
                                      r.reason_code_description
                                    )
                                )
                                .reduce(
                                  (
                                    sum,
                                    r
                                  ) =>
                                    sum +
                                    Number(
                                      r.net_amount ||
                                        0
                                    ),
                                  0
                                )
                            );

                          const netTotal =
                            round2(
                              wmTotal +
                                deductions
                            );

                          const fee =
                            round2(
                              netTotal *
                                0.04
                            );

                          return (
                            <div
                              key={
                                checkNumber
                              }
                              className="overflow-hidden rounded-3xl border border-slate-200"
                            >
                              {/* CHECK HEADER */}
                              <button
                                onClick={() =>
                                  toggleCheck(
                                    checkNumber
                                  )
                                }
                                className="flex w-full items-center justify-between px-6 py-5 text-left"
                              >
                                <div className="flex items-center gap-4">
                                  {expandedChecks[
                                    checkNumber
                                  ] ? (
                                    <ChevronDown className="h-4 w-4 text-slate-500" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-slate-500" />
                                  )}

                                  <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">
                                      Check
                                    </div>

                                    <div className="text-2xl font-bold text-slate-900">
                                      #
                                      {
                                        checkNumber
                                      }
                                    </div>

                                    <div className="text-sm text-slate-500">
                                      {
                                        checkRows[0]
                                          ?.check_date
                                      }
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-4 gap-10 text-right">
                                  <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">
                                      WM Invoice Total
                                    </div>

                                    <div className="text-xl font-bold text-slate-900">
                                      {formatCurrency(
                                        wmTotal
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">
                                      Deductions
                                    </div>

                                    <div className="text-xl font-bold text-red-600">
                                      {formatCurrency(
                                        deductions
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">
                                      Net Total
                                    </div>

                                    <div className="text-xl font-bold text-slate-900">
                                      {formatCurrency(
                                        netTotal
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">
                                      4% Broker Fee
                                    </div>

                                    <div className="text-xl font-bold text-emerald-600">
                                      {formatCurrency(
                                        fee
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </button>

                              {/* LINE ITEMS */}
                              {expandedChecks[
                                checkNumber
                              ] && (
                                <div className="border-t border-slate-200">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50">
                                      <tr>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-700">
                                          Line Item
                                        </th>

                                        <th className="px-4 py-3 text-right font-semibold text-slate-700">
                                          Amount
                                        </th>
                                      </tr>
                                    </thead>

                                    <tbody>
                                      {checkRows.map(
                                        (
                                          row,
                                          idx
                                        ) => (
                                          <tr
                                            key={
                                              idx
                                            }
                                            className="border-t border-slate-200"
                                          >
                                            <td className="px-4 py-3 text-slate-900">
                                              {
                                                row.reason_code_description
                                              }
                                            </td>

                                            <td
                                              className={`px-4 py-3 text-right font-medium ${
                                                Number(
                                                  row.net_amount ||
                                                    0
                                                ) <
                                                0
                                                  ? "text-red-600"
                                                  : "text-slate-900"
                                              }`}
                                            >
                                              {formatCurrency(
                                                Number(
                                                  row.net_amount ||
                                                    0
                                                )
                                              )}
                                            </td>
                                          </tr>
                                        )
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          }
        )
      )}
    </div>
  );
}