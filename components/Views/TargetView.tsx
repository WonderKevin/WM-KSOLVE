"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Search, Upload } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { readBrowserCache, writeBrowserCache } from "@/lib/browser-cache";

type TargetInvoiceRow = {
  id?: number;
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
  retailer: "target";
};

type DeductionTypeRecord = {
  id?: string;
  document_type: string | null;
  deduction_type: string | null;
};

type ParsedTargetFile = {
  fileName: string;
  checkDate: string | null;
  checkNumber: string | null;
  rows: TargetInvoiceRow[];
  unmappedDocumentTypes: string[];
};

const TARGET_INVOICES_CACHE_KEY = "wmksolve:report-cache:target-invoices";

const DEFAULT_TARGET_DEDUCTION_TYPES: DeductionTypeRecord[] = [
  {
    document_type: "Vendor Income Funding",
    deduction_type: "Target's TPR Funding",
  },
  {
    document_type: "WM Invoice",
    deduction_type: "Target's WM Invoice",
  },
  {
    document_type: "P.O. SHIPPED EARLY/LATE",
    deduction_type: "Target's Distribution (MCB) Allowances",
  },
  {
    document_type: "Assessorial Charges",
    deduction_type: "Target's Distribution (MCB) Allowances",
  },
];

type TargetInvoicesCache = {
  rows: TargetInvoiceRow[];
};

const REASON_PREFIXES = [
  { prefix: "TRT-TR02", description: "Unauthorized Carrier" },
  { prefix: "TRT-TR08", description: "Multiple Shipments" },
  { prefix: "TRT-TR09", description: "Assessorial Charges" },
  { prefix: "TRT-TR10", description: "Truck Ordered Not Used (TONU)" },
  { prefix: "TRT-TR11", description: "Expedited Freight" },
  { prefix: "TRT-TR14", description: "Freight on Returns" },
  { prefix: "TRT-TR15", description: "Domestic Sort and Seg." },
  { prefix: "VCNA", description: "Vendor Income Funding" },
  { prefix: "VCPN", description: "V192-Promotional" },
  { prefix: "VIAP", description: "Vendor Income Funding" },
  { prefix: "VONL", description: "Vendor Income Funding" },
  { prefix: "VSUP", description: "Vendor Income Funding" },
  { prefix: "RTVS8", description: "Return to Vendor" },
  { prefix: "RTVS2", description: "Return To Vendor" },
  { prefix: "VC", description: "P.O. SHIPPED EARLY/LATE" },
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLookupValue(value: unknown) {
  return clean(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseDate(value: unknown) {
  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(
      parsed.d
    ).padStart(2, "0")}`;
  }

  const text = clean(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, mm, dd, yyyy] = match;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function monthFromDate(value: string | null) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.toLocaleDateString("en-US", {
    month: "long",
  })} '${String(date.getFullYear()).slice(-2)}`;
}

function formatMonthLabel(month: string | null | undefined) {
  const value = clean(month);
  if (!value) return null;

  const apostropheMatch = value.match(/^([A-Za-z]+)\s+'?(\d{2})$/);
  if (apostropheMatch) return `${apostropheMatch[1]} '${apostropheMatch[2]}`;

  const longYearMatch = value.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (longYearMatch) return `${longYearMatch[1]} '${longYearMatch[2].slice(-2)}`;

  return value;
}

function monthSortValue(month: string | null) {
  if (!month) return 0;

  const value = formatMonthLabel(month) || "";
  const match = value.match(/^([A-Za-z]+)\s+'?(\d{2})$/);
  const date = match
    ? new Date(`1 ${match[1]} 20${match[2]}`)
    : new Date(`1 ${month}`);
  if (Number.isNaN(date.getTime())) return 0;

  return date.getFullYear() * 100 + date.getMonth() + 1;
}

function toNumber(value: unknown) {
  const original = clean(value);
  const text = original.replace(/[$,]/g, "").replace(/[()]/g, "").trim();

  if (!text) return null;

  const number = Number(text);
  if (Number.isNaN(number)) return null;

  return original.includes("(") && original.includes(")") ? -number : number;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function resolveReasonDescription(docHeaderText: string | null) {
  const doc = clean(docHeaderText).toUpperCase();

  if (/^\d{4}$/.test(doc)) return "WM Invoice";

  const match = REASON_PREFIXES
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((item) => doc.startsWith(item.prefix.toUpperCase()));

  return match?.description || "";
}

function buildDeductionTypeLookup(records: DeductionTypeRecord[]) {
  const map = new Map<string, string>();

  for (const record of [...DEFAULT_TARGET_DEDUCTION_TYPES, ...records]) {
    const documentType = normalizeLookupValue(record.document_type);
    const deductionType = clean(record.deduction_type);

    if (documentType && deductionType) map.set(documentType, deductionType);
  }

  return map;
}

function resolveTargetType(
  documentType: string | null | undefined,
  lookup: Map<string, string>
) {
  const normalizedDocumentType = normalizeLookupValue(documentType);
  if (!normalizedDocumentType) return "";

  const exact = lookup.get(normalizedDocumentType);
  if (exact) return exact;

  for (const [mappedDocumentType, deductionType] of lookup.entries()) {
    if (
      mappedDocumentType.includes(normalizedDocumentType) ||
      normalizedDocumentType.includes(mappedDocumentType)
    ) {
      return deductionType;
    }
  }

  return "";
}

async function fetchDeductionTypes() {
  const { data, error } = await supabase
    .from("deduction_types")
    .select("id, document_type, deduction_type")
    .order("document_type", { ascending: true });

  if (error) {
    console.warn("Failed to load deduction type mappings for Target upload:", error);
    return DEFAULT_TARGET_DEDUCTION_TYPES;
  }

  return (data || []) as DeductionTypeRecord[];
}

function parseDelimitedTargetFile(text: string) {
  return text
    .replace(/\u0000/g, "")
    .split(/\r?\n|\r/)
    .map((line) => line.split("\t").map(clean))
    .filter((row) => row.some(Boolean));
}

async function parseTargetWorkbook(file: File) {
  const buffer = await file.arrayBuffer();

  try {
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: false,
      raw: false,
    });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
  } catch {
    const utf16 = new TextDecoder("utf-16le").decode(buffer);
    return parseDelimitedTargetFile(utf16);
  }
}

function getHeaderIndex(headers: unknown[], names: string[]) {
  const normalized = headers.map(normalizeHeader);

  for (const name of names) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }

  return -1;
}

function getValue(row: unknown[], index: number) {
  if (index < 0) return "";
  return row[index];
}

function findMetadataValue(rows: unknown[][], label: string) {
  const normalizedLabel = normalizeHeader(label);

  for (const row of rows) {
    const index = row.findIndex(
      (cell) => normalizeHeader(cell) === normalizedLabel
    );

    if (index !== -1) return row[index + 1] ?? "";
  }

  return "";
}

async function parseTargetFile(
  file: File,
  deductionTypeLookup: Map<string, string>
): Promise<ParsedTargetFile> {
  const rawRows = await parseTargetWorkbook(file);

  const checkNumber = clean(findMetadataValue(rawRows, "Check Number")) || null;
  const checkDate = parseDate(findMetadataValue(rawRows, "Check Date"));
  const month = monthFromDate(checkDate);

  const headerRowIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "docheadertext")
  );

  if (headerRowIndex === -1) {
    throw new Error(`Could not find Target invoice header row in ${file.name}.`);
  }

  const headers = rawRows[headerRowIndex];

  const docHeaderIndex = getHeaderIndex(headers, ["Doc.Header Text"]);
  const sapDocIndex = getHeaderIndex(headers, ["SAP Doc #"]);
  const docDateIndex = getHeaderIndex(headers, ["Doc Date"]);
  const grossIndex = getHeaderIndex(headers, ["Gross Amount"]);
  const cashDiscountIndex = getHeaderIndex(headers, ["Cash Discount"]);
  const withholdingIndex = getHeaderIndex(headers, ["Withholding Tax Amount"]);
  const netIndex = getHeaderIndex(headers, ["Net Amount"]);

  const unmappedDocumentTypes = new Set<string>();
  const rows: TargetInvoiceRow[] = rawRows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => clean(cell) !== ""))
    .map((row): TargetInvoiceRow => {
      const docHeaderText = clean(getValue(row, docHeaderIndex)) || null;
      const reasonCodeDescription = resolveReasonDescription(docHeaderText);
      const mappedType = resolveTargetType(reasonCodeDescription, deductionTypeLookup);

      if (reasonCodeDescription && !mappedType) {
        unmappedDocumentTypes.add(reasonCodeDescription);
      }

      return {
        month,
        type: mappedType || null,
        check_date: checkDate,
        check_number: checkNumber,
        doc_header_text: docHeaderText,
        reason_code_description: reasonCodeDescription,
        sap_doc_number: clean(getValue(row, sapDocIndex)) || null,
        doc_date: parseDate(getValue(row, docDateIndex)),
        gross_amount: toNumber(getValue(row, grossIndex)),
        cash_discount: toNumber(getValue(row, cashDiscountIndex)),
        withholding_tax_amount: toNumber(getValue(row, withholdingIndex)),
        net_amount: toNumber(getValue(row, netIndex)),
        retailer: "target",
      };
    })
    .filter(
      (row) =>
        row.doc_header_text ||
        row.sap_doc_number ||
        row.gross_amount !== null ||
        row.net_amount !== null
    );

  if (rows.length === 0) {
    throw new Error(`No Target invoice rows found in ${file.name}.`);
  }

  return {
    fileName: file.name,
    checkDate,
    checkNumber,
    rows,
    unmappedDocumentTypes: Array.from(unmappedDocumentTypes).sort((a, b) =>
      a.localeCompare(b)
    ),
  };
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return JSON.stringify(error);
}

function rowMatchesSearch(row: TargetInvoiceRow, searchTerm: string) {
  const search = searchTerm.trim().toLowerCase();

  if (!search) return true;

  const reason =
    row.reason_code_description ||
    resolveReasonDescription(row.doc_header_text) ||
    "Unknown";

  const searchableText = [
    row.month,
    row.type,
    row.check_date,
    row.check_number,
    row.doc_header_text,
    reason,
    row.sap_doc_number,
    row.doc_date,
    row.gross_amount,
    row.cash_discount,
    row.withholding_tax_amount,
    row.net_amount,
    formatCurrency(row.gross_amount),
    formatCurrency(row.cash_discount),
    formatCurrency(row.withholding_tax_amount),
    formatCurrency(row.net_amount),
  ]
    .map((value) => clean(value).toLowerCase())
    .join(" ");

  return searchableText.includes(search);
}

export default function TargetView() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [startupCache] = useState<TargetInvoicesCache | null>(() =>
    readBrowserCache<TargetInvoicesCache>(TARGET_INVOICES_CACHE_KEY)
  );
  const [rows, setRows] = useState<TargetInvoiceRow[]>(() => startupCache?.rows || []);
  const [loading, setLoading] = useState(() => !startupCache);
  const [uploading, setUploading] = useState(false);
  const [unmappedDocumentTypes, setUnmappedDocumentTypes] = useState<string[]>([]);

  const [selectedReason, setSelectedReason] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const loadRows = async (hasCachedData = false) => {
    if (!hasCachedData) setLoading(true);

    try {
      const { data, error } = await supabase
        .from("target_invoices")
        .select("*")
        .order("check_date", { ascending: false });

      if (error) throw error;

      const nextRows = ((data || []) as TargetInvoiceRow[]).map((row) => ({
        ...row,
        month: formatMonthLabel(row.month),
        type: row.type || null,
      }));
      setRows(nextRows);
      writeBrowserCache<TargetInvoicesCache>(TARGET_INVOICES_CACHE_KEY, {
        rows: nextRows,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void loadRows(Boolean(startupCache));
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [startupCache]);

  const existingCheckKeys = useMemo(() => {
    return new Set(
      rows
        .filter((row) => row.check_date && row.check_number)
        .map((row) => `${row.check_date}__${row.check_number}`)
    );
  }, [rows]);

  const monthOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => formatMonthLabel(row.month)).filter(Boolean))
    )
      .sort((a, b) => monthSortValue(b) - monthSortValue(a)) as string[];
  }, [rows]);

  const typeOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.type || "Unmapped").filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const reasonOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map(
            (row) =>
              row.reason_code_description ||
              resolveReasonDescription(row.doc_header_text) ||
              "Unknown"
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const reason =
        row.reason_code_description ||
        resolveReasonDescription(row.doc_header_text) ||
        "Unknown";

      const matchesReason =
        selectedReason === "all" || reason === selectedReason;

      const matchesMonth =
        selectedMonth === "all" || formatMonthLabel(row.month) === selectedMonth;

      const rowType = row.type || "Unmapped";
      const matchesType = selectedType === "all" || rowType === selectedType;

      const matchesSearch = rowMatchesSearch(row, searchTerm);

      return matchesReason && matchesMonth && matchesType && matchesSearch;
    });
  }, [rows, selectedReason, selectedMonth, selectedType, searchTerm]);

  const handleUpload = async (files: FileList) => {
    setUploading(true);

    try {
      const parsedFiles: ParsedTargetFile[] = [];
      const deductionTypes = await fetchDeductionTypes();
      const deductionTypeLookup = buildDeductionTypeLookup(deductionTypes);

      for (const file of Array.from(files)) {
        parsedFiles.push(await parseTargetFile(file, deductionTypeLookup));
      }

      let uploadedCount = 0;
      let skippedCount = 0;
      let replacedCount = 0;
      const uploadUnmappedTypes = new Set<string>();

      for (const parsedFile of parsedFiles) {
        for (const unmappedType of parsedFile.unmappedDocumentTypes) {
          uploadUnmappedTypes.add(unmappedType);
        }

        const checkKey =
          parsedFile.checkDate && parsedFile.checkNumber
            ? `${parsedFile.checkDate}__${parsedFile.checkNumber}`
            : "";

        const exists = checkKey ? existingCheckKeys.has(checkKey) : false;

        if (exists) {
          const shouldReplace = window.confirm(
            `A Target invoice already exists for Check # ${parsedFile.checkNumber} dated ${parsedFile.checkDate}.\n\nFile: ${parsedFile.fileName}\n\nDo you want to replace it?`
          );

          if (!shouldReplace) {
            skippedCount += parsedFile.rows.length;
            continue;
          }

          const { error: deleteError } = await supabase
            .from("target_invoices")
            .delete()
            .eq("check_number", parsedFile.checkNumber)
            .eq("check_date", parsedFile.checkDate);

          if (deleteError) throw deleteError;

          replacedCount += parsedFile.rows.length;
        }

        const { error: insertError } = await supabase
          .from("target_invoices")
          .insert(parsedFile.rows);

        if (insertError) throw insertError;

        uploadedCount += parsedFile.rows.length;
      }

      await loadRows();
      const nextUnmappedTypes = Array.from(uploadUnmappedTypes).sort((a, b) =>
        a.localeCompare(b)
      );
      setUnmappedDocumentTypes(nextUnmappedTypes);

      const unmappedMessage = nextUnmappedTypes.length
        ? `\n\nUnmapped document types:\n${nextUnmappedTypes
            .map((item) => `- ${item}`)
            .join("\n")}\n\nAdd these under Database > Deduction Type Mapping.`
        : "";

      alert(
        `Upload complete.\n\nUploaded rows: ${uploadedCount}\nReplaced rows: ${replacedCount}\nSkipped rows: ${skippedCount}${unmappedMessage}`
      );
    } catch (error) {
      console.error(error);
      alert(getUploadErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.gross += Number(row.gross_amount || 0);
        acc.cashDiscount += Number(row.cash_discount || 0);
        acc.withholding += Number(row.withholding_tax_amount || 0);
        acc.net += Number(row.net_amount || 0);
        return acc;
      },
      {
        gross: 0,
        cashDiscount: 0,
        withholding: 0,
        net: 0,
      }
    );
  }, [filteredRows]);

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Target Invoices
            </h2>
            <p className="text-sm text-slate-500">
              Upload one or multiple Target remittance files and save them to
              Supabase.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Search
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search any word or number..."
                    className="min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 pl-9 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Month
                </label>
                <select
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Type
                </label>
                <select
                  value={selectedType}
                  onChange={(event) => setSelectedType(event.target.value)}
                  className="min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Reason Code Description
                </label>
                <select
                  value={selectedReason}
                  onChange={(event) => setSelectedReason(event.target.value)}
                  className="min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  {reasonOptions.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = event.target.files;
                  if (files && files.length > 0) handleUpload(files);
                }}
              />

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? "Uploading..." : "Upload Target Files"}
              </Button>
            </div>

            <p className="text-xs text-slate-500">
              Showing {filteredRows.length} of {rows.length} rows
            </p>
          </div>
        </CardContent>
      </Card>

      {unmappedDocumentTypes.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-semibold">
            Target upload has unmapped document types.
          </div>
          <div className="mt-1">
            Add these under Database &gt; Deduction Type Mapping:
            {" "}
            {unmappedDocumentTypes.join(", ")}
          </div>
        </div>
      )}

      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-5 pt-6">
          {loading ? (
            <p className="text-sm text-slate-500">
              Loading Target invoices...
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Doc.Header Text</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Reason Code Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">SAP Doc #</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Doc Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Gross Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Cash Discount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Withholding Tax Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Net Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={12}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No Target invoices found.
                      </td>
                    </tr>
                  )}

                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatMonthLabel(row.month)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.type || "Unmapped"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{row.check_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.check_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.doc_header_text}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.reason_code_description ||
                          resolveReasonDescription(row.doc_header_text)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{row.sap_doc_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.doc_date}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.gross_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.cash_discount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.withholding_tax_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(row.net_amount)}
                      </td>
                    </tr>
                  ))}

                  {filteredRows.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-4 py-3" colSpan={8}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.gross)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.cashDiscount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.withholding)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.net)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
