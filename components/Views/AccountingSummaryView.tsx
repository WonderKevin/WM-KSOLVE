"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { readBrowserCache, writeBrowserCache } from "@/lib/browser-cache";

type Retailer = "all" | "kehe" | "target" | "unfi" | "hyvee" | "wegmans" | "tony";
type ViewMode = "accounting" | "discrepancy";

type InvoiceSummaryRow = {
  id: number;
  check_date: string | null;
  invoice_amt: number | null;
  type: string | null;
  retailer?: Retailer;
};

type TargetInvoiceRow = {
  id: number;
  month: string | null;
  type: string | null;
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
  retailer?: Retailer;
};

type WegmansInvoiceRow = {
  id: number;
  month: string | null;
  run_date: string | null;
  invoice: string | null;
  description: string | null;
  inv_number: string | null;
  chargeback: number | null;
  type: string | null;
  retailer?: Retailer;
};

type HyveeInvoiceRow = {
  id: number;
  month: string | null;
  type: string | null;
  check_number: string | null;
  check_date: string | null;
  check_amount: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  net_amount: number | null;
  retailer?: Retailer;
};

type TonyInvoiceDetailRow = {
  id: number;
  wire_id: number;
  invoice_number: string | null;
  po_number: string | null;
  invoice_amount: number | null;
  discount_amount: number | null;
  amount_paid: number | null;
  type: string | null;
  line_number: number | null;
  type_splits?: TonyInvoiceTypeSplitRow[];
};

type TonyInvoiceTypeSplitRow = {
  id: number;
  detail_id: number;
  type: string | null;
  amount: number | null;
};

type TonyInvoiceWireRow = {
  id: number;
  month: string | null;
  wired_on: string | null;
  ach_number: string | null;
  total_wire: number | null;
  details?: TonyInvoiceDetailRow[];
  retailer?: Retailer;
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
  retailer?: Retailer;
};

type BrokerCommissionRow = BrokerCommissionDbRow & {
  adjustedAmt: number;
  derivedMonthKey: string;
};

type SourceRetailer = Exclude<Retailer, "all">;

type SummaryRetailerRow = {
  retailer: SourceRetailer;
  label: string;
  monthlyValues: Record<string, number>;
  total: number;
};

type SummaryTypeRow = {
  typeName: string;
  monthlyValues: Record<string, number>;
  total: number;
  retailerRows: SummaryRetailerRow[];
};

type MonthOption = {
  key: string;
  label: string;
  sortValue: number;
};

const PAGE_SIZE = 1000;
const ACCOUNTING_SUMMARY_CACHE_KEY = "wmksolve:report-cache:accounting-summary";
const WEGMANS_EDLC_TYPE = "Wegmans' EDLC Allowance";
const STANDARD_ACCOUNTING_TYPES = [
  "WM Invoice",
  "EDLC Allowances",
  "Ad Fees",
  "Distribution (MCB) Allowances",
  "Customer Spoils Allowance",
  "Introduction Allowances",
  "TPR Funding",
  "Scan Allowance",
  "Promo & Placement Funds",
  "Slotting Fees",
  "Display Fees",
  "New Item Setup Fee",
] as const;

const RETAILER_POSSESSIVE_LABELS: Record<SourceRetailer, string> = {
  kehe: "KeHE's",
  target: "Target's",
  unfi: "UNFI's",
  hyvee: "Hy-Vee",
  wegmans: "Wegmans'",
  tony: "Tony's",
};

const RETAILER_SORT_ORDER: SourceRetailer[] = [
  "kehe",
  "target",
  "unfi",
  "hyvee",
  "wegmans",
  "tony",
];

type AccountingSummaryCache = {
  invoiceRows: InvoiceSummaryRow[];
  targetRows: TargetInvoiceRow[];
  hyveeRows: HyveeInvoiceRow[];
  wegmansRows: WegmansInvoiceRow[];
  tonyRows: TonyInvoiceWireRow[];
  brokerRows: BrokerCommissionRow[];
};

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

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function monthLabelFromDate(date: Date) {
  return date.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatMonthFromDate(value: string | null | undefined) {
  if (!value) return "";

  const parsed = parseUsDate(value) || new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function normalizeMonthLabel(value: string) {
  const trimmed = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) return "";

  const match = trimmed.match(/^([A-Za-z]+)\s*'?(\d{2}|\d{4})$/);
  if (!match) return trimmed;

  const year = match[2].length === 2 ? `20${match[2]}` : match[2];

  return `${match[1]} ${year}`;
}

function monthLabelToKey(label: string) {
  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  const normalized = normalizeMonthLabel(label);
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);

  if (!match) return null;

  const mm = monthMap[match[1].toLowerCase()];
  if (!mm) return null;

  return `${match[2]}-${mm}`;
}

function deriveBrokerMonthKey(row: BrokerCommissionDbRow) {
  const rawMonth = String(row.month ?? "").trim();
  const rawCheckDate = String(row.check_date ?? "").trim();

  const monthKeyFromRawMonth = monthLabelToKey(rawMonth);
  if (monthKeyFromRawMonth) return monthKeyFromRawMonth;

  const monthLabelFromCheckDate = formatMonthFromDate(rawCheckDate);
  const monthKeyFromCheckDate = monthLabelToKey(monthLabelFromCheckDate);
  if (monthKeyFromCheckDate) return monthKeyFromCheckDate;

  return "";
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
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getStandardAccountingType(value: string | null | undefined) {
  const cleaned = normalizeType(value).replace(/\u00a0/g, " ");
  const compact = cleaned.replace(/[^a-z0-9$]/g, "");

  if (!compact) return "";

  if (compact.includes("wminvoice")) return "WM Invoice";

  if (
    compact.includes("wegmanschargeback") ||
    compact.includes("wegmanchargeback")
  ) {
    return "EDLC Allowances";
  }

  if (
    compact.includes("promoandplacement") ||
    compact.includes("promoplacement") ||
    compact.includes("ppf")
  ) {
    return "Promo & Placement Funds";
  }

  if (compact.includes("newitemsetup")) return "New Item Setup Fee";
  if (compact.includes("customerspoil")) return "Customer Spoils Allowance";
  if (compact.includes("intro")) return "Introduction Allowances";
  if (compact.includes("edlc")) return "EDLC Allowances";
  if (compact.includes("scanfunding") || compact.includes("scanallowance")) return "Scan Allowance";
  if (compact.includes("slotting") || compact.includes("slotfee")) return "Slotting Fees";
  if (compact.includes("display")) return "Display Fees";
  if (compact.includes("adfee") || compact.includes("advertising")) return "Ad Fees";
  if (
    compact.includes("mcb") ||
    compact.includes("distribution") ||
    compact.includes("distributor") ||
    compact.includes("passthrudeduction") ||
    compact.includes("passthroughdeduction")
  ) {
    return "Distribution (MCB) Allowances";
  }
  if (
    compact.includes("tpr") ||
    compact.includes("$1promotion") ||
    compact.includes("1promotion") ||
    compact.includes("onedollarpromotion")
  ) {
    return "TPR Funding";
  }

  return "";
}

function getRetailerTypeLabel(retailer: SourceRetailer, typeName: string) {
  if (retailer === "wegmans" && typeName === "EDLC Allowances") {
    return WEGMANS_EDLC_TYPE;
  }

  if (retailer === "hyvee") {
    return `Hy-Vee ${typeName}`;
  }

  return `${RETAILER_POSSESSIVE_LABELS[retailer]} ${typeName}`;
}

function normalizeDiscrepancyType(value: string | null | undefined) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const compact = cleaned.replace(/[^a-z0-9$]/g, "");

  if (compact === "wminvoice") return "wm invoice";

  if (
    compact === "$1promotion" ||
    compact === "1promotion" ||
    compact.includes("$1promotion") ||
    compact.includes("1promotion")
  ) {
    return "$1 promotion";
  }

  if (compact.includes("customerspoilsallowance")) {
    return "customer spoils allowance";
  }

  if (compact.includes("passthrudeduction")) {
    return "pass thru deduction";
  }

  if (compact.includes("promoandplacementfund")) {
    return "promo and placement fund";
  }

  if (compact.includes("introductionallowance")) {
    return "introduction allowance";
  }

  if (compact.includes("newitemsetupfee")) {
    return "new item setup fee";
  }

  return cleaned;
}

function displayDiscrepancyType(value: string) {
  if (value === "wm invoice") return "WM Invoice";
  if (value === "$1 promotion") return "$1 Promotion";
  if (value === "customer spoils allowance") return "Customer Spoils Allowance";
  if (value === "pass thru deduction") return "Pass Thru Deduction";
  if (value === "promo and placement fund") return "Promo and Placement Fund";
  if (value === "introduction allowance") return "Introduction Allowance";
  if (value === "new item setup fee") return "New Item Setup Fee";

  return value
    .split(" ")
    .map((word) =>
      word.length > 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word
    )
    .join(" ");
}

function sortTypesWithWMFirst(types: string[]) {
  return [...types].sort((a, b) => {
    if (a === "WM Invoice" || a === "wm invoice") return -1;
    if (b === "WM Invoice" || b === "wm invoice") return 1;

    return a.localeCompare(b);
  });
}

function getRetailerMonthlyTotalLabel(retailer: Retailer) {
  if (retailer === "all") return "Monthly Summary Total";
  if (retailer === "kehe") return "KeHE Monthly Summary Total";
  if (retailer === "target") return "Target Monthly Summary Total";
  if (retailer === "unfi") return "UNFI Monthly Summary Total";
  if (retailer === "hyvee") return "Hy-Vee Monthly Summary Total";
  if (retailer === "wegmans") return "Wegmans Monthly Summary Total";
  if (retailer === "tony") return "Tony's Monthly Summary Total";

  return "Monthly Summary Total";
}

function getAccountingFirstColumnLabel() {
  return "Type";
}

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
    const invoiceDiscrepancy = round2(
      discrepancyByInvoice.get(invoiceKey) ?? 0
    );

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
          share = round2(
            invoiceDiscrepancy * (Number(row.amt ?? 0) / totalWmAmount)
          );

          runningShare = round2(runningShare + share);
        }

        adjustedAmt = round2(Number(row.amt ?? 0) + share);
      }

      result.push({
        ...row,
        adjustedAmt,
      });
    }
  }

  return result;
}

async function fetchAllBrokerCommissionRows(): Promise<BrokerCommissionDbRow[]> {
  let allRows: BrokerCommissionDbRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("broker_commission_datasets")
      .select("id, month, check_date, invoice, type, upc, item, cust_name, amt")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as BrokerCommissionDbRow[];

    allRows = allRows.concat(
      batch.map((row) => ({
        ...row,
        retailer: "kehe" as Retailer,
      }))
    );

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

export default function AccountingSummaryView() {
  const [startupCache] = useState<AccountingSummaryCache | null>(() =>
    readBrowserCache<AccountingSummaryCache>(ACCOUNTING_SUMMARY_CACHE_KEY)
  );
  const [invoiceRows, setInvoiceRows] = useState<InvoiceSummaryRow[]>(
    () => startupCache?.invoiceRows || []
  );
  const [targetRows, setTargetRows] = useState<TargetInvoiceRow[]>(
    () => startupCache?.targetRows || []
  );
  const [hyveeRows, setHyveeRows] = useState<HyveeInvoiceRow[]>(
    () => startupCache?.hyveeRows || []
  );
  const [wegmansRows, setWegmansRows] = useState<WegmansInvoiceRow[]>(
    () => startupCache?.wegmansRows || []
  );
  const [tonyRows, setTonyRows] = useState<TonyInvoiceWireRow[]>(
    () => startupCache?.tonyRows || []
  );
  const [brokerRows, setBrokerRows] = useState<BrokerCommissionRow[]>(
    () => startupCache?.brokerRows || []
  );
  const [loading, setLoading] = useState(() => !startupCache);

  const [viewMode, setViewMode] = useState<ViewMode>("accounting");
  const [retailer, setRetailer] = useState<Retailer>("all");
  const [expandedSummaryTypes, setExpandedSummaryTypes] = useState<Set<string>>(
    () => new Set()
  );

  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [appliedFromMonth, setAppliedFromMonth] = useState("");
  const [appliedToMonth, setAppliedToMonth] = useState("");

  const [discrepancyMonth, setDiscrepancyMonth] = useState("");
  const [appliedDiscrepancyMonth, setAppliedDiscrepancyMonth] = useState("");

  const retailerOptions: Array<{ value: Retailer; label: string }> = [
    { value: "all", label: "All" },
    { value: "kehe", label: "KeHE" },
    { value: "target", label: "Target" },
    { value: "unfi", label: "UNFI" },
    { value: "hyvee", label: "Hy-Vee" },
    { value: "wegmans", label: "Wegmans" },
    { value: "tony", label: "Tony's" },
  ];

  useEffect(() => {
    const loadData = async (hasCachedData = false) => {
      if (!hasCachedData) setLoading(true);

      try {
        const [
          rawInvoiceRes,
          rawBrokerRows,
          ksolveWmRows,
          rawTargetRes,
          rawHyveeRes,
          rawWegmansRes,
          rawTonyRes,
        ] =
          await Promise.all([
            supabase
              .from("invoices")
              .select("id, check_date, invoice_amt, type")
              .order("check_date", { ascending: false }),

            fetchAllBrokerCommissionRows(),

            fetchAllKsolveInvoiceRows(),

            supabase
              .from("target_invoices")
              .select("*")
              .order("check_date", { ascending: false }),

            supabase
              .from("hyvee_invoices")
              .select(
                "id, month, type, check_number, check_date, check_amount, invoice_number, invoice_date, net_amount"
              )
              .order("check_date", { ascending: false }),

            supabase
              .from("wegmans_invoices")
              .select(
                "id, month, run_date, invoice, description, inv_number, chargeback, type"
              )
              .order("run_date", { ascending: false }),

            supabase
              .from("tony_invoice_wires")
              .select(
                "id, month, wired_on, ach_number, total_wire, details:tony_invoice_details(id, wire_id, invoice_number, po_number, invoice_amount, discount_amount, amount_paid, type, line_number, type_splits:tony_invoice_detail_type_splits(id, detail_id, type, amount))"
              )
              .order("wired_on", { ascending: false }),
          ]);

        let nextInvoiceRows: InvoiceSummaryRow[] = [];
        let nextTargetRows: TargetInvoiceRow[] = [];
        let nextHyveeRows: HyveeInvoiceRow[] = [];
        let nextWegmansRows: WegmansInvoiceRow[] = [];
        let nextTonyRows: TonyInvoiceWireRow[] = [];
        let nextBrokerRows: BrokerCommissionRow[] = [];

        if (rawInvoiceRes.error) {
          console.error("Invoice query error:", rawInvoiceRes.error);
        } else {
          nextInvoiceRows = ((rawInvoiceRes.data || []) as InvoiceSummaryRow[])
            .filter((row) => parseUsDate(row.check_date))
            .map((row) => ({
              ...row,
              retailer: "kehe",
            }));
          setInvoiceRows(nextInvoiceRows);
        }

        if (rawTargetRes.error) {
          console.error("Target invoice query error:", rawTargetRes.error);
        } else {
          nextTargetRows = ((rawTargetRes.data || []) as TargetInvoiceRow[]).map(
            (row) => ({
              ...row,
              retailer: "target",
            })
          );
          setTargetRows(nextTargetRows);
        }

        if (rawHyveeRes.error) {
          console.error("Hy-Vee invoice query error:", rawHyveeRes.error);
          setHyveeRows([]);
        } else {
          nextHyveeRows = ((rawHyveeRes.data || []) as HyveeInvoiceRow[]).map(
            (row) => ({
              ...row,
              retailer: "hyvee",
            })
          );
          setHyveeRows(nextHyveeRows);
        }

        if (rawWegmansRes.error) {
          console.error("Wegmans invoice query error:", rawWegmansRes.error);
          setWegmansRows([]);
        } else {
          nextWegmansRows = ((rawWegmansRes.data || []) as WegmansInvoiceRow[]).map(
            (row) => ({
              ...row,
              retailer: "wegmans",
            })
          );
          setWegmansRows(nextWegmansRows);
        }

        if (rawTonyRes.error) {
          console.error("Tony invoice query error:", rawTonyRes.error);
          setTonyRows([]);
        } else {
          nextTonyRows = ((rawTonyRes.data || []) as TonyInvoiceWireRow[]).map(
            (row) => ({
              ...row,
              details: [...(row.details || [])].sort(
                (a, b) => Number(a.line_number || 0) - Number(b.line_number || 0)
              ).map((detail) => ({
                ...detail,
                type_splits: [...(detail.type_splits || [])].sort(
                  (a, b) => Number(a.id || 0) - Number(b.id || 0)
                ),
              })),
              retailer: "tony",
            })
          );
          setTonyRows(nextTonyRows);
        }

        const ksolveByInvoice = new Map<string, number>();

        for (const row of ksolveWmRows) {
          const inv = normalizeInvoice(row.invoice_number ?? "");

          if (!inv) continue;

          ksolveByInvoice.set(
            inv,
            round2(
              (ksolveByInvoice.get(inv) ?? 0) + Number(row.invoice_amt ?? 0)
            )
          );
        }

        const wmByInvoice = new Map<string, number>();

        for (const row of rawBrokerRows) {
          const inv = normalizeInvoice(row.invoice ?? "");

          if (!inv || !isWmInvoiceType(row.type ?? "")) continue;

          wmByInvoice.set(
            inv,
            round2((wmByInvoice.get(inv) ?? 0) + Number(row.amt ?? 0))
          );
        }

        const discrepancyByInvoice = new Map<string, number>();

        for (const inv of new Set([
          ...ksolveByInvoice.keys(),
          ...wmByInvoice.keys(),
        ])) {
          discrepancyByInvoice.set(
            inv,
            round2((ksolveByInvoice.get(inv) ?? 0) - (wmByInvoice.get(inv) ?? 0))
          );
        }

        const adjusted = applyAmountBasedDiscrepancy(
          rawBrokerRows,
          discrepancyByInvoice
        );

        nextBrokerRows = adjusted.map((row) => ({
          ...row,
          retailer: row.retailer ?? "kehe",
          derivedMonthKey: deriveBrokerMonthKey(row),
        }));

        setBrokerRows(nextBrokerRows);
        writeBrowserCache<AccountingSummaryCache>(ACCOUNTING_SUMMARY_CACHE_KEY, {
          invoiceRows: nextInvoiceRows,
          targetRows: nextTargetRows,
          hyveeRows: nextHyveeRows,
          wegmansRows: nextWegmansRows,
          tonyRows: nextTonyRows,
          brokerRows: nextBrokerRows,
        });
      } catch (error) {
        console.error("Summary load error:", error);
      } finally {
        setLoading(false);
      }
    };

    const refreshTimer = window.setTimeout(() => {
      void loadData(Boolean(startupCache));
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [startupCache]);

  const filteredInvoiceRows = useMemo(() => {
    if (retailer === "all") return invoiceRows;

    return invoiceRows.filter((row) => row.retailer === retailer);
  }, [invoiceRows, retailer]);

  const filteredTargetRows = useMemo(() => {
    if (retailer === "all") return targetRows;

    return targetRows.filter((row) => row.retailer === retailer);
  }, [targetRows, retailer]);

  const filteredHyveeRows = useMemo(() => {
    if (retailer === "all") return hyveeRows;

    return hyveeRows.filter((row) => row.retailer === retailer);
  }, [hyveeRows, retailer]);

  const filteredWegmansRows = useMemo(() => {
    if (retailer === "all") return wegmansRows;

    return wegmansRows.filter((row) => row.retailer === retailer);
  }, [wegmansRows, retailer]);

  const filteredTonyRows = useMemo(() => {
    if (retailer === "all") return tonyRows;

    return tonyRows.filter((row) => row.retailer === retailer);
  }, [tonyRows, retailer]);

  const filteredBrokerRows = useMemo(() => {
    if (retailer === "all") return brokerRows;

    return brokerRows.filter((row) => row.retailer === retailer);
  }, [brokerRows, retailer]);

  const accountingMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();

    for (const row of filteredInvoiceRows) {
      const date = parseUsDate(row.check_date);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    for (const row of filteredTargetRows) {
      const date = parseUsDate(row.check_date);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    for (const row of filteredHyveeRows) {
      const date = parseUsDate(row.check_date);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    for (const row of filteredWegmansRows) {
      const date = parseUsDate(row.run_date);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    for (const row of filteredTonyRows) {
      const date = parseUsDate(row.wired_on);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [
    filteredInvoiceRows,
    filteredTargetRows,
    filteredHyveeRows,
    filteredWegmansRows,
    filteredTonyRows,
  ]);

  const discrepancyMonthOptions = useMemo<MonthOption[]>(() => {
    const map = new Map<string, MonthOption>();

    for (const row of filteredInvoiceRows) {
      const date = parseUsDate(row.check_date);

      if (!date) continue;

      const key = monthKeyFromDate(date);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: monthLabelFromDate(date),
          sortValue: date.getFullYear() * 100 + date.getMonth() + 1,
        });
      }
    }

    for (const row of filteredBrokerRows) {
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
  }, [filteredInvoiceRows, filteredBrokerRows]);

  useEffect(() => {
    if (accountingMonthOptions.length > 0) {
      const currentFromStillExists = accountingMonthOptions.some(
        (m) => m.key === appliedFromMonth
      );

      const currentToStillExists = accountingMonthOptions.some(
        (m) => m.key === appliedToMonth
      );

      if (
        !appliedFromMonth ||
        !appliedToMonth ||
        !currentFromStillExists ||
        !currentToStillExists
      ) {
        const sortedAsc = [...accountingMonthOptions.slice(0, 6)].sort(
          (a, b) => a.sortValue - b.sortValue
        );

        setFromMonth(sortedAsc[0]?.key || "");
        setToMonth(sortedAsc[sortedAsc.length - 1]?.key || "");
        setAppliedFromMonth(sortedAsc[0]?.key || "");
        setAppliedToMonth(sortedAsc[sortedAsc.length - 1]?.key || "");
      }
    } else {
      setFromMonth("");
      setToMonth("");
      setAppliedFromMonth("");
      setAppliedToMonth("");
    }
  }, [accountingMonthOptions, appliedFromMonth, appliedToMonth]);

  useEffect(() => {
    if (discrepancyMonthOptions.length > 0 && !appliedDiscrepancyMonth) {
      const latest = discrepancyMonthOptions[0]?.key || "";

      setDiscrepancyMonth(latest);
      setAppliedDiscrepancyMonth(latest);
    }
  }, [discrepancyMonthOptions, appliedDiscrepancyMonth]);

  useEffect(() => {
    setAppliedDiscrepancyMonth("");
    setDiscrepancyMonth("");
  }, [retailer]);

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
    const retailerTypeMonthTotals = new Map<
      string,
      Map<SourceRetailer, Record<string, number>>
    >();

    const addAmount = (
      rawTypeName: string | null | undefined,
      sourceRetailer: SourceRetailer,
      monthKey: string,
      amount: number
    ) => {
      const typeName = getStandardAccountingType(rawTypeName);

      if (!typeName || !monthKeySet.has(monthKey)) return;

      if (!typeMonthTotals.has(typeName)) typeMonthTotals.set(typeName, {});

      const typeTotals = typeMonthTotals.get(typeName)!;
      typeTotals[monthKey] = (typeTotals[monthKey] || 0) + amount;

      if (!retailerTypeMonthTotals.has(typeName)) {
        retailerTypeMonthTotals.set(typeName, new Map());
      }

      const retailerTotals = retailerTypeMonthTotals.get(typeName)!;

      if (!retailerTotals.has(sourceRetailer)) {
        retailerTotals.set(sourceRetailer, {});
      }

      const monthlyValues = retailerTotals.get(sourceRetailer)!;
      monthlyValues[monthKey] = (monthlyValues[monthKey] || 0) + amount;
    };

    if (retailer === "all" || retailer === "kehe") {
      for (const row of filteredInvoiceRows) {
        const date = parseUsDate(row.check_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        const amount = Number(row.invoice_amt || 0);

        addAmount(row.type, "kehe", monthKey, amount);
      }
    }

    if (retailer === "all" || retailer === "target") {
      for (const row of filteredTargetRows) {
        const date = parseUsDate(row.check_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        const amount = Number(row.net_amount || 0);

        addAmount(row.type || row.reason_code_description, "target", monthKey, amount);
      }
    }

    if (retailer === "all" || retailer === "hyvee") {
      for (const row of filteredHyveeRows) {
        const date = parseUsDate(row.check_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);
        const amount = Number(row.net_amount || 0);

        addAmount(row.type, "hyvee", monthKey, amount);
      }
    }

    if (retailer === "all" || retailer === "wegmans") {
      for (const row of filteredWegmansRows) {
        const date = parseUsDate(row.run_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        const amount = -Math.abs(Number(row.chargeback || 0));

        addAmount(row.type, "wegmans", monthKey, amount);
      }
    }

    if (retailer === "all" || retailer === "tony") {
      for (const row of filteredTonyRows) {
        const date = parseUsDate(row.wired_on);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        if (!monthKeySet.has(monthKey)) continue;

        for (const detail of row.details || []) {
          const allocations = (detail.type_splits || []).length
            ? (detail.type_splits || []).map((split) => ({
                typeName: split.type?.trim() || "Unassigned",
                amount: Number(split.amount || 0),
              }))
            : [
                {
                  typeName: detail.type?.trim() || "Unassigned",
                  amount: Number(detail.amount_paid || 0),
                },
              ];

          for (const allocation of allocations) {
            const amount = allocation.amount;

            addAmount(allocation.typeName, "tony", monthKey, amount);
          }
        }
      }
    }

    const typeRows: SummaryTypeRow[] = STANDARD_ACCOUNTING_TYPES.flatMap((typeName) => {
      const monthlyValues = typeMonthTotals.get(typeName) || {};

      const total = monthKeys.reduce(
        (sum, key) => sum + (monthlyValues[key] || 0),
        0
      );

      if (retailer !== "all" && Math.abs(total) < 0.005) return [];

      const retailerTotals = retailerTypeMonthTotals.get(typeName) || new Map();
      const retailerRows = RETAILER_SORT_ORDER.flatMap((sourceRetailer) => {
        const sourceValues = retailerTotals.get(sourceRetailer) || {};
        const sourceTotal = monthKeys.reduce(
          (sum, key) => sum + (sourceValues[key] || 0),
          0
        );

        if (Math.abs(sourceTotal) < 0.005) return [];

        return [
          {
            retailer: sourceRetailer,
            label: getRetailerTypeLabel(sourceRetailer, typeName),
            monthlyValues: sourceValues,
            total: sourceTotal,
          },
        ];
      });

      return [
        {
          typeName:
            retailer === "all"
              ? typeName
              : getRetailerTypeLabel(retailer as SourceRetailer, typeName),
          monthlyValues,
          total,
          retailerRows,
        },
      ];
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
      grandTotal: Object.values(monthlyTotals).reduce(
        (sum, val) => sum + val,
        0
      ),
    };
  }, [
    filteredInvoiceRows,
    filteredTargetRows,
    filteredHyveeRows,
    filteredWegmansRows,
    filteredTonyRows,
    filteredMonthOptions,
    retailer,
  ]);

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

    const ksolveTypeTotals = new Map<string, number>();
    const brokerTypeTotals = new Map<string, number>();
    const displayTypeMap = new Map<string, string>();

    for (const row of filteredInvoiceRows) {
      const date = parseUsDate(row.check_date);

      if (!date || monthKeyFromDate(date) !== appliedDiscrepancyMonth) {
        continue;
      }

      const rawType = row.type?.trim() || "Unknown";
      const normType = normalizeDiscrepancyType(rawType);

      if (!displayTypeMap.has(normType)) {
        displayTypeMap.set(normType, displayDiscrepancyType(normType));
      }

      ksolveTypeTotals.set(
        normType,
        round2(
          (ksolveTypeTotals.get(normType) || 0) + Number(row.invoice_amt || 0)
        )
      );
    }

    for (const row of filteredBrokerRows) {
      if (row.derivedMonthKey !== appliedDiscrepancyMonth) continue;

      const rawType = String(row.type ?? "").trim() || "Unknown";
      const normType = normalizeDiscrepancyType(rawType);

      if (!displayTypeMap.has(normType)) {
        displayTypeMap.set(normType, displayDiscrepancyType(normType));
      }

      const amount = isWmInvoiceType(row.type ?? "")
        ? Math.abs(row.adjustedAmt)
        : Number(row.amt ?? 0);

      brokerTypeTotals.set(
        normType,
        round2((brokerTypeTotals.get(normType) || 0) + amount)
      );
    }

    const allNormTypes = Array.from(
      new Set([...ksolveTypeTotals.keys(), ...brokerTypeTotals.keys()])
    );

    const orderedNormTypes = sortTypesWithWMFirst(allNormTypes);

    const typeRows = orderedNormTypes.map((normType) => {
      const typeName = displayTypeMap.get(normType) || displayDiscrepancyType(normType);

      const ksolveTotal = ksolveTypeTotals.get(normType) || 0;
      const invoiceTotal = brokerTypeTotals.get(normType) || 0;

      return {
        typeName,
        ksolveTotal,
        invoiceTotal,
        discrepancy: round2(ksolveTotal - invoiceTotal),
      };
    });

    const ksolveGrandTotal = round2(
      typeRows.reduce((sum, row) => sum + row.ksolveTotal, 0)
    );

    const invoiceGrandTotal = round2(
      typeRows.reduce((sum, row) => sum + row.invoiceTotal, 0)
    );

    return {
      selectedMonthLabel: selectedMonthOption?.label || "",
      typeRows,
      ksolveGrandTotal,
      invoiceGrandTotal,
      discrepancyGrandTotal: round2(ksolveGrandTotal - invoiceGrandTotal),
    };
  }, [
    filteredInvoiceRows,
    filteredBrokerRows,
    appliedDiscrepancyMonth,
    discrepancyMonthOptions,
  ]);

  const handleApply = () => {
    if (!fromMonth && !toMonth) return;

    setAppliedFromMonth(fromMonth || toMonth);
    setAppliedToMonth(toMonth || fromMonth);
  };

  const handleApplyDiscrepancyMonth = () => {
    if (!discrepancyMonth) return;

    setAppliedDiscrepancyMonth(discrepancyMonth);
  };

  const toggleSummaryType = (typeName: string) => {
    setExpandedSummaryTypes((prev) => {
      const next = new Set(prev);

      if (next.has(typeName)) {
        next.delete(typeName);
      } else {
        next.add(typeName);
      }

      return next;
    });
  };

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">
                Retailer
              </label>

              <select
                value={retailer}
                onChange={(e) => setRetailer(e.target.value as Retailer)}
                className="min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {retailerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

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
          </div>

          {viewMode === "accounting" ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  From
                </label>

                <select
                  value={fromMonth}
                  onChange={(e) => setFromMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>

                  {[...accountingMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  To
                </label>

                <select
                  value={toMonth}
                  onChange={(e) => setToMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>

                  {[...accountingMonthOptions]
                    .sort((a, b) => a.sortValue - b.sortValue)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
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
                <label className="text-xs font-medium text-slate-500">
                  Month
                </label>

                <select
                  value={discrepancyMonth}
                  onChange={(e) => setDiscrepancyMonth(e.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select month</option>

                  {[...discrepancyMonthOptions]
                    .sort((a, b) => b.sortValue - a.sortValue)
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      {getAccountingFirstColumnLabel()}
                    </th>

                    {filteredMonthOptions.map((m) => (
                      <th
                        key={m.key}
                        className="px-4 py-3 text-right font-semibold text-slate-700"
                      >
                        {m.label}
                      </th>
                    ))}

                    <th className="px-4 py-3 text-right font-semibold text-slate-700">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {summary.typeRows.map((row) => {
                    const canExpand =
                      retailer === "all" && row.retailerRows.length > 0;
                    const isExpanded = expandedSummaryTypes.has(row.typeName);

                    return (
                      <React.Fragment key={row.typeName}>
                        <tr className="border-t border-slate-200">
                          <td className="px-4 py-3 font-medium text-slate-900">
                            <div className="flex items-center gap-2">
                              {retailer === "all" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    canExpand && toggleSummaryType(row.typeName)
                                  }
                                  disabled={!canExpand}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                                    canExpand
                                      ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                                      : "border-transparent text-slate-300"
                                  }`}
                                  aria-label={
                                    isExpanded
                                      ? `Collapse ${row.typeName}`
                                      : `Expand ${row.typeName}`
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              )}

                              <span>{row.typeName}</span>
                            </div>
                          </td>

                          {filteredMonthOptions.map((m) => (
                            <td
                              key={m.key}
                              className="px-4 py-3 text-right text-slate-700"
                            >
                              {formatCurrency(row.monthlyValues[m.key] || 0)}
                            </td>
                          ))}

                          <td className="px-4 py-3 text-right font-semibold text-slate-900">
                            {formatCurrency(row.total)}
                          </td>
                        </tr>

                        {retailer === "all" &&
                          isExpanded &&
                          row.retailerRows.map((retailerRow) => (
                            <tr
                              key={`${row.typeName}-${retailerRow.retailer}`}
                              className="border-t border-slate-100 bg-slate-50/70"
                            >
                              <td className="px-4 py-3 pl-14 text-sm font-medium text-slate-600">
                                {retailerRow.label}
                              </td>

                              {filteredMonthOptions.map((m) => (
                                <td
                                  key={m.key}
                                  className="px-4 py-3 text-right text-sm text-slate-600"
                                >
                                  {formatCurrency(
                                    retailerRow.monthlyValues[m.key] || 0
                                  )}
                                </td>
                              ))}

                              <td className="px-4 py-3 text-right text-sm font-semibold text-slate-700">
                                {formatCurrency(retailerRow.total)}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}

                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {getRetailerMonthlyTotalLabel(retailer)}
                    </td>

                    {filteredMonthOptions.map((m) => (
                      <td
                        key={m.key}
                        className="px-4 py-3 text-right font-semibold text-slate-900"
                      >
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
        ) : retailer === "target" || retailer === "unfi" || retailer === "wegmans" || retailer === "tony" ? (
          <p className="text-sm text-slate-500">
            Summary Discrepancy is currently available for KeHE only.
          </p>
        ) : !appliedDiscrepancyMonth ? (
          <p className="text-sm text-slate-500">No discrepancy month selected.</p>
        ) : discrepancySummary.typeRows.length === 0 ? (
          <p className="text-sm text-slate-500">No discrepancy data found.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Type
                  </th>

                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Ksolve Total
                  </th>

                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Invoice Total
                  </th>

                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Discrepancy
                  </th>
                </tr>
              </thead>

              <tbody>
                {discrepancySummary.typeRows.map((row) => (
                  <tr key={row.typeName} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.typeName}
                    </td>

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
