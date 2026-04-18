"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Filter,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

type Row = {
  id: string;
  month: string;
  checkDate: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  custName: string;
  retailer: string;
  amt: number;
  discrepancyShare: number;
  adjustedAmt: number;
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
  invoice_number: string | number | null;
  check_date?: string | null;
  check_number?: string | null;
  invoice_amt?: number | null;
  type?: string | null;
};

type LocationRow = {
  customer: string;
  retailer: string;
};

type RetailerOverrideRow = {
  dataset_id: string;
  retailer: string;
};

const EDITABLE_RETAILERS = [
  "Fresh Thyme",
  "Kroger",
  "INFRA & Others",
  "HEB",
  "Add new retailer...",
] as const;

const PAGE_SIZE = 1000;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return "";
  const year = parseInt(parts[1], 10);
  const month = parseInt(parts[2], 10) - 1;
  const d = new Date(year, month, 1);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { month: "long" })} '${String(year).slice(-2)}`;
}

function formatCheckDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeInvoice(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  return raw
    .replace(/\.0+$/g, "")
    .replace(/[.]+$/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
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

function normalizeType(value: string) {
  return String(value || "").trim().toUpperCase();
}

function isWmInvoiceType(value: string) {
  const t = normalizeType(value);
  return t === "WM INVOICE" || t === "WMINVOICE";
}

/**
 * Normalize a raw type string from the DB — strips non-breaking spaces,
 * collapses whitespace, and trims. Used consistently for both storing
 * and comparing type values so the filter always matches correctly.
 */
function cleanType(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * De-duplicate a string that has been accidentally doubled.
 * e.g. "KeHE Distributors DC16 KeHE Distributors DC16"
 *   → "KeHE Distributors DC16"
 * Only strips if the string is exactly X+X (even length, both halves identical).
 */
function dedupString(value: string): string {
  if (!value || value.length % 2 !== 0) return value;
  const half = value.slice(0, value.length / 2);
  return value === half + half ? half : value;
}

function stripLocationSuffix(rawCustomer: string): string {
  const dashIndex = rawCustomer.indexOf(" - ");
  return dashIndex !== -1 ? rawCustomer.slice(0, dashIndex) : rawCustomer;
}

function getMeaningfulWords(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
}

function getFirstNWordsKey(raw: string, n: number): string {
  const stripped = stripLocationSuffix(raw);
  const normalized = normalizeText(stripped);
  const words = getMeaningfulWords(normalized);
  return words.slice(0, n).join(" ");
}

function getSignificantWords(raw: string): string[] {
  const normalized = normalizeText(stripLocationSuffix(raw));
  return normalized
    .split(" ")
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
}

function categorizeRetailerName(rawRetailer: string): string {
  const retailer = normalizeText(rawRetailer);
  if (!retailer) return "";
  if (retailer.includes("KROGER") || retailer === "KRO" || retailer.startsWith("KRO ")) return "Kroger";
  if (retailer.includes("FRESH THYME")) return "Fresh Thyme";
  if (retailer === "HEB" || retailer.includes(" HEB ")) return "HEB";
  return "INFRA & Others";
}

type LocationIndex = {
  twoWordMap: Map<string, LocationRow>;
  oneWordMap: Map<string, LocationRow>;
  wordMap: Map<string, LocationRow>;
};

function buildLocationIndex(locations: LocationRow[]): LocationIndex {
  const twoWordMap = new Map<string, LocationRow>();
  const oneWordMap = new Map<string, LocationRow>();
  const wordMap = new Map<string, LocationRow>();

  for (const loc of locations) {
    const twoKey = getFirstNWordsKey(loc.customer, 2);
    const oneKey = getFirstNWordsKey(loc.customer, 1);
    const sigWords = getSignificantWords(loc.customer);

    if (twoKey && !twoWordMap.has(twoKey)) twoWordMap.set(twoKey, loc);
    if (oneKey && !oneWordMap.has(oneKey)) oneWordMap.set(oneKey, loc);
    for (const w of sigWords) {
      if (!wordMap.has(w)) wordMap.set(w, loc);
    }
  }

  return { twoWordMap, oneWordMap, wordMap };
}

function findRetailer(
  custName: string,
  itemName: string,
  upc: string,
  index: LocationIndex
): string {
  const trimmedCustomer = custName.trim();
  const normalizedItem = normalizeText(itemName);
  const normalizedUpc = normalizeText(upc);
  const skuSource = normalizedUpc || normalizedItem;

  if (
    /KEHE DISTRIBUTORS DC/i.test(trimmedCustomer) ||
    /\bDC\s*\d+\b/i.test(trimmedCustomer)
  ) {
    if (skuSource.startsWith("HP")) return "Kroger";
    if (skuSource.startsWith("CK") || skuSource.startsWith("NSA")) return "Fresh Thyme";
  }

  if (/^DC\s*\d+$/i.test(trimmedCustomer)) return "";

  const twoKey = getFirstNWordsKey(trimmedCustomer, 2);
  const twoMatch = index.twoWordMap.get(twoKey);
  if (twoMatch) return categorizeRetailerName(twoMatch.retailer);

  const oneKey = getFirstNWordsKey(trimmedCustomer, 1);
  const oneMatch = index.oneWordMap.get(oneKey);
  if (oneMatch) return categorizeRetailerName(oneMatch.retailer);

  const custSigWords = getSignificantWords(trimmedCustomer);
  for (const w of custSigWords) {
    const wordMatch = index.wordMap.get(w);
    if (wordMatch) return categorizeRetailerName(wordMatch.retailer);
  }

  return "";
}

function applyAmountBasedDiscrepancy(
  baseRows: Omit<Row, "discrepancyShare" | "adjustedAmt">[],
  discrepancyByInvoice: Map<string, number>
): Row[] {
  const grouped = new Map<string, Omit<Row, "discrepancyShare" | "adjustedAmt">[]>();

  for (const row of baseRows) {
    const invoiceKey = normalizeInvoice(row.invoice);
    if (!grouped.has(invoiceKey)) grouped.set(invoiceKey, []);
    grouped.get(invoiceKey)!.push(row);
  }

  const result: Row[] = [];

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
      let discrepancyShare = 0;

      if (
        invoiceDiscrepancy !== 0 &&
        isWmInvoiceType(row.type) &&
        totalWmAmount !== 0
      ) {
        const wmIndex = wmRows.findIndex((r) => r.id === row.id);
        const isLastWmRow = wmIndex === wmRows.length - 1;

        if (isLastWmRow) {
          discrepancyShare = round2(invoiceDiscrepancy - runningShare);
        } else {
          discrepancyShare = round2(
            invoiceDiscrepancy * (Number(row.amt ?? 0) / totalWmAmount)
          );
          runningShare = round2(runningShare + discrepancyShare);
        }
      }

      result.push({
        ...row,
        discrepancyShare,
        adjustedAmt: round2(Number(row.amt ?? 0) + discrepancyShare),
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

export default function BrokerCommissionDataSetsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [selectedType, setSelectedType] = useState("All Types");
  const [selectedRetailer, setSelectedRetailer] = useState("All Retailers");
  const [selectedMonth, setSelectedMonth] = useState("All Months");

  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [retailerFilterOpen, setRetailerFilterOpen] = useState(false);
  const [monthFilterOpen, setMonthFilterOpen] = useState(false);

  const [search, setSearch] = useState("");

  const [missingInvoices, setMissingInvoices] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editRetailerChoice, setEditRetailerChoice] = useState("");
  const [customRetailer, setCustomRetailer] = useState("");

  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkRetailerChoice, setBulkRetailerChoice] = useState("Fresh Thyme");
  const [bulkCustomRetailer, setBulkCustomRetailer] = useState("");

  const notifRef = useRef<HTMLDivElement | null>(null);
  const typeFilterRef = useRef<HTMLDivElement | null>(null);
  const retailerFilterRef = useRef<HTMLDivElement | null>(null);
  const monthFilterRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadData = async () => {
    setLoading(true);

    let datasetData: DatasetDbRow[] = [];
    let datasetError: any = null;

    try {
      datasetData = await fetchAllDatasetRows();
    } catch (error) {
      datasetError = error;
    }

    const [
      { data: invoiceData, error: invoiceError },
      { data: locationsData, error: locationsError },
      { data: overrideData, error: overrideError },
    ] = await Promise.all([
      supabase
        .from("invoices")
        .select("invoice_number, check_date, check_number, invoice_amt, type")
        .ilike("type", "WM Invoice"),
      supabase.from("locations").select("customer, retailer"),
      supabase.from("retailer_overrides").select("dataset_id, retailer"),
    ]);

    if (datasetError) {
      console.error("Failed to load datasets:", datasetError);
      alert(`Failed to load datasets: ${datasetError.message ?? "Unknown error"}`);
      setRows([]);
      setMissingInvoices([]);
      setLoading(false);
      return;
    }

    if (invoiceError) console.error("Failed to load invoices:", invoiceError);
    if (locationsError) console.error("Failed to load locations:", locationsError);
    if (overrideError) console.error("Failed to load retailer overrides:", overrideError);

    const locations: LocationRow[] = (locationsData ?? []).map((row: any) => ({
      customer: row.customer ?? "",
      retailer: row.retailer ?? "",
    }));

    const locationIndex = buildLocationIndex(locations);

    const overrideMap = new Map(
      ((overrideData ?? []) as RetailerOverrideRow[]).map((row) => [
        row.dataset_id,
        row.retailer,
      ])
    );

    const ksolveByInvoice = new Map<string, number>();
    for (const row of (invoiceData ?? []) as InvoiceRow[]) {
      const invoice = normalizeInvoice(row.invoice_number);
      if (!invoice) continue;
      ksolveByInvoice.set(
        invoice,
        round2((ksolveByInvoice.get(invoice) ?? 0) + Number(row.invoice_amt ?? 0))
      );
    }

    const wmByInvoice = new Map<string, number>();
    for (const row of datasetData) {
      const invoice = normalizeInvoice(row.invoice);
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

    const baseRows: Omit<Row, "discrepancyShare" | "adjustedAmt">[] = datasetData.map((row) => {
      const inferredRetailer = findRetailer(
        row.cust_name ?? "",
        row.item ?? "",
        row.upc ?? "",
        locationIndex
      );
      const overrideRetailer = overrideMap.get(row.id) ?? "";
      const derivedMonth =
        formatMonthFromDate(row.check_date ?? "") || (row.month ?? "");

      const rowType = cleanType(row.type);
      const rawCustName = row.cust_name ?? "";
      const custName = dedupString(rawCustName.trim());

      return {
        id: row.id,
        month: derivedMonth,
        checkDate: row.check_date ?? "",
        invoice: row.invoice ?? "",
        type: rowType,
        upc: row.upc ?? "",
        item: row.item ?? "",
        custName,
        retailer: overrideRetailer || inferredRetailer || "",
        amt: Number(row.amt ?? 0),
      };
    });

    setRows(applyAmountBasedDiscrepancy(baseRows, discrepancyByInvoice));

    if (invoiceError) {
      setMissingInvoices([]);
    } else {
      const datasetInvoiceSet = new Set(
        datasetData.map((row) => normalizeInvoice(row.invoice)).filter(Boolean)
      );
      const ksolveInvoiceList = Array.from(
        new Set(
          ((invoiceData ?? []) as InvoiceRow[])
            .map((row) => normalizeInvoice(row.invoice_number))
            .filter(Boolean)
        )
      );
      const missing = ksolveInvoiceList.filter(
        (invoice) => !datasetInvoiceSet.has(invoice)
      );
      setMissingInvoices(missing.sort((a, b) => a.localeCompare(b)));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (typeFilterRef.current && !typeFilterRef.current.contains(target)) setTypeFilterOpen(false);
      if (retailerFilterRef.current && !retailerFilterRef.current.contains(target)) setRetailerFilterOpen(false);
      if (monthFilterRef.current && !monthFilterRef.current.contains(target)) setMonthFilterOpen(false);
      if (menuRowId) {
        const menuRef = actionMenuRefs.current[menuRowId];
        if (menuRef && !menuRef.contains(target)) setMenuRowId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuRowId]);

  const types = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const row of rows) {
      const t = cleanType(row.type);
      if (t && !seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }

    return ["All Types", ...result.sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const months = useMemo(
    () => ["All Months", ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean)))],
    [rows]
  );

  const retailerOptions = useMemo(() => {
    const options = ["All Retailers"];
    if (rows.some((r) => r.retailer === "Fresh Thyme")) options.push("Fresh Thyme");
    if (rows.some((r) => r.retailer === "Kroger")) options.push("Kroger");
    if (rows.some((r) => r.retailer === "INFRA & Others")) options.push("INFRA & Others");
    if (rows.some((r) => r.retailer === "HEB")) options.push("HEB");
    if (rows.some((r) => !r.retailer)) options.push("Blank");
    return options;
  }, [rows]);

  useEffect(() => {
    if (!retailerOptions.includes(selectedRetailer)) setSelectedRetailer("All Retailers");
  }, [retailerOptions, selectedRetailer]);

  const data = useMemo(() => {
    const keyword = search.trim().toLowerCase();
  
    const selectedTypeNorm =
      selectedType === "All Types" ? "All Types" : cleanType(selectedType).toUpperCase();
  
    const selectedRetailerNorm =
      selectedRetailer === "All Retailers"
        ? "All Retailers"
        : selectedRetailer === "Blank"
          ? "Blank"
          : selectedRetailer.trim().toUpperCase();
  
    const selectedMonthNorm =
      selectedMonth === "All Months" ? "All Months" : selectedMonth.trim();
  
    const filtered = rows.filter((row) => {
      const rowType = cleanType(row.type).toUpperCase();
      const rowRetailer = String(row.retailer || "").replace(/\u00a0/g, " ").trim();
      const rowRetailerNorm = rowRetailer.toUpperCase();
      const rowMonth = String(row.month || "").trim();
  
      const matchesType =
        selectedTypeNorm === "All Types" || rowType === selectedTypeNorm;
  
      const matchesRetailer =
        selectedRetailerNorm === "All Retailers" ||
        (selectedRetailerNorm === "Blank" && rowRetailer === "") ||
        rowRetailerNorm === selectedRetailerNorm;
  
      const matchesMonth =
        selectedMonthNorm === "All Months" || rowMonth === selectedMonthNorm;
  
      const displayAmount = isWmInvoiceType(row.type) ? row.adjustedAmt : row.amt;
  
      const matchesSearch =
        !keyword ||
        rowType.toLowerCase().includes(keyword) ||
        formatMonthShort(row.month).toLowerCase().includes(keyword) ||
        formatCheckDate(row.checkDate).toLowerCase().includes(keyword) ||
        row.invoice.toLowerCase().includes(keyword) ||
        row.upc.toLowerCase().includes(keyword) ||
        row.item.toLowerCase().includes(keyword) ||
        row.custName.toLowerCase().includes(keyword) ||
        rowRetailer.toLowerCase().includes(keyword) ||
        displayAmount.toFixed(2).includes(keyword);
  
      return matchesType && matchesRetailer && matchesMonth && matchesSearch;
    });
  
    console.log("FILTER STATE", {
      selectedType,
      selectedTypeNorm,
      selectedRetailer,
      selectedRetailerNorm,
      selectedMonth,
      selectedMonthNorm,
      filteredCount: filtered.length,
      totalRows: rows.length,
    });
  
    return filtered;
  }, [rows, selectedType, selectedRetailer, selectedMonth, search]);

  const handleExportToExcel = () => {
    if (!data.length) {
      alert("No rows to export.");
      return;
    }

    const exportRows = data.map((row) => ({
      Type: row.type,
      Month: row.month,
      "Check Date": row.checkDate || "",
      Invoice: row.invoice,
      UPC: row.upc,
      Item: row.item,
      Customer: row.custName,
      Retailer: row.retailer || "",
      Amount: isWmInvoiceType(row.type) ? row.adjustedAmt : row.amt,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Sets");

    const fileNameParts = ["broker_commission_datasets"];
    if (selectedType !== "All Types") fileNameParts.push(selectedType.replace(/\s+/g, "_"));
    if (selectedRetailer !== "All Retailers") fileNameParts.push(selectedRetailer.replace(/\s+/g, "_"));
    if (selectedMonth !== "All Months") fileNameParts.push(selectedMonth.replace(/\s+/g, "_"));

    XLSX.writeFile(workbook, `${fileNameParts.join("_")}.xlsx`);
  };

  const visibleRowIds = useMemo(() => data.map((row) => row.id), [data]);

  const allVisibleSelected =
    visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedRowIds.includes(id));

  const someVisibleSelected =
    visibleRowIds.some((id) => selectedRowIds.includes(id)) && !allVisibleSelected;

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedRowIds((prev) => prev.filter((id) => !visibleRowIds.includes(id)));
      return;
    }
    setSelectedRowIds((prev) => Array.from(new Set([...prev, ...visibleRowIds])));
  };

  const startEditing = (row: Row) => {
    setMenuRowId(null);
    const shouldEditSelected = selectedRowIds.length > 1 && selectedRowIds.includes(row.id);

    if (shouldEditSelected) {
      const selectedRows = rows.filter((r) => selectedRowIds.includes(r.id));
      const firstRetailer = selectedRows[0]?.retailer ?? "";
      if (["Fresh Thyme", "Kroger", "INFRA & Others", "HEB"].includes(firstRetailer)) {
        setBulkRetailerChoice(firstRetailer);
        setBulkCustomRetailer("");
      } else if (firstRetailer) {
        setBulkRetailerChoice("Add new retailer...");
        setBulkCustomRetailer(firstRetailer);
      } else {
        setBulkRetailerChoice("Fresh Thyme");
        setBulkCustomRetailer("");
      }
      setBulkEditOpen(true);
      return;
    }

    setEditingRowId(row.id);
    if (["Fresh Thyme", "Kroger", "INFRA & Others", "HEB"].includes(row.retailer)) {
      setEditRetailerChoice(row.retailer);
      setCustomRetailer("");
    } else if (row.retailer) {
      setEditRetailerChoice("Add new retailer...");
      setCustomRetailer(row.retailer);
    } else {
      setEditRetailerChoice("Fresh Thyme");
      setCustomRetailer("");
    }
  };

  const cancelEditing = () => {
    setEditingRowId(null);
    setEditRetailerChoice("");
    setCustomRetailer("");
  };

  const cancelBulkEdit = () => {
    setBulkEditOpen(false);
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
  };

  const saveRetailerEdit = async (rowId: string) => {
    const finalRetailer =
      editRetailerChoice === "Add new retailer..."
        ? customRetailer.trim()
        : editRetailerChoice.trim();
    if (!finalRetailer) return;

    setSavingRowId(rowId);
    const { data, error } = await supabase
      .from("retailer_overrides")
      .upsert(
        { dataset_id: rowId, retailer: finalRetailer, updated_at: new Date().toISOString() },
        { onConflict: "dataset_id" }
      )
      .select();

    if (error) {
      console.error("Failed to save retailer override:", error);
      alert(`Failed to save retailer: ${error.message}`);
      setSavingRowId(null);
      return;
    }

    console.log("Saved retailer override:", data);
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, retailer: finalRetailer } : row))
    );
    setSavingRowId(null);
    cancelEditing();
    await loadData();
  };

  const openBulkEdit = () => {
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
    setBulkEditOpen(true);
  };

  const saveBulkRetailerEdit = async () => {
    const finalRetailer =
      bulkRetailerChoice === "Add new retailer..."
        ? bulkCustomRetailer.trim()
        : bulkRetailerChoice.trim();
    if (!finalRetailer || selectedRowIds.length === 0) return;

    setBulkSaving(true);
    const payload = selectedRowIds.map((rowId) => ({
      dataset_id: rowId,
      retailer: finalRetailer,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("retailer_overrides")
      .upsert(payload, { onConflict: "dataset_id" })
      .select();

    if (error) {
      console.error("Failed to save bulk retailer overrides:", error);
      alert(`Failed to save selected retailers: ${error.message}`);
      setBulkSaving(false);
      return;
    }

    console.log("Saved bulk retailer overrides:", data);
    setRows((prev) =>
      prev.map((row) =>
        selectedRowIds.includes(row.id) ? { ...row, retailer: finalRetailer } : row
      )
    );
    setBulkSaving(false);
    setBulkEditOpen(false);
    setSelectedRowIds([]);
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
    await loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Data Sets</h2>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search type, invoice, UPC, item, customer, retailer..."
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-slate-300"
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

          <div className="relative" ref={typeFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setTypeFilterOpen((prev) => !prev);
                setRetailerFilterOpen(false);
                setMonthFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              <Filter className="mr-2 h-4 w-4" />
              {selectedType}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {typeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedType(type);
                      setTypeFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={retailerFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setRetailerFilterOpen((prev) => !prev);
                setTypeFilterOpen(false);
                setMonthFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              {selectedRetailer}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {retailerFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {retailerOptions.map((retailer) => (
                  <button
                    key={retailer}
                    type="button"
                    onClick={() => {
                      setSelectedRetailer(retailer);
                      setRetailerFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {retailer}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={monthFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setMonthFilterOpen((prev) => !prev);
                setTypeFilterOpen(false);
                setRetailerFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              {selectedMonth === "All Months" ? selectedMonth : formatMonthShort(selectedMonth)}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {monthFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {months.map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => {
                      setSelectedMonth(month);
                      setMonthFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {month === "All Months" ? month : formatMonthShort(month)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={handleExportToExcel}
            disabled={!data.length}
          >
            Export to Excel
          </Button>

          <div className="relative" ref={notifRef}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative rounded-2xl"
              onClick={() => setNotifOpen((prev) => !prev)}
              title="Missing invoices from Data Sets"
            >
              <Bell className="h-4 w-4" />
              {missingInvoices.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                  {missingInvoices.length > 99 ? "99+" : missingInvoices.length}
                </span>
              )}
            </Button>
            {notifOpen && (
              <div className="absolute right-0 z-30 mt-2 w-[360px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Missing in Data Sets</p>
                    <p className="text-xs text-slate-500">
                      In Ksolve Invoices / Invoices but not yet in Data Sets
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      missingInvoices.length > 0
                        ? "bg-red-50 text-red-600"
                        : "bg-emerald-50 text-emerald-600"
                    }`}
                  >
                    {missingInvoices.length} missing
                  </span>
                </div>
                <div className="max-h-80 overflow-auto">
                  {missingInvoices.length === 0 ? (
                    <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      All invoices from Ksolve Invoices are already in Data Sets.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                        {missingInvoices.length} invoice{missingInvoices.length > 1 ? "s are" : " is"} still missing from Data Sets.
                      </div>
                      <div className="space-y-1">
                        {missingInvoices.map((invoice) => (
                          <div
                            key={invoice}
                            className="rounded-xl border border-slate-100 px-3 py-2 text-sm text-slate-700"
                          >
                            {invoice}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRowIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-slate-700">
            {selectedRowIds.length} row{selectedRowIds.length > 1 ? "s" : ""} selected
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-2xl" onClick={openBulkEdit}>
              Edit selected
            </Button>
            <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setSelectedRowIds([])}>
              Clear selection
            </Button>
          </div>
        </div>
      )}

      {bulkEditOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Edit retailer for {selectedRowIds.length} selected row{selectedRowIds.length > 1 ? "s" : ""}
            </h3>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <select
              value={bulkRetailerChoice}
              onChange={(e) => setBulkRetailerChoice(e.target.value)}
              className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            >
              {EDITABLE_RETAILERS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {bulkRetailerChoice === "Add new retailer..." && (
              <input
                type="text"
                value={bulkCustomRetailer}
                onChange={(e) => setBulkCustomRetailer(e.target.value)}
                placeholder="Enter retailer"
                className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
              />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="rounded-2xl"
                onClick={saveBulkRetailerEdit}
                disabled={
                  bulkSaving ||
                  !(bulkRetailerChoice &&
                    (bulkRetailerChoice !== "Add new retailer..." || bulkCustomRetailer.trim()))
                }
              >
                {bulkSaving ? "Saving..." : "Save selected"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={cancelBulkEdit}
                disabled={bulkSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-auto rounded-2xl border bg-white" style={{ maxHeight: "70vh" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
            <tr>
              <th className="w-[52px] p-3 text-left">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleSelectAllVisible}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th className="p-3 text-left font-semibold">Type</th>
              <th className="p-3 text-left font-semibold">Month</th>
              <th className="p-3 text-left font-semibold">Invoice</th>
              <th className="p-3 text-left font-semibold">UPC</th>
              <th className="p-3 text-left font-semibold">Item</th>
              <th className="p-3 text-left font-semibold">Customer</th>
              <th className="p-3 text-left font-semibold">Retailer</th>
              <th className="p-3 text-left font-semibold">Amount</th>
              <th className="w-[56px] p-3 text-left font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">
                  Loading data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">
                  No data found.
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const isEditing = editingRowId === row.id;
                const isSaving = savingRowId === row.id;
                const isSelected = selectedRowIds.includes(row.id);

                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRowSelection(row.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="p-3">{row.type}</td>
                    <td className="p-3">
                      {row.checkDate ? formatCheckDate(row.checkDate) : formatMonthShort(row.month)}
                    </td>
                    <td className="p-3 font-medium">{row.invoice}</td>
                    <td className="p-3">{row.upc}</td>
                    <td className="p-3">{row.item}</td>
                    <td className="p-3">{row.custName}</td>
                    <td className="p-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <select
                            value={editRetailerChoice}
                            onChange={(e) => setEditRetailerChoice(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                          >
                            {EDITABLE_RETAILERS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          {editRetailerChoice === "Add new retailer..." && (
                            <input
                              type="text"
                              value={customRetailer}
                              onChange={(e) => setCustomRetailer(e.target.value)}
                              placeholder="Enter retailer"
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                            />
                          )}
                        </div>
                      ) : (
                        row.retailer || "-"
                      )}
                    </td>
                    <td className="p-3">
                      ${(isWmInvoiceType(row.type) ? row.adjustedAmt : row.amt).toFixed(2)}
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={
                              isSaving ||
                              !(editRetailerChoice &&
                                (editRetailerChoice !== "Add new retailer..." || customRetailer.trim()))
                            }
                            onClick={() => saveRetailerEdit(row.id)}
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={cancelEditing}
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="relative"
                          ref={(el) => {
                            actionMenuRefs.current[row.id] = el;
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setMenuRowId((prev) => (prev === row.id ? null : row.id))}
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                            title="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuRowId === row.id && (
                            <div className="absolute right-0 z-20 mt-2 w-32 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                              <button
                                type="button"
                                onClick={() => startEditing(row)}
                                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}