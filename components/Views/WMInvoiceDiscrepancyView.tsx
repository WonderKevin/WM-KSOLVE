"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, MessageSquare, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";

type WMRow = {
  month: string | null;
  check_date: string | null;
  invoice_date: string | null;
  invoice: string | null;
  type: string | null;
  amt: number | null;
};

type KsolveRow = {
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  invoice_number: string | null;
  invoice_amt: number | null;
};

type ReconciliationStatus = "No Action" | "Submitted" | "Resolved" | "Rejected";

type DiscrepancyRow = {
  month: string;
  invoiceDate: string;
  checkDate: string;
  checkNo: string;
  invoice: string;
  type: string;
  ksolveAmount: number;
  wmAmount: number;
  discrepancy: number;
  percentage: number;
  discountTerms: "Yes" | "No" | "-";
  daysToPay: number | null;
  status: ReconciliationStatus;
  statusNote: string;
};

const PAGE_SIZE = 1000;
const STATUS_OPTIONS: ReconciliationStatus[] = [
  "No Action",
  "Submitted",
  "Resolved",
  "Rejected",
];

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function normalizeInvoice(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";

  return raw
    .replace(/,/g, "")
    .replace(/\.0+$/g, "")
    .replace(/[.]+$/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeType(value: string) {
  return String(value || "").trim().toUpperCase();
}

function isWmInvoiceType(value: string) {
  const t = normalizeType(value);
  return t === "WM INVOICE" || t === "WMINVOICE";
}

function formatMonthShort(value: string): string {
  if (!value) return value;
  if (/^[A-Za-z]+ '\d{2}$/.test(value.trim())) return value.trim();

  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) return `${m[1]} '${m[2].slice(-2)}`;

  return value;
}

function parseLocalDate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));

  return null;
}

function formatMonthFromDate(value: string | null | undefined) {
  const parsed = parseLocalDate(value);
  if (!parsed) return "";

  return `${parsed.toLocaleString("en-US", { month: "long" })} ${parsed.getFullYear()}`;
}

function formatDisplayDate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[1].padStart(2, "0")}/${mdy[2].padStart(2, "0")}/${mdy[3]}`;

  return raw;
}

function getDaysToPay(checkDate: string | null | undefined, invoiceDate: string | null | undefined) {
  const check = parseLocalDate(checkDate);
  const invoice = parseLocalDate(invoiceDate);
  if (!check || !invoice) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((check.getTime() - invoice.getTime()) / msPerDay);
}

function getDiscountTermsStatus(checkDate: string, invoiceDate: string): "Yes" | "No" | "-" {
  const daysToPay = getDaysToPay(checkDate, invoiceDate);
  if (daysToPay === null) return "-";
  return daysToPay <= 15 ? "Yes" : "No";
}

function parseMonthOrder(value: string) {
  const monthMap: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return -1;

  const monthIndex = monthMap[match[1].toLowerCase()];
  if (monthIndex === undefined) return -1;

  const yearRaw = match[2];
  const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);
  return year * 100 + monthIndex;
}

function statusClass(status: ReconciliationStatus) {
  switch (status) {
    case "Submitted":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "Resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Rejected":
      return "border-red-200 bg-red-50 text-red-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

async function fetchAllWmDatasetRows(): Promise<WMRow[]> {
  let allRows: WMRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("broker_commission_datasets")
      .select("month, check_date, invoice_date, invoice, type, amt")
      .order("check_date", { ascending: false, nullsFirst: false })
      .order("invoice", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as WMRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) keepGoing = false;
    else from += PAGE_SIZE;
  }

  return allRows;
}

async function fetchAllKsolveInvoiceRows(): Promise<KsolveRow[]> {
  let allRows: KsolveRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("invoices")
      .select("month, check_date, check_number, invoice_number, invoice_amt, type")
      .eq("type", "WM Invoice")
      .order("check_date", { ascending: false, nullsFirst: false })
      .order("invoice_number", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as KsolveRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) keepGoing = false;
    else from += PAGE_SIZE;
  }

  return allRows;
}

export default function WMInvoiceDiscrepancyView() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("All Months");
  const [selectedStatus, setSelectedStatus] = useState("All Statuses");

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      let wmData: WMRow[] = [];
      let ksolveData: KsolveRow[] = [];

      try {
        wmData = await fetchAllWmDatasetRows();
      } catch (error) {
        console.error("Failed to load WM dataset rows:", error);
      }

      try {
        ksolveData = await fetchAllKsolveInvoiceRows();
      } catch (error) {
        console.error("Failed to load Ksolve invoice rows:", error);
      }

      const wmRows = ((wmData ?? []) as WMRow[]).filter((row) =>
        isWmInvoiceType(row.type ?? ""),
      );

      const wmByInvoice = new Map<
        string,
        {
          month: string;
          invoiceDate: string;
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
            month:
              formatMonthFromDate(row.invoice_date ?? row.check_date ?? "") ||
              String(row.month || "").trim() ||
              "",
            invoiceDate: formatDisplayDate(row.invoice_date),
            checkDate: formatDisplayDate(row.check_date),
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

      for (const row of ksolveData) {
        const invoice = normalizeInvoice(row.invoice_number);
        if (!invoice) continue;

        const current = ksolveByInvoice.get(invoice);

        if (!current) {
          ksolveByInvoice.set(invoice, {
            month:
              formatMonthFromDate(row.check_date ?? "") ||
              String(row.month || "").trim() ||
              "",
            checkDate: formatDisplayDate(row.check_date),
            checkNo: row.check_number ?? "",
            invoice,
            ksolveAmount: Number(row.invoice_amt ?? 0),
          });
        } else {
          current.ksolveAmount += Number(row.invoice_amt ?? 0);
        }
      }

      const allInvoices = Array.from(
        new Set([...wmByInvoice.keys(), ...ksolveByInvoice.keys()]),
      );

      const merged: DiscrepancyRow[] = allInvoices.map((invoice) => {
        const wm = wmByInvoice.get(invoice);
        const ks = ksolveByInvoice.get(invoice);

        const wmAmount = wm?.wmAmount ?? 0;
        const ksolveAmount = ks?.ksolveAmount ?? 0;
        const discrepancy = ksolveAmount - wmAmount;
        const percentage = wmAmount !== 0 ? (discrepancy / wmAmount) * 100 : 0;

        return {
          month: wm?.month || ks?.month || "",
          invoiceDate: wm?.invoiceDate || "",
          checkDate: wm?.checkDate || ks?.checkDate || "",
          checkNo: ks?.checkNo || "",
          invoice,
          type: wm?.type || "WM Invoice",
          ksolveAmount,
          wmAmount,
          discrepancy,
          percentage,
          discountTerms: getDiscountTermsStatus(
            wm?.checkDate || ks?.checkDate || "",
            wm?.invoiceDate || "",
          ),
          daysToPay: getDaysToPay(
            wm?.checkDate || ks?.checkDate || "",
            wm?.invoiceDate || "",
          ),
          status: "No Action",
          statusNote: "",
        };
      });

      merged.sort((a, b) => {
        const aTime = parseLocalDate(a.checkDate)?.getTime() ?? 0;
        const bTime = parseLocalDate(b.checkDate)?.getTime() ?? 0;
        return bTime - aTime;
      });

      setRows(merged);
      setLoading(false);
    };

    load();
  }, []);

  const monthOptions = useMemo(() => {
    return [
      "All Months",
      ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean))).sort(
        (a, b) => parseMonthOrder(b) - parseMonthOrder(a),
      ),
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      const monthMatch =
        selectedMonth === "All Months" || row.month === selectedMonth;

      const statusMatch =
        selectedStatus === "All Statuses" || row.status === selectedStatus;

      if (!monthMatch || !statusMatch) return false;
      if (!q) return true;

      const haystack = [
        row.month,
        row.invoiceDate,
        row.checkDate,
        row.checkNo,
        row.invoice,
        row.discountTerms,
        row.daysToPay ?? "",
        row.type,
        row.status,
        row.statusNote,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [rows, search, selectedMonth, selectedStatus]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.ksolveAmount += row.ksolveAmount;
        acc.wmAmount += row.wmAmount;
        acc.discrepancy += row.discrepancy;
        return acc;
      },
      { ksolveAmount: 0, wmAmount: 0, discrepancy: 0 },
    );
  }, [filteredRows]);

  const updateStatus = (invoice: string, status: ReconciliationStatus) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.invoice !== invoice) return row;

        if (status === "Rejected") {
          const note = window.prompt(
            "Add a rejection note for this discrepancy:",
            row.statusNote || "",
          );

          return {
            ...row,
            status,
            statusNote: note === null ? row.statusNote : note.trim(),
          };
        }

        return { ...row, status };
      }),
    );
  };

  const updateRejectedNote = (invoice: string) => {
    const current = rows.find((row) => row.invoice === invoice);
    const note = window.prompt(
      "Add or update rejection note:",
      current?.statusNote || "",
    );

    if (note === null) return;

    setRows((prev) =>
      prev.map((row) =>
        row.invoice === invoice ? { ...row, statusNote: note.trim() } : row,
      ),
    );
  };

  const exportToExcel = () => {
    const exportRows = filteredRows.map((row) => ({
      Month: formatMonthShort(row.month),
      "Check Date": row.checkDate,
      "Check #": row.checkNo,
      "Invoice Date": row.invoiceDate,
      Invoice: row.invoice,
      "2% 10 / NET 30": row.discountTerms,
      "# of Days": row.daysToPay ?? "",
      Type: row.type,
      "Ksolve Amount": row.ksolveAmount,
      "WM Amount": row.wmAmount,
      Discrepancy: row.discrepancy,
      Percentage: row.percentage,
      Status: row.status,
      "Status Note": row.statusNote,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "WM Invoice Discrepancy");
    XLSX.writeFile(workbook, "wm-invoice-discrepancy.xlsx");
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-[116px] z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_1fr_1fr_1.8fr_220px_220px_auto]">
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
                    ? "text-emerald-700"
                    : "text-red-600"
              }`}
            >
              {formatMoney(totals.discrepancy)}
            </div>
          </div>

          <div className="relative self-stretch">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search month, invoice date, check date, check #, invoice, type, status..."
              className="h-full min-h-[72px] w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-slate-300"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="min-h-[72px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month === "All Months" ? month : formatMonthShort(month)}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="min-h-[72px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="All Statuses">All Statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={exportToExcel}
            disabled={filteredRows.length === 0}
            className="flex min-h-[72px] w-[72px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Export to Excel"
            aria-label="Export to Excel"
          >
            <FileSpreadsheet className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading discrepancy data...</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No WM invoice discrepancy rows found.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1650px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "Month",
                    "Check Date",
                    "Check #",
                    "Invoice Date",
                    "Invoice",
                    "2% 10 / NET 30",
                    "# of Days",
                    "Type",
                    "Ksolve Amount",
                    "WM Amount",
                    "Discrepancy",
                    "Percentage",
                    "Status",
                  ].map((header) => (
                    <th
                      key={header}
                      className={`whitespace-nowrap px-5 py-3 font-semibold text-slate-700 ${
                        ["# of Days", "Ksolve Amount", "WM Amount", "Discrepancy", "Percentage"].includes(header)
                          ? "text-right"
                          : header === "2% 10 / NET 30"
                            ? "text-center"
                            : "text-left"
                      }`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.invoice} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                      {formatMonthShort(row.month)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                      {row.checkDate || "-"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                      {row.checkNo || "-"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                      {row.invoiceDate || "-"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-900">
                      {row.invoice}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.discountTerms === "Yes"
                            ? "bg-emerald-50 text-emerald-700"
                            : row.discountTerms === "No"
                              ? "bg-red-50 text-red-600"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.discountTerms}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-700">
                      {row.daysToPay ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                      {row.type}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700">
                      {formatMoney(row.ksolveAmount)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700">
                      {formatMoney(row.wmAmount)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-3 text-right font-medium ${
                        row.discrepancy === 0
                          ? "text-slate-900"
                          : row.discrepancy > 0
                            ? "text-emerald-700"
                            : "text-red-600"
                      }`}
                    >
                      {formatMoney(row.discrepancy)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-3 text-right font-medium ${
                        row.discrepancy === 0
                          ? "text-slate-900"
                          : row.discrepancy > 0
                            ? "text-emerald-700"
                            : "text-red-600"
                      }`}
                    >
                      {formatPercent(row.percentage)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <div className="group flex items-center gap-2">
                        <select
                          value={row.status}
                          onChange={(e) =>
                            updateStatus(
                              row.invoice,
                              e.target.value as ReconciliationStatus,
                            )
                          }
                          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold outline-none ${statusClass(
                            row.status,
                          )}`}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>

                        {row.status === "Rejected" && (
                          <button
                            type="button"
                            onClick={() => updateRejectedNote(row.invoice)}
                            title={row.statusNote || "Add rejection note"}
                            className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 opacity-70 transition hover:bg-red-50 hover:opacity-100 group-hover:opacity-100"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Note
                          </button>
                        )}
                      </div>

                      {row.status === "Rejected" && row.statusNote && (
                        <div className="mt-1 max-w-[260px] truncate text-xs text-slate-500">
                          {row.statusNote}
                        </div>
                      )}
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