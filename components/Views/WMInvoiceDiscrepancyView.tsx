"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Search, X } from "lucide-react";
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

type ClaimRow = {
  id?: string;
  invoice: string;
  claim_status: ClaimStatus | string | null;
  claim_amount: number | null;
  recovered_amount: number | null;
  claim_date: string | null;
  resolved_date: string | null;
  claim_ref: string | null;
  notes: string | null;
  updated_at?: string | null;
};

type ClaimStatus = "No Action" | "Needs Review" | "Submitted" | "Follow Up" | "Recovered" | "Rejected";

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
  claimStatus: ClaimStatus;
  claimAmount: number;
  recoveredAmount: number;
  openBalance: number;
  claimDate: string;
  resolvedDate: string;
  claimRef: string;
  notes: string;
};

const PAGE_SIZE = 1000;
const CLAIM_STATUS_OPTIONS: ClaimStatus[] = [
  "No Action",
  "Needs Review",
  "Submitted",
  "Follow Up",
  "Recovered",
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

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function hasDiscrepancy(discrepancy: number) {
  return Math.abs(discrepancy) > 0.005;
}

function getDefaultClaimStatus(discountTerms: "Yes" | "No" | "-", discrepancy: number): ClaimStatus {
  if (!hasDiscrepancy(discrepancy)) return "No Action";
  if (discountTerms === "Yes") return "No Action";
  return "Needs Review";
}

function normalizeClaimStatus(value: string | null | undefined, fallback: ClaimStatus): ClaimStatus {
  const raw = String(value || "").trim();
  if (raw === "Not Submitted") return fallback === "No Action" ? "No Action" : "Needs Review";
  if (raw === "Resolved") return "Recovered";
  return CLAIM_STATUS_OPTIONS.includes(raw as ClaimStatus) ? (raw as ClaimStatus) : fallback;
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

function claimClass(status: ClaimStatus) {
  switch (status) {
    case "Needs Review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "Submitted":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "Follow Up":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "Recovered":
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

async function fetchAllClaimRows(): Promise<ClaimRow[]> {
  let allRows: ClaimRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("wm_invoice_claims")
      .select("id, invoice, claim_status, claim_amount, recovered_amount, claim_date, resolved_date, claim_ref, notes, updated_at")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as ClaimRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) keepGoing = false;
    else from += PAGE_SIZE;
  }

  return allRows;
}

export default function WMInvoiceDiscrepancyView() {
  const [loading, setLoading] = useState(true);
  const [savingInvoice, setSavingInvoice] = useState<string | null>(null);
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("All Months");
  const [selectedClaimStatus, setSelectedClaimStatus] = useState("All Claim Statuses");

  const upsertClaim = async (invoice: string, patch: Partial<ClaimRow>) => {
    const normalizedInvoice = normalizeInvoice(invoice);
    if (!normalizedInvoice) return;

    const payload = {
      invoice: normalizedInvoice,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("wm_invoice_claims")
      .upsert(payload, { onConflict: "invoice" });

    if (error) throw error;
  };

  const load = async () => {
    setLoading(true);

    let wmData: WMRow[] = [];
    let ksolveData: KsolveRow[] = [];
    let claimData: ClaimRow[] = [];

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

    try {
      claimData = await fetchAllClaimRows();
    } catch (error) {
      console.error("Failed to load WM invoice claims:", error);
    }

    const claimByInvoice = new Map<string, ClaimRow>();
    for (const claim of claimData) {
      const invoice = normalizeInvoice(claim.invoice);
      if (invoice) claimByInvoice.set(invoice, claim);
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
      const claim = claimByInvoice.get(invoice);

      const wmAmount = wm?.wmAmount ?? 0;
      const ksolveAmount = ks?.ksolveAmount ?? 0;
      const discrepancy = ksolveAmount - wmAmount;
      const percentage = wmAmount !== 0 ? (discrepancy / wmAmount) * 100 : 0;

      const checkDate = wm?.checkDate || ks?.checkDate || "";
      const invoiceDate = wm?.invoiceDate || "";
      const discountTerms = getDiscountTermsStatus(checkDate, invoiceDate);
      const daysToPay = getDaysToPay(checkDate, invoiceDate);
      const defaultClaimStatus = getDefaultClaimStatus(discountTerms, discrepancy);
      const claimStatus = normalizeClaimStatus(claim?.claim_status, defaultClaimStatus);
      const defaultClaimAmount = defaultClaimStatus === "Needs Review" ? Math.abs(discrepancy) : 0;
      const claimAmount = Number(claim?.claim_amount ?? defaultClaimAmount ?? 0);
      const recoveredAmount = claimStatus === "Recovered" ? claimAmount : Number(claim?.recovered_amount ?? 0);

      return {
        month: wm?.month || ks?.month || "",
        invoiceDate,
        checkDate,
        checkNo: ks?.checkNo || "",
        invoice,
        type: wm?.type || "WM Invoice",
        ksolveAmount,
        wmAmount,
        discrepancy,
        percentage,
        discountTerms,
        daysToPay,
        claimStatus,
        claimAmount,
        recoveredAmount,
        openBalance: Math.max(claimAmount - recoveredAmount, 0),
        claimDate: formatDisplayDate(claim?.claim_date),
        resolvedDate: formatDisplayDate(claim?.resolved_date),
        claimRef: claim?.claim_ref || "",
        notes: claim?.notes || "",
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

  useEffect(() => {
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

      const claimStatusMatch =
        selectedClaimStatus === "All Claim Statuses" || row.claimStatus === selectedClaimStatus;

      if (!monthMatch || !claimStatusMatch) return false;
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
        row.claimStatus,
        row.claimDate,
        row.resolvedDate,
        row.claimRef,
        row.notes,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [rows, search, selectedMonth, selectedClaimStatus]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.ksolveAmount += row.ksolveAmount;
        acc.wmAmount += row.wmAmount;
        acc.discrepancy += row.discrepancy;

        if (row.claimStatus !== "No Action") acc.claimable += row.claimAmount;
        if (["Submitted", "Follow Up"].includes(row.claimStatus)) acc.submitted += row.claimAmount;
        if (row.claimStatus === "Rejected") acc.rejected += row.claimAmount;
        acc.recovered += row.recoveredAmount;
        if (["Needs Review", "Submitted", "Follow Up"].includes(row.claimStatus)) acc.openBalance += row.openBalance;

        return acc;
      },
      {
        ksolveAmount: 0,
        wmAmount: 0,
        discrepancy: 0,
        claimable: 0,
        submitted: 0,
        recovered: 0,
        rejected: 0,
        openBalance: 0,
      },
    );
  }, [filteredRows]);

  const setRowClaimValues = (invoice: string, patch: Partial<DiscrepancyRow>) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.invoice !== invoice) return row;
        const updated = { ...row, ...patch };
        const claimAmount = patch.claimAmount ?? updated.claimAmount;
        const recoveredAmount = patch.recoveredAmount ?? updated.recoveredAmount;
        updated.openBalance = Math.max(Number(claimAmount || 0) - Number(recoveredAmount || 0), 0);
        return updated;
      }),
    );
  };

  const updateClaimStatus = async (invoice: string, claimStatus: ClaimStatus) => {
    const current = rows.find((row) => row.invoice === invoice);
    if (!current) return;

    const claimAmount = claimStatus === "No Action" ? 0 : current.claimAmount || Math.abs(current.discrepancy);
    const recoveredAmount =
      claimStatus === "Recovered"
        ? claimAmount
        : 0;

    const patch: Partial<ClaimRow> = {
      claim_status: claimStatus,
      claim_amount: claimAmount,
      recovered_amount: recoveredAmount,
      claim_ref: current.claimRef || null,
      notes: current.notes || null,
      ...(claimStatus !== "Recovered" ? { resolved_date: null } : {}),
    };

    const rowPatch: Partial<DiscrepancyRow> = { claimStatus, claimAmount, recoveredAmount };

    if ((claimStatus === "Submitted" || claimStatus === "Follow Up") && !current.claimDate) {
      patch.claim_date = todayIsoDate();
      rowPatch.claimDate = formatDisplayDate(patch.claim_date);
    }

    if (claimStatus === "Recovered" && !current.resolvedDate) {
      patch.resolved_date = todayIsoDate();
      rowPatch.resolvedDate = formatDisplayDate(patch.resolved_date);
      if (!current.claimDate) {
        patch.claim_date = todayIsoDate();
        rowPatch.claimDate = formatDisplayDate(patch.claim_date);
      }
    }

    try {
      setSavingInvoice(invoice);
      await upsertClaim(invoice, patch);
      setRowClaimValues(invoice, rowPatch);
    } catch (error: any) {
      alert(error?.message || "Failed to save claim status.");
    } finally {
      setSavingInvoice(null);
    }
  };

  const updateNotes = async (invoice: string, notes: string) => {
    const current = rows.find((row) => row.invoice === invoice);
    if (!current) return;

    try {
      setSavingInvoice(invoice);
      await upsertClaim(invoice, {
        claim_status: current.claimStatus,
        claim_amount: current.claimAmount,
        recovered_amount: current.recoveredAmount,
        claim_ref: current.claimRef || null,
        notes: notes || null,
      });
      setRowClaimValues(invoice, { notes });
    } catch (error: any) {
      alert(error?.message || "Failed to save notes.");
    } finally {
      setSavingInvoice(null);
    }
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
      "Claim Status": row.claimStatus,
      "Claim Amount": row.claimAmount,
      "Recovered Amount": row.recoveredAmount,
      "Open Balance": row.openBalance,
      "Claim Date": row.claimDate,
      "Claim Ref #": row.claimRef,
      Notes: row.notes,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "WM Invoice Claims");
    XLSX.writeFile(workbook, "wm-invoice-claims.xlsx");
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-[116px] z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[repeat(8,minmax(0,1fr))_80px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Ksolve Amount</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatMoney(totals.ksolveAmount)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">WM Amount</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatMoney(totals.wmAmount)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Total Discrepancy</div>
            <div
              className={`mt-1 text-lg font-semibold ${
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

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs text-amber-700">Total Claimable</div>
            <div className="mt-1 text-lg font-semibold text-amber-800">
              {formatMoney(totals.claimable)}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs text-blue-700">Submitted Claims</div>
            <div className="mt-1 text-lg font-semibold text-blue-800">
              {formatMoney(totals.submitted)}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs text-emerald-700">Recovered</div>
            <div className="mt-1 text-lg font-semibold text-emerald-800">
              {formatMoney(totals.recovered)}
            </div>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="text-xs text-red-700">Rejected</div>
            <div className="mt-1 text-lg font-semibold text-red-700">
              {formatMoney(totals.rejected)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Open Balance</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatMoney(totals.openBalance)}
            </div>
          </div>

          <button
            type="button"
            onClick={exportToExcel}
            disabled={filteredRows.length === 0}
            className="flex min-h-[72px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Export to Excel"
            aria-label="Export to Excel"
          >
            <FileSpreadsheet className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1.8fr_220px_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search month, invoice date, check date, check #, invoice, type, claim status..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-slate-300"
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
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month === "All Months" ? month : formatMonthShort(month)}
              </option>
            ))}
          </select>

          <select
            value={selectedClaimStatus}
            onChange={(e) => setSelectedClaimStatus(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="All Claim Statuses">All Claim Statuses</option>
            {CLAIM_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
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
            <table className="w-full min-w-[1750px] text-sm">
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
                    "Claim Status",
                    "Notes",
                  ].map((header) => (
                    <th
                      key={header}
                      className={`whitespace-nowrap px-4 py-3 font-semibold text-slate-700 ${
                        ["# of Days", "Ksolve Amount", "WM Amount", "Discrepancy", "Percentage"].includes(header)
                          ? "text-right"
                          : ["2% 10 / NET 30", "Claim Status"].includes(header)
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
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatMonthShort(row.month)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {row.checkDate || "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {row.checkNo || "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {row.invoiceDate || "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {row.invoice}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
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
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-700">
                      {row.daysToPay ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {row.type}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                      {formatMoney(row.ksolveAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                      {formatMoney(row.wmAmount)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
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
                      className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
                        row.discrepancy === 0
                          ? "text-slate-900"
                          : row.discrepancy > 0
                            ? "text-emerald-700"
                            : "text-red-600"
                      }`}
                    >
                      {formatPercent(row.percentage)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <select
                        value={row.claimStatus}
                        onChange={(e) => updateClaimStatus(row.invoice, e.target.value as ClaimStatus)}
                        disabled={savingInvoice === row.invoice}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold outline-none disabled:opacity-60 ${claimClass(row.claimStatus)}`}
                      >
                        {CLAIM_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="min-w-[260px] px-4 py-3">
                      <input
                        value={row.notes}
                        onChange={(e) => setRowClaimValues(row.invoice, { notes: e.target.value })}
                        onBlur={(e) => updateNotes(row.invoice, e.target.value)}
                        disabled={savingInvoice === row.invoice}
                        placeholder="Add notes..."
                        className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-slate-300 disabled:opacity-60"
                      />
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
