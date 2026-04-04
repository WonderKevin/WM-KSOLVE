"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type WMRow = {
  month: string;
  check_date: string;
  invoice: string;
  type: string;
  amt: number;
};

type KsolveRow = {
    month: string | null;
    check_date: string | null;
    check_number: string | null;
    invoice_number: string | null;
    invoice_amt: number | null;
  };

type DiscrepancyRow = {
  month: string;
  checkDate: string;
  checkNo: string;
  invoice: string;
  type: string;
  ksolveAmount: number;
  wmAmount: number;
  discrepancy: number;
  percentage: number;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

function normalizeType(value: string) {
  return String(value || "").trim().toUpperCase();
}

function isWmInvoiceType(value: string) {
  const t = normalizeType(value);
  return t === "WM INVOICE" || t === "WMINVOICE";
}

export default function WMInvoiceDiscrepancyView() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // WM amounts from Data Sets
      const { data: wmData, error: wmError } = await supabase
        .from("broker_commission_datasets")
        .select("month, check_date, invoice, type, amt")
        .order("check_date", { ascending: false, nullsFirst: false });

      if (wmError) {
        console.error("Failed to load WM dataset rows:", wmError);
      }

      // KSolve amounts
      // If your real table/field names differ, only adjust this query.
      const { data: ksolveData, error: ksolveError } = await supabase
  .from("invoices")
  .select("month, check_date, check_number, invoice_number, invoice_amt, type")
  .eq("type", "WM Invoice")
  .order("check_date", { ascending: false, nullsFirst: false });

      if (ksolveError) {
        console.error("Failed to load Ksolve invoice rows:", ksolveError);
      }

      const wmRows = ((wmData ?? []) as WMRow[]).filter((row) =>
        isWmInvoiceType(row.type)
      );

      const ksolveRows = (ksolveData ?? []) as KsolveRow[];

      const wmByInvoice = new Map<
        string,
        {
          month: string;
          checkDate: string;
          invoice: string;
          type: string;
          wmAmount: number;
        }
      >();

      for (const row of wmRows) {
        const invoice = normalizeInvoice(row.invoice);
        if (!invoice) continue;

        const current = wmByInvoice.get(invoice);

        if (!current) {
          wmByInvoice.set(invoice, {
            month: row.month ?? "",
            checkDate: row.check_date ?? "",
            invoice,
            type: row.type ?? "WM Invoice",
            wmAmount: Math.abs(Number(row.amt ?? 0)),
          });
        } else {
          current.wmAmount += Math.abs(Number(row.amt ?? 0));
        }
      }

      const ksolveByInvoice = new Map<
        string,
        {
          month: string;
          checkDate: string;
          checkNo: string;
          invoice: string;
          ksolveAmount: number;
        }
      >();

      for (const row of ksolveRows) {
        const invoice = normalizeInvoice(row.invoice_number);
        if (!invoice) continue;
      
        const current = ksolveByInvoice.get(invoice);
      
        if (!current) {
          ksolveByInvoice.set(invoice, {
            month: row.month ?? "",
            checkDate: row.check_date ?? "",
            checkNo: row.check_number ?? "",
            invoice,
            ksolveAmount: Number(row.invoice_amt ?? 0),
          });
        } else {
          current.ksolveAmount += Number(row.invoice_amt ?? 0);
        }
      }

      const allInvoices = Array.from(
        new Set([...wmByInvoice.keys(), ...ksolveByInvoice.keys()])
      );

      const merged: DiscrepancyRow[] = allInvoices.map((invoice) => {
        const wm = wmByInvoice.get(invoice);
        const ks = ksolveByInvoice.get(invoice);

        const wmAmount = wm?.wmAmount ?? 0;
        const ksolveAmount = ks?.ksolveAmount ?? 0;
        const discrepancy = wmAmount - ksolveAmount;
        const percentage = wmAmount !== 0 ? (discrepancy / wmAmount) * 100 : 0;

        return {
          month: wm?.month || ks?.month || "",
          checkDate: wm?.checkDate || ks?.checkDate || "",
          checkNo: ks?.checkNo || "",
          invoice,
          type: wm?.type || "WM Invoice",
          ksolveAmount,
          wmAmount,
          discrepancy,
          percentage,
        };
      });

      merged.sort((a, b) => {
        const aTime = a.checkDate ? new Date(a.checkDate).getTime() : 0;
        const bTime = b.checkDate ? new Date(b.checkDate).getTime() : 0;
        return bTime - aTime;
      });

      setRows(merged);
      setLoading(false);
    };

    load();
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.ksolveAmount += row.ksolveAmount;
        acc.wmAmount += row.wmAmount;
        acc.discrepancy += row.discrepancy;
        return acc;
      },
      {
        ksolveAmount: 0,
        wmAmount: 0,
        discrepancy: 0,
      }
    );
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-lg font-semibold text-slate-900">
          WM Invoice Discrepancy
        </div>
        <p className="mt-1 text-sm text-slate-500">
          WM Amount comes from Data Sets. Ksolve Amount comes from Ksolve Invoices.
          Discrepancy = WM Amount - Ksolve Amount.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ksolve Amount</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">
            {formatMoney(totals.ksolveAmount)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">WM Amount</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">
            {formatMoney(totals.wmAmount)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Total Discrepancy</div>
          <div
            className={`mt-1 text-xl font-semibold ${
              totals.discrepancy === 0
                ? "text-slate-900"
                : totals.discrepancy > 0
                ? "text-amber-600"
                : "text-red-600"
            }`}
          >
            {formatMoney(totals.discrepancy)}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading discrepancy data...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No WM invoice discrepancy rows found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Check #</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Invoice</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Ksolve Amount</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">WM Amount</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Discrepancy</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.invoice} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{row.month}</td>
                    <td className="px-4 py-3 text-slate-700">{row.checkDate || "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{row.checkNo || "-"}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.invoice}</td>
                    <td className="px-4 py-3 text-slate-700">{row.type}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatMoney(row.ksolveAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatMoney(row.wmAmount)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        row.discrepancy === 0
                          ? "text-slate-900"
                          : row.discrepancy > 0
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {formatMoney(row.discrepancy)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        row.discrepancy === 0
                          ? "text-slate-900"
                          : row.discrepancy > 0
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {formatPercent(row.percentage)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}