"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

type Retailer = "all" | "kehe" | "target" | "unfi";
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

type MonthOption = {
  key: string;
  label: string;
  sortValue: number;
};

const PAGE_SIZE = 1000;

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

  return "Monthly Summary Total";
}

function getAccountingFirstColumnLabel(retailer: Retailer) {
  return retailer === "target" ? "Reason Code Description" : "Type";
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
  const [invoiceRows, setInvoiceRows] = useState<InvoiceSummaryRow[]>([]);
  const [targetRows, setTargetRows] = useState<TargetInvoiceRow[]>([]);
  const [brokerRows, setBrokerRows] = useState<BrokerCommissionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("accounting");
  const [retailer, setRetailer] = useState<Retailer>("all");

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
  ];

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      try {
        const [rawInvoiceRes, rawBrokerRows, ksolveWmRows, rawTargetRes] =
          await Promise.all([
            supabase
              .from("invoices")
              .select("id, check_date, invoice_amt, type")
              .order("check_date", { ascending: false }),

            fetchAllBrokerCommissionRows(),

            fetchAllKsolveInvoiceRows(),

            supabase
              .from("target_invoices")
              .select(
                "id, month, check_date, check_number, doc_header_text, reason_code_description, sap_doc_number, doc_date, gross_amount, cash_discount, withholding_tax_amount, net_amount"
              )
              .order("check_date", { ascending: false }),
          ]);

        if (rawInvoiceRes.error) {
          console.error("Invoice query error:", rawInvoiceRes.error);
        } else {
          setInvoiceRows(
            ((rawInvoiceRes.data || []) as InvoiceSummaryRow[])
              .filter((row) => parseUsDate(row.check_date))
              .map((row) => ({
                ...row,
                retailer: "kehe",
              }))
          );
        }

        if (rawTargetRes.error) {
          console.error("Target invoice query error:", rawTargetRes.error);
        } else {
          setTargetRows(
            ((rawTargetRes.data || []) as TargetInvoiceRow[]).map((row) => ({
              ...row,
              retailer: "target",
            }))
          );
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

        const withMonthKey: BrokerCommissionRow[] = adjusted.map((row) => ({
          ...row,
          retailer: row.retailer ?? "kehe",
          derivedMonthKey: deriveBrokerMonthKey(row),
        }));

        setBrokerRows(withMonthKey);
      } catch (error) {
        console.error("Summary load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const filteredInvoiceRows = useMemo(() => {
    if (retailer === "all") return invoiceRows;

    return invoiceRows.filter((row) => row.retailer === retailer);
  }, [invoiceRows, retailer]);

  const filteredTargetRows = useMemo(() => {
    if (retailer === "all") return targetRows;

    return targetRows.filter((row) => row.retailer === retailer);
  }, [targetRows, retailer]);

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

    return Array.from(map.values()).sort((a, b) => b.sortValue - a.sortValue);
  }, [filteredInvoiceRows, filteredTargetRows]);

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

    if (retailer === "all" || retailer === "kehe") {
      for (const row of filteredInvoiceRows) {
        const date = parseUsDate(row.check_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        if (!monthKeySet.has(monthKey)) continue;

        const typeName = row.type?.trim() || "Unknown";
        const amount = Number(row.invoice_amt || 0);

        if (!typeMonthTotals.has(typeName)) typeMonthTotals.set(typeName, {});

        const current = typeMonthTotals.get(typeName)!;
        current[monthKey] = (current[monthKey] || 0) + amount;
      }
    }

    if (retailer === "all" || retailer === "target") {
      for (const row of filteredTargetRows) {
        const date = parseUsDate(row.check_date);

        if (!date) continue;

        const monthKey = monthKeyFromDate(date);

        if (!monthKeySet.has(monthKey)) continue;

        const typeName = row.reason_code_description?.trim() || "Unknown";
        const amount = Number(row.net_amount || 0);

        if (!typeMonthTotals.has(typeName)) typeMonthTotals.set(typeName, {});

        const current = typeMonthTotals.get(typeName)!;
        current[monthKey] = (current[monthKey] || 0) + amount;
      }
    }

    const orderedTypes =
      retailer === "target"
        ? Array.from(typeMonthTotals.keys()).sort((a, b) => a.localeCompare(b))
        : sortTypesWithWMFirst(Array.from(typeMonthTotals.keys()));

    const typeRows = orderedTypes.map((typeName) => {
      const monthlyValues = typeMonthTotals.get(typeName) || {};

      const total = monthKeys.reduce(
        (sum, key) => sum + (monthlyValues[key] || 0),
        0
      );

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

    return {
      monthKeys,
      typeRows,
      monthlyTotals,
      grandTotal: Object.values(monthlyTotals).reduce(
        (sum, val) => sum + val,
        0
      ),
    };
  }, [filteredInvoiceRows, filteredTargetRows, filteredMonthOptions, retailer]);

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
                      {getAccountingFirstColumnLabel(retailer)}
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
                  {summary.typeRows.map((row) => (
                    <tr key={row.typeName} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.typeName}
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
                  ))}

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
        ) : retailer === "target" || retailer === "unfi" ? (
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
