"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { RotateCw } from "lucide-react";

type RetailerName =
  | "Fresh Thyme"
  | "Kroger"
  | "INFRA & Others"
  | "HEB"
  | "";

type DatasetRow = {
  id: string;
  month: string;
  check_date: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  cust_name: string;
  amt: number;
  adjustedAmt: number;
  retailer?: RetailerName;
};

type DatasetDbRow = {
  id: string;
  month: string | null;
  check_date: string | null;
  invoice: string | null;
  type: string | null;
  upc: string | null;
  item: string | null;
  cust_name: string | null;
  amt: number | null;
};

type InvoiceRow = {
  invoice_number: string | null;
  invoice_amt?: number | null;
  type?: string | null;
};

type VelocityRow = {
  month: string | null;
  description: string | null;
  cases: number | null;
  retailer: string | null;
};

type RetailerOverrideRow = {
  dataset_id: string;
  retailer: string;
};

type LocationRow = {
  customer: string;
  retailer: string;
};

type DetailLine = {
  label: string;
  amount: number;
  kind: "invoice-summary" | "invoice-detail" | "deduction";
  children?: DetailLine[];
};

type RetailerBlock = {
  retailer: RetailerName;
  wmInvoiceTotal: number;
  deductionsTotal: number;
  total: number;
  brokerFee: number;
  details: DetailLine[];
};

type InvoiceAllocationOption = {
  invoice: string;
  krogerAmount: number;
};

type TransferAlert = {
  key: string;
  month: string;
  targetRetailer: Exclude<RetailerName, "">;
  transferAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  firstInvoice: string;
  firstInvoiceAmount: number;
  selectedInvoices: string[];
  invoiceOptions: InvoiceAllocationOption[];
};

type TransferAllocationMap = Record<string, string[]>;

type MonthSummary = {
  month: string;
  retailers: RetailerBlock[];
  transferAlerts: TransferAlert[];
  grandWmInvoiceTotal: number;
  grandDeductionsTotal: number;
  grandNetTotal: number;
  grandBrokerFeeTotal: number;
};

const INFRA_HP_CASE_RATE = 35.68;
const PAGE_SIZE = 1000;
const TRANSFER_ALLOCATIONS_STORAGE_KEY = "broker-commission-transfer-allocations";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatMonthShort(value: string): string {
  if (!value) return value;
  if (/^[A-Za-z]+ '\d{2}$/.test(value.trim())) return value.trim();

  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) return `${m[1]} '${m[2].slice(-2)}`;

  return value;
}

function formatMonthFromDate(value: string): string {
  if (!value) return "";

  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function normalizeMonthLabel(value: string) {
  const trimmed = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) return "";

  const match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return trimmed;

  const monthName = match[1];
  const yearRaw = match[2];
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

  return `${monthName} ${year}`;
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

  const normalized = normalizeMonthLabel(value);
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return -1;

  const monthIndex = monthMap[match[1].toLowerCase()];
  if (monthIndex === undefined) return -1;

  return Number(match[2]) * 100 + monthIndex;
}

function normalizeText(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\*/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

function getFirstTwoWords(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function directRetailerFromCustomer(custName: string): RetailerName {
  const customer = normalizeText(custName);

  if (!customer) return "";

  // Kroger deductions can come through under Kroger-owned banners, not only
  // customer names that literally start with "Kroger". These direct matches
  // keep the Broker Commission Summary aligned with the uploaded data set
  // retailer buckets, including April '26 Customer Spoils Allowance.
  const krogerBannerStarts = [
    "KROGER ",
    "KRO ",
    "DILLONS ",
    "PICK N SAVE ",
    "METRO MARKET ",
    "MARIANO S ",
    "MARIANOS ",
    "RALPHS ",
    "SMITH S ",
    "SMITHS ",
    "KING SOOPERS ",
    "CITY MARKET ",
    "FRYS ",
    "FRY S ",
    "FOOD 4 LESS ",
    "FRED MEYER ",
    "QFC ",
    "HARRIS TEETER ",
    "ROUNDY S ",
    "MJR CAPITAL CITY MKT ",
    "MEIJER BRIDGE ST ",
  ];

  if (
    krogerBannerStarts.some((prefix) => customer.startsWith(prefix)) ||
    customer.includes(" KROGER ") ||
    customer.includes(" KRO ") ||
    customer.endsWith(" KGR") ||
    customer.includes(" KGR ")
  ) {
    return "Kroger";
  }

  if (
    customer.includes("FRESH THYME") ||
    customer.includes("FRSH THYME") ||
    customer.includes("FRMR MKT")
  ) {
    return "Fresh Thyme";
  }

  if (customer === "HEB" || customer.startsWith("HEB ")) {
    return "HEB";
  }

  return "";
}

function categorizeRetailerName(rawRetailer: string): RetailerName {
  const retailer = normalizeText(rawRetailer);

  if (!retailer) return "";
  if (retailer.includes("KROGER") || retailer === "KRO") return "Kroger";
  if (retailer.includes("FRESH THYME")) return "Fresh Thyme";
  if (retailer === "HEB" || retailer.includes(" HEB ")) return "HEB";

  return "INFRA & Others";
}

function inferRetailer(
  custName: string,
  itemName: string,
  upc: string,
  locations: LocationRow[]
): RetailerName {
  const trimmedCustomer = custName.trim();
  const normalizedItem = normalizeText(itemName);
  const normalizedUpc = normalizeText(upc);
  const skuSource = normalizedUpc || normalizedItem;

  if (
    /KEHE DISTRIBUTORS DC/i.test(trimmedCustomer) ||
    /\bDC\s*\d+\b/i.test(trimmedCustomer)
  ) {
    if (skuSource.startsWith("HP")) return "Kroger";
    if (skuSource.startsWith("CK") || skuSource.startsWith("NSA")) {
      return "Fresh Thyme";
    }
  }

  const directRetailer = directRetailerFromCustomer(custName);
  if (directRetailer) return directRetailer;

  const firstTwoCustomer = getFirstTwoWords(trimmedCustomer);
  if (!firstTwoCustomer) return "";
  if (/^DC\s*\d+$/i.test(trimmedCustomer)) return "";

  const match = locations.find((loc) => {
    const firstTwoLocation = getFirstTwoWords(loc.customer);
    return firstTwoCustomer === firstTwoLocation;
  });

  if (!match) return "";

  return categorizeRetailerName(match.retailer);
}

function isWmInvoiceType(type: string) {
  const t = normalizeText(type);
  return t === "WMINVOICE" || t === "WM INVOICE";
}

function getTypeLabel(type: string) {
  return String(type || "").trim() || "Deduction";
}

function isHebPullout(type: string, retailer: RetailerName) {
  const t = normalizeText(type);
  return retailer === "HEB" && t.includes("PULL OUT");
}

function retailerSortValue(retailer: RetailerName) {
  if (retailer === "Kroger") return 0;
  if (retailer === "Fresh Thyme") return 1;
  if (retailer === "INFRA & Others") return 2;
  if (retailer === "HEB") return 3;
  return 9;
}

function mergeByLabel(lines: DetailLine[]) {
  const map = new Map<string, DetailLine>();

  for (const line of lines) {
    const existing = map.get(line.label);
    if (existing) {
      existing.amount = round2(existing.amount + line.amount);
    } else {
      map.set(line.label, { ...line });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function applyAmountBasedDiscrepancy(
  baseRows: Omit<DatasetRow, "adjustedAmt">[],
  discrepancyByInvoice: Map<string, number>
): DatasetRow[] {
  const grouped = new Map<string, Omit<DatasetRow, "adjustedAmt">[]>();

  for (const row of baseRows) {
    const invoiceKey = normalizeInvoice(row.invoice);
    if (!grouped.has(invoiceKey)) grouped.set(invoiceKey, []);
    grouped.get(invoiceKey)!.push(row);
  }

  const result: DatasetRow[] = [];

  for (const [invoiceKey, invoiceRows] of grouped.entries()) {
    const invoiceDiscrepancy = round2(discrepancyByInvoice.get(invoiceKey) ?? 0);

    const wmRows = invoiceRows.filter(
      (row) => isWmInvoiceType(row.type) && Number(row.amt ?? 0) !== 0
    );

    const totalWmAmount = round2(
      wmRows.reduce((sum, row) => sum + Number(row.amt ?? 0), 0)
    );

    let runningShare = 0;

    for (const row of invoiceRows) {
      let adjustedAmt = row.amt;

      if (
        invoiceDiscrepancy !== 0 &&
        isWmInvoiceType(row.type) &&
        totalWmAmount !== 0
      ) {
        const wmIndex = wmRows.findIndex((r) => r.id === row.id);
        const isLastWmRow = wmIndex === wmRows.length - 1;

        let discrepancyShare = 0;
        if (isLastWmRow) {
          discrepancyShare = round2(invoiceDiscrepancy - runningShare);
        } else {
          discrepancyShare = round2(
            invoiceDiscrepancy * (Number(row.amt ?? 0) / totalWmAmount)
          );
          runningShare = round2(runningShare + discrepancyShare);
        }

        adjustedAmt = round2(Number(row.amt ?? 0) + discrepancyShare);
      }

      result.push({
        ...row,
        adjustedAmt,
      });
    }
  }

  return result;
}

async function fetchAllDatasetRows(): Promise<DatasetDbRow[]> {
  let allRows: DatasetDbRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("broker_commission_datasets")
      .select("id, month, check_date, invoice, type, upc, item, cust_name, amt")
      .order("check_date", { ascending: false, nullsFirst: false })
      .order("invoice", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as DatasetDbRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

async function fetchAllRetailerOverrides(): Promise<RetailerOverrideRow[]> {
  let allRows: RetailerOverrideRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("retailer_overrides")
      .select("dataset_id, retailer")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as RetailerOverrideRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

async function fetchAllLocations(): Promise<LocationRow[]> {
  let allRows: LocationRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("locations")
      .select("customer, retailer")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = ((data ?? []) as any[]).map((r) => ({
      customer: r.customer ?? "",
      retailer: r.retailer ?? "",
    }));

    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

async function fetchAllInvoiceRows(): Promise<InvoiceRow[]> {
  let allRows: InvoiceRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("invoices")
      .select("invoice_number, invoice_amt, type")
      .eq("type", "WM Invoice")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as InvoiceRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

async function fetchAllVelocityRows(): Promise<VelocityRow[]> {
  let allRows: VelocityRow[] = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const { data, error } = await supabase
      .from("kehe_velocity")
      .select("month, description, cases, retailer")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as VelocityRow[];
    allRows = allRows.concat(batch);

    if (batch.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allRows;
}

export default function BrokerCommissionSummaryView() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [velocityRows, setVelocityRows] = useState<VelocityRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("All Months");
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );
  const [expandedInvoiceRows, setExpandedInvoiceRows] = useState<
    Record<string, boolean>
  >({});
  const [transferAllocations, setTransferAllocations] =
    useState<TransferAllocationMap>({});
  const [allocationModal, setAllocationModal] = useState<TransferAlert | null>(
    null
  );
  const [draftAllocationInvoices, setDraftAllocationInvoices] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TRANSFER_ALLOCATIONS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as TransferAllocationMap;
      if (parsed && typeof parsed === "object") setTransferAllocations(parsed);
    } catch {
      // ignore saved allocation parse errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TRANSFER_ALLOCATIONS_STORAGE_KEY,
        JSON.stringify(transferAllocations),
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [transferAllocations]);

  const load = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    let datasetData: DatasetDbRow[] = [];
    let datasetError: any = null;

    let overrideData: RetailerOverrideRow[] = [];
    let overrideError: any = null;

    let locationData: LocationRow[] = [];
    let locationError: any = null;

    let invoiceData: InvoiceRow[] = [];
    let invoiceError: any = null;

    let velocityData: VelocityRow[] = [];
    let velocityError: any = null;

    try {
      [
        datasetData,
        overrideData,
        locationData,
        invoiceData,
        velocityData,
      ] = await Promise.all([
        fetchAllDatasetRows(),
        fetchAllRetailerOverrides(),
        fetchAllLocations(),
        fetchAllInvoiceRows(),
        fetchAllVelocityRows(),
      ]);
    } catch (error: any) {
      console.error("Load error:", error);
    }

    try {
      if (!datasetData.length) {
        datasetData = await fetchAllDatasetRows();
      }
    } catch (error) {
      datasetError = error;
    }

    try {
      if (!overrideData.length) {
        overrideData = await fetchAllRetailerOverrides();
      }
    } catch (error) {
      overrideError = error;
    }

    try {
      if (!locationData.length) {
        locationData = await fetchAllLocations();
      }
    } catch (error) {
      locationError = error;
    }

    try {
      if (!invoiceData.length) {
        invoiceData = await fetchAllInvoiceRows();
      }
    } catch (error) {
      invoiceError = error;
    }

    try {
      if (!velocityData.length) {
        velocityData = await fetchAllVelocityRows();
      }
    } catch (error) {
      velocityError = error;
    }

    if (datasetError) console.error("Failed to load datasets:", datasetError);
    if (overrideError) console.error("Failed to load overrides:", overrideError);
    if (locationError) console.error("Failed to load locations:", locationError);
    if (invoiceError) console.error("Failed to load invoices:", invoiceError);
    if (velocityError) console.error("Failed to load kehe velocity:", velocityError);

    const overrides = new Map<string, string>(
      overrideData.map((r) => [r.dataset_id, r.retailer])
    );

    const locations = locationData;
    const datasetRowsRaw = datasetData;
    const invoiceRows = invoiceData;

    const ksolveByInvoice = new Map<string, number>();
    for (const row of invoiceRows) {
      const invoice = normalizeInvoice(row.invoice_number ?? "");
      if (!invoice) continue;
      ksolveByInvoice.set(
        invoice,
        round2((ksolveByInvoice.get(invoice) ?? 0) + Number(row.invoice_amt ?? 0))
      );
    }

    const wmByInvoice = new Map<string, number>();
    for (const row of datasetRowsRaw) {
      const invoice = normalizeInvoice(row.invoice ?? "");
      if (!invoice) continue;
      if (!isWmInvoiceType(row.type ?? "")) continue;

      wmByInvoice.set(
        invoice,
        round2((wmByInvoice.get(invoice) ?? 0) + Number(row.amt ?? 0))
      );
    }

    const discrepancyByInvoice = new Map<string, number>();
    for (const invoice of new Set([...ksolveByInvoice.keys(), ...wmByInvoice.keys()])) {
      const ksolveAmount = ksolveByInvoice.get(invoice) ?? 0;
      const wmAmount = wmByInvoice.get(invoice) ?? 0;
      discrepancyByInvoice.set(invoice, round2(ksolveAmount - wmAmount));
    }

    const baseRows: Omit<DatasetRow, "adjustedAmt">[] = datasetRowsRaw.map((r) => {
      const inferred = inferRetailer(
        r.cust_name ?? "",
        r.item ?? "",
        r.upc ?? "",
        locations
      );
      const override = overrides.get(r.id) ?? "";
      const rawMonth = String(r.month ?? "").trim();
      const rawCheckDate = String(r.check_date ?? "").trim();

      const derivedMonth = normalizeMonthLabel(
        rawMonth || formatMonthFromDate(rawCheckDate) || ""
      );

      return {
        id: r.id,
        month: derivedMonth,
        check_date: r.check_date ?? "",
        invoice: normalizeInvoice(r.invoice ?? ""),
        type: r.type ?? "",
        upc: r.upc ?? "",
        item: r.item ?? "",
        cust_name: r.cust_name ?? "",
        amt: Number(r.amt ?? 0),
        retailer: (override || inferred || "") as RetailerName,
      };
    });

    const hydratedRows = applyAmountBasedDiscrepancy(baseRows, discrepancyByInvoice);

    const normalizedVelocityRows = velocityData.map((row) => ({
      ...row,
      month: normalizeMonthLabel(row.month ?? ""),
    }));

    setRows(hydratedRows);
    setVelocityRows(normalizedVelocityRows);

    const months = Array.from(
      new Set(hydratedRows.map((r) => r.month).filter(Boolean))
    ).sort((a, b) => parseMonthOrder(b) - parseMonthOrder(a));

    setExpandedMonths((prev) => {
      const next = { ...prev };
      months.forEach((m) => {
        if (!(m in next)) next[m] = false;
      });
      return next;
    });

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const monthOptions = useMemo(() => {
    return [
      "All Months",
      ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean))).sort(
        (a, b) => parseMonthOrder(b) - parseMonthOrder(a)
      ),
    ];
  }, [rows]);

  const summary = useMemo(() => {
    const datasetRows =
      selectedMonth === "All Months"
        ? rows
        : rows.filter((r) => r.month === selectedMonth);

    const filteredVelocityRows =
      selectedMonth === "All Months"
        ? velocityRows
        : velocityRows.filter(
            (r) => normalizeMonthLabel(r.month ?? "") === normalizeMonthLabel(selectedMonth)
          );

    const monthMap = new Map<string, MonthSummary>();

    const ensureMonth = (month: string) => {
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          retailers: [],
          transferAlerts: [],
          grandWmInvoiceTotal: 0,
          grandDeductionsTotal: 0,
          grandNetTotal: 0,
          grandBrokerFeeTotal: 0,
        });
      }
      return monthMap.get(month)!;
    };

    const ensureRetailerBlock = (
      monthSummary: MonthSummary,
      retailer: RetailerName
    ) => {
      let block = monthSummary.retailers.find((r) => r.retailer === retailer);
      if (!block) {
        block = {
          retailer,
          wmInvoiceTotal: 0,
          deductionsTotal: 0,
          total: 0,
          brokerFee: 0,
          details: [],
        };
        monthSummary.retailers.push(block);
      }
      return block;
    };

    const wmInvoiceTotalsByMonthInvoiceRetailer = new Map<string, number>();
    const firstWmInvoiceByMonth = new Map<string, string>();

    for (const row of datasetRows) {
      const retailer = (row.retailer ?? "") as RetailerName;
      if (!retailer) continue;
      if (!isWmInvoiceType(row.type)) continue;

      const amount = Math.abs(row.adjustedAmt);
      const key = `${row.month}__${row.invoice}__${retailer}`;

      wmInvoiceTotalsByMonthInvoiceRetailer.set(
        key,
        round2((wmInvoiceTotalsByMonthInvoiceRetailer.get(key) ?? 0) + amount)
      );

      const firstInvoice = firstWmInvoiceByMonth.get(row.month);
      if (!firstInvoice || row.invoice.localeCompare(firstInvoice) < 0) {
        firstWmInvoiceByMonth.set(row.month, row.invoice);
      }
    }

    for (const [month, firstInvoice] of firstWmInvoiceByMonth.entries()) {
      const getHpCasesForRetailer = (targetRetailer: RetailerName) => {
        return filteredVelocityRows.reduce((sum, row) => {
          if (normalizeMonthLabel(row.month ?? "") !== normalizeMonthLabel(month)) {
            return sum;
          }

          if (categorizeRetailerName(row.retailer ?? "") !== targetRetailer) {
            return sum;
          }

          const description = normalizeText(row.description ?? "");
          if (!description.startsWith("HP")) return sum;

          return sum + Number(row.cases ?? 0);
        }, 0);
      };

      const getKrogerInvoiceOptions = (): InvoiceAllocationOption[] => {
        const options: InvoiceAllocationOption[] = [];

        for (const [key, amount] of wmInvoiceTotalsByMonthInvoiceRetailer.entries()) {
          const [keyMonth, keyInvoice, keyRetailer] = key.split("__") as [
            string,
            string,
            RetailerName,
          ];

          if (keyMonth !== month || keyRetailer !== "Kroger") continue;
          if (amount <= 0) continue;

          options.push({ invoice: keyInvoice, krogerAmount: round2(amount) });
        }

        return options.sort((a, b) => a.invoice.localeCompare(b.invoice));
      };

      const applyVelocityTransferFromKroger = (
        targetRetailer: Exclude<RetailerName, "">
      ) => {
        if (!targetRetailer || targetRetailer === "Kroger") return;

        const hpCases = getHpCasesForRetailer(targetRetailer);
        const transferAmount = round2(hpCases * INFRA_HP_CASE_RATE);
        if (transferAmount <= 0) return;

        const allocationKey = `${month}__${targetRetailer}`;
        const invoiceOptions = getKrogerInvoiceOptions();
        const firstInvoiceAmount = round2(
          invoiceOptions.find((option) => option.invoice === firstInvoice)?.krogerAmount ?? 0
        );

        const configuredInvoices = transferAllocations[allocationKey];
        const selectedInvoices =
          configuredInvoices && configuredInvoices.length > 0
            ? configuredInvoices.filter((invoice) =>
                invoiceOptions.some((option) => option.invoice === invoice)
              )
            : firstInvoice
              ? [firstInvoice]
              : [];

        let remaining = transferAmount;
        let allocatedAmount = 0;

        for (const invoice of selectedInvoices) {
          if (remaining <= 0) break;

          const krogerKey = `${month}__${invoice}__Kroger`;
          const targetKey = `${month}__${invoice}__${targetRetailer}`;
          const krogerAmount = round2(
            wmInvoiceTotalsByMonthInvoiceRetailer.get(krogerKey) ?? 0
          );

          if (krogerAmount <= 0) continue;

          const allocationAmount = round2(Math.min(krogerAmount, remaining));
          if (allocationAmount <= 0) continue;

          wmInvoiceTotalsByMonthInvoiceRetailer.set(
            krogerKey,
            round2(krogerAmount - allocationAmount)
          );

          wmInvoiceTotalsByMonthInvoiceRetailer.set(
            targetKey,
            round2(
              (wmInvoiceTotalsByMonthInvoiceRetailer.get(targetKey) ?? 0) +
                allocationAmount
            )
          );

          allocatedAmount = round2(allocatedAmount + allocationAmount);
          remaining = round2(remaining - allocationAmount);
        }

        const unallocatedAmount = round2(Math.max(remaining, 0));
        const usedDefaultFirstInvoice = !configuredInvoices || configuredInvoices.length === 0;
        const exceedsFirstInvoice = transferAmount > firstInvoiceAmount;

        if (unallocatedAmount > 0 || (usedDefaultFirstInvoice && exceedsFirstInvoice)) {
          const monthSummary = ensureMonth(month);
          monthSummary.transferAlerts.push({
            key: allocationKey,
            month,
            targetRetailer,
            transferAmount,
            allocatedAmount,
            unallocatedAmount,
            firstInvoice,
            firstInvoiceAmount,
            selectedInvoices,
            invoiceOptions,
          });
        }
      };

      applyVelocityTransferFromKroger("INFRA & Others");
      applyVelocityTransferFromKroger("HEB");
    }

    for (const [key, amount] of wmInvoiceTotalsByMonthInvoiceRetailer.entries()) {
      if (amount <= 0) continue;

      const [month, invoice, retailer] = key.split("__") as [
        string,
        string,
        RetailerName
      ];

      const monthSummary = ensureMonth(month);
      const block = ensureRetailerBlock(monthSummary, retailer);

      block.wmInvoiceTotal = round2(block.wmInvoiceTotal + amount);
      block.details.push({
        label: "WM Invoice",
        amount,
        kind: "invoice-summary",
        children: [
          {
            label: `WM Invoice ${invoice}`,
            amount,
            kind: "invoice-detail",
          },
        ],
      });
    }

    const dc19ByMonth = new Map<string, boolean>();
    for (const row of datasetRows) {
      if (normalizeText(row.cust_name) === "DC19") {
        dc19ByMonth.set(row.month, true);
      }
    }

    for (const row of datasetRows) {
      const retailer = (row.retailer ?? "") as RetailerName;
      if (!retailer) continue;
      if (isWmInvoiceType(row.type)) continue;

      const monthSummary = ensureMonth(row.month);
      const block = ensureRetailerBlock(monthSummary, retailer);

      let typeLabel = getTypeLabel(row.type);

      if (isHebPullout(row.type, retailer)) {
        const hasDc19 = dc19ByMonth.get(row.month) ?? false;
        if (!hasDc19) {
          const firstInvoice = firstWmInvoiceByMonth.get(row.month);
          if (firstInvoice) {
            typeLabel = `${typeLabel} (allocated to WM Invoice ${firstInvoice})`;
          }
        } else {
          typeLabel = `${typeLabel} (DC19)`;
        }
      }

      const deductionAmount = round2(-Math.abs(Number(row.amt ?? 0)));
      block.deductionsTotal = round2(block.deductionsTotal + deductionAmount);
      block.details.push({
        label: typeLabel,
        amount: deductionAmount,
        kind: "deduction",
      });
    }

    for (const monthSummary of monthMap.values()) {
      for (const block of monthSummary.retailers) {
        const invoiceSummaryLines = block.details.filter(
          (d) => d.kind === "invoice-summary"
        );

        const mergedInvoiceSummaries = invoiceSummaryLines.reduce<DetailLine[]>(
          (acc, line) => {
            const existing = acc.find((a) => a.label === line.label);
            if (existing) {
              existing.amount = round2(existing.amount + line.amount);
              existing.children = [
                ...(existing.children ?? []),
                ...(line.children ?? []),
              ];
            } else {
              acc.push({
                ...line,
                children: [...(line.children ?? [])],
              });
            }
            return acc;
          },
          []
        );

        for (const line of mergedInvoiceSummaries) {
          line.children = (line.children ?? []).sort((a, b) =>
            a.label.localeCompare(b.label)
          );
        }

        const deductionLines = mergeByLabel(
          block.details.filter((d) => d.kind === "deduction")
        );

        block.details = [...mergedInvoiceSummaries, ...deductionLines];
        block.total = round2(block.wmInvoiceTotal + block.deductionsTotal);
        block.brokerFee =
          block.retailer === "Kroger" ? round2(block.total * 0.04) : 0;
      }

      monthSummary.retailers.sort((a, b) => {
        const diff = retailerSortValue(a.retailer) - retailerSortValue(b.retailer);
        if (diff !== 0) return diff;
        return a.retailer.localeCompare(b.retailer);
      });

      monthSummary.grandWmInvoiceTotal = round2(
        monthSummary.retailers.reduce((sum, r) => sum + r.wmInvoiceTotal, 0)
      );
      monthSummary.grandDeductionsTotal = round2(
        monthSummary.retailers.reduce((sum, r) => sum + r.deductionsTotal, 0)
      );
      monthSummary.grandNetTotal = round2(
        monthSummary.retailers.reduce((sum, r) => sum + r.total, 0)
      );
      monthSummary.grandBrokerFeeTotal = round2(
        monthSummary.retailers.reduce((sum, r) => sum + r.brokerFee, 0)
      );
    }

    return Array.from(monthMap.values()).sort(
      (a, b) => parseMonthOrder(b.month) - parseMonthOrder(a.month)
    );
  }, [rows, velocityRows, selectedMonth, transferAllocations]);

  const getCurrentAllocationInvoices = (alert: TransferAlert) => {
    const saved = transferAllocations[alert.key];
    return saved && saved.length > 0 ? saved : alert.selectedInvoices;
  };

  const openAllocationModal = (alert: TransferAlert) => {
    setDraftAllocationInvoices(getCurrentAllocationInvoices(alert));
    setAllocationModal(alert);
  };

  const getAllocationPreview = (alert: TransferAlert, selectedInvoices: string[]) => {
    const selectedSet = new Set(selectedInvoices);
    let remaining = alert.transferAmount;
    let allocatedAmount = 0;

    for (const option of alert.invoiceOptions) {
      if (remaining <= 0) break;
      if (!selectedSet.has(option.invoice)) continue;

      const allocationAmount = round2(Math.min(option.krogerAmount, remaining));
      allocatedAmount = round2(allocatedAmount + allocationAmount);
      remaining = round2(remaining - allocationAmount);
    }

    return {
      allocatedAmount,
      unallocatedAmount: round2(Math.max(remaining, 0)),
    };
  };

  const toggleAllocationInvoice = (invoice: string) => {
    setDraftAllocationInvoices((current) => {
      const exists = current.includes(invoice);
      return exists
        ? current.filter((item) => item !== invoice)
        : [...current, invoice];
    });
  };

  const selectAllAllocationInvoices = (alert: TransferAlert) => {
    setDraftAllocationInvoices(alert.invoiceOptions.map((option) => option.invoice));
  };

  const resetAllocationToFirstInvoice = (alert: TransferAlert) => {
    setDraftAllocationInvoices(alert.firstInvoice ? [alert.firstInvoice] : []);
  };

  const saveAllocationModal = () => {
    if (!allocationModal) return;

    const validInvoices = draftAllocationInvoices.filter((invoice) =>
      allocationModal.invoiceOptions.some((option) => option.invoice === invoice),
    );

    setTransferAllocations((prev) => ({
      ...prev,
      [allocationModal.key]: validInvoices,
    }));
    setAllocationModal(null);
    setDraftAllocationInvoices([]);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Broker Commission Summary
          </h2>
          <p className="text-sm text-slate-500">
          Broker Commission provides a detailed summary of transactions used to calculate Kroger commission.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">Month</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month === "All Months" ? month : formatMonthShort(month)}
              </option>
            ))}
          </select>

          <button
  type="button"
  onClick={() => load(true)}
  disabled={refreshing}
  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
  title="Refresh"
>
  <RotateCw
    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
  />
</button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">
          Loading broker commission summary...
        </div>
      ) : summary.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">
          No broker commission data found.
        </div>
      ) : (
        summary.map((monthSummary) => {
          const isExpanded = expandedMonths[monthSummary.month] ?? true;

          return (
            <div key={monthSummary.month} className="rounded-2xl border bg-white">
              <button
                type="button"
                onClick={() =>
                  setExpandedMonths((prev) => ({
                    ...prev,
                    [monthSummary.month]: !isExpanded,
                  }))
                }
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  )}
                  <div>
                    <div className="text-base font-semibold text-slate-900">
                      {formatMonthShort(monthSummary.month)}
                    </div>
                    <div className="text-sm text-slate-500">
                      {monthSummary.retailers.length} retailer bucket
                      {monthSummary.retailers.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-right md:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">WM Invoice</div>
                    <div className="font-semibold text-slate-900">
                      {formatMoney(monthSummary.grandWmInvoiceTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Deductions</div>
                    <div className="font-semibold text-red-600">
                      {formatMoney(monthSummary.grandDeductionsTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Net</div>
                    <div className="font-semibold text-slate-900">
                      {formatMoney(monthSummary.grandNetTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">4% Fee</div>
                    <div className="font-semibold text-emerald-700">
                      {formatMoney(monthSummary.grandBrokerFeeTotal)}
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t px-5 py-5">
                  {monthSummary.transferAlerts.length > 0 && (
                    <div className="space-y-3">
                      {monthSummary.transferAlerts.map((alert) => (
                        <div
                          key={alert.key}
                          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="font-semibold text-amber-900">
                                {alert.targetRetailer} transfer exceeds the selected Kroger invoice allocation
                              </div>
                              <div className="mt-1 text-sm text-amber-800">
                                Transfer needed: {formatMoney(alert.transferAmount)}. First invoice {alert.firstInvoice || "—"} has {formatMoney(alert.firstInvoiceAmount)} available.
                                {alert.unallocatedAmount > 0
                                  ? ` ${formatMoney(alert.unallocatedAmount)} is still unallocated.`
                                  : " Select additional invoices if you want to spread this transfer."}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => openAllocationModal(alert)}
                              className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
                            >
                              Allocate to invoices
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {monthSummary.retailers.map((block) => (
                    <div
                      key={`${monthSummary.month}-${block.retailer}`}
                      className="rounded-2xl border border-slate-200"
                    >
                      <div className="grid grid-cols-1 gap-4 border-b px-4 py-4 md:grid-cols-5">
                        <div>
                          <div className="text-xs text-slate-500">Retailer</div>
                          <div className="font-semibold text-slate-900">
                            {block.retailer}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">WM Invoice Total</div>
                          <div className="font-semibold text-slate-900">
                            {formatMoney(block.wmInvoiceTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Deductions</div>
                          <div className="font-semibold text-red-600">
                            {formatMoney(block.deductionsTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Net Total</div>
                          <div className="font-semibold text-slate-900">
                            {formatMoney(block.total)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">4% Broker Fee</div>
                          <div className="font-semibold text-emerald-700">
                            {formatMoney(block.brokerFee)}
                          </div>
                        </div>
                      </div>

                      <div className="overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">
                                Line Item
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                Amount
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {block.details.map((detail, idx) => {
                              if (detail.kind === "invoice-summary") {
                                const key = `${monthSummary.month}-${block.retailer}-wm-${idx}`;
                                const rowExpanded = expandedInvoiceRows[key] ?? false;

                                return (
                                  <React.Fragment key={key}>
                                    <tr className="border-t">
                                      <td className="px-4 py-3">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedInvoiceRows((prev) => ({
                                              ...prev,
                                              [key]: !rowExpanded,
                                            }))
                                          }
                                          className="flex items-center gap-2 font-medium text-slate-900"
                                        >
                                          {rowExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-slate-500" />
                                          ) : (
                                            <ChevronRight className="h-4 w-4 text-slate-500" />
                                          )}
                                          {detail.label}
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                                        {formatMoney(detail.amount)}
                                      </td>
                                    </tr>

                                    {detail.children?.map((child, childIdx) =>
                                      rowExpanded ? (
                                        <tr
                                          key={`${key}-child-${childIdx}`}
                                          className="border-t bg-slate-50/50"
                                        >
                                          <td className="px-4 py-3 pl-10 text-slate-700">
                                            {child.label}
                                          </td>
                                          <td className="px-4 py-3 text-right font-medium text-slate-700">
                                            {formatMoney(child.amount)}
                                          </td>
                                        </tr>
                                      ) : null
                                    )}
                                  </React.Fragment>
                                );
                              }

                              return (
                                <tr key={`${detail.label}-${idx}`} className="border-t">
                                  <td className="px-4 py-3">{detail.label}</td>
                                  <td className="px-4 py-3 text-right font-medium text-red-600">
                                    {formatMoney(detail.amount)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {allocationModal && (() => {
        const allocationPreview = getAllocationPreview(allocationModal, draftAllocationInvoices);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Allocate {allocationModal.targetRetailer} Transfer
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Select the Kroger WM invoices for {formatMonthShort(allocationModal.month)}.
                  The transfer will deduct from selected Kroger invoices in invoice-number order and move the same amount to {allocationModal.targetRetailer}, so the monthly WM Invoice total stays unchanged.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAllocationModal(null); setDraftAllocationInvoices([]); }}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Transfer Needed</div>
                <div className="mt-1 font-semibold text-slate-900">
                  {formatMoney(allocationModal.transferAmount)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Currently Allocated</div>
                <div className="mt-1 font-semibold text-emerald-700">
                  {formatMoney(allocationPreview.allocatedAmount)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Unallocated</div>
                <div className={`mt-1 font-semibold ${allocationPreview.unallocatedAmount > 0 ? "text-red-600" : "text-slate-900"}`}>
                  {formatMoney(allocationPreview.unallocatedAmount)}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selectAllAllocationInvoices(allocationModal)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Select all invoices
              </button>
              <button
                type="button"
                onClick={() => resetAllocationToFirstInvoice(allocationModal)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset to first invoice
              </button>
            </div>

            <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Use</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Kroger WM Invoice</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Available Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationModal.invoiceOptions.map((option) => {
                    const selected = draftAllocationInvoices.includes(option.invoice);

                    return (
                      <tr key={option.invoice} className="border-t border-slate-100">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAllocationInvoice(option.invoice)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          WM Invoice {option.invoice}
                          {option.invoice === allocationModal.firstInvoice && (
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                              First invoice
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-700">
                          {formatMoney(option.krogerAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveAllocationModal}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
