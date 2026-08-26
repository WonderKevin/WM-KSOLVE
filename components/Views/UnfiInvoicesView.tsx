"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { readBrowserCache, writeBrowserCache } from "@/lib/browser-cache";

type WorksheetRow = unknown[];

type UnfiInvoiceRow = {
  id?: number;
  month: string;
  type: string;
  check_date: string | null;
  check_number: string;
  invoice_date: string | null;
  invoice_number: string;
  description: string;
  gross_amount: number | null;
  discount_amount: number | null;
  net_amount: number | null;
  source_file_name: string;
  source_file_type: string;
  line_number: number;
  created_at?: string;
};

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

type PdfTextContent = {
  items: PdfTextItem[];
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<PdfTextContent>;
  }>;
};

type PdfJsLib = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocumentProxy> };
};

type ParsedCheckInfo = {
  checkDate: string | null;
  checkNumber: string;
};

const PAGE_SIZE = 1000;
const UNFI_INVOICES_CACHE_KEY = "wmksolve:report-cache:unfi-invoices";
const UNFI_WM_INVOICE_TYPE = "UNFI's WM Invoice";
const UNFI_MCB_TYPE = "UNFI's Distribution (MCB) Allowances";
const UNFI_TYPE_OPTIONS = [UNFI_WM_INVOICE_TYPE, UNFI_MCB_TYPE] as const;

type UnfiInvoicesCache = {
  rows: UnfiInvoiceRow[];
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeMonthLabel(value: string | null | undefined) {
  return clean(value).replace(/[\u2019`]/g, "'");
}

function getMonthSortValue(value: string | null | undefined) {
  const normalized = normalizeMonthLabel(value);
  const shortMatch = normalized.match(/^([A-Za-z]+)\s+'(\d{2})$/);

  if (shortMatch) {
    const monthIndex = new Date(`${shortMatch[1]} 1, 2000`).getMonth();
    if (Number.isNaN(monthIndex)) return -Infinity;
    return (2000 + Number(shortMatch[2])) * 100 + monthIndex + 1;
  }

  const longMatch = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (longMatch) {
    const monthIndex = new Date(`${longMatch[1]} 1, 2000`).getMonth();
    if (Number.isNaN(monthIndex)) return -Infinity;
    return Number(longMatch[2]) * 100 + monthIndex + 1;
  }

  return -Infinity;
}

function compareMonthLabelsDesc(a: string, b: string) {
  return getMonthSortValue(b) - getMonthSortValue(a);
}

function getHeaderIndex(headers: WorksheetRow, names: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const name of names) {
    const index = normalizedHeaders.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }

  return -1;
}

function getValue(row: WorksheetRow, index: number) {
  if (index < 0) return "";
  return row[index];
}

function parseNumber(value: unknown) {
  const original = clean(value).replace(/[\u2212\u2013\u2014]/g, "-");
  if (!original || /^-+$/.test(original)) return null;

  const text = original
    .replace(/[$,*#%]/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .trim();

  if (!text || /^-+$/.test(text)) return null;

  const number = Number(text.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(number)) return null;

  return original.includes("(") && original.includes(")") ? -Math.abs(number) : number;
}

function isAmountToken(value: string) {
  return /[0-9,]+\.\d{2}/.test(value) && parseNumber(value) != null;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatValidIsoDate(year: number, month: number, day: number) {
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    return formatValidIsoDate(parsed.y, parsed.m, parsed.d);
  }

  const text = clean(value);
  if (!text || /^-+$/.test(text)) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\b|T)/);
  if (isoMatch) {
    return formatValidIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3])
    );
  }

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (slashMatch) {
    const year =
      slashMatch[3].length === 2 ? Number(`20${slashMatch[3]}`) : Number(slashMatch[3]);

    return formatValidIsoDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  return null;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;

  return value;
}

function monthLabelFromDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return "";

  return `${date.toLocaleString("en-US", { month: "long" })} '${String(date.getFullYear()).slice(-2)}`;
}

function getFileType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (["xlsx", "xls", "csv"].includes(extension)) return "excel";
  if (extension === "pdf") return "pdf";
  return extension || "file";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
}

function getUnfiType(invoiceNumber: string, description: string) {
  const normalizedDescription = normalizeHeader(description);

  if (normalizedDescription.includes("mcbchargeback")) {
    return UNFI_MCB_TYPE;
  }

  if (/^\d+$/.test(clean(invoiceNumber))) {
    return UNFI_WM_INVOICE_TYPE;
  }

  return normalizedDescription.includes("chargeback") ? UNFI_MCB_TYPE : UNFI_WM_INVOICE_TYPE;
}

function extractCheckInfoFromText(text: string): ParsedCheckInfo {
  const normalized = text.replace(/\u00a0/g, " ");
  const pairedCheckMatch = normalized.match(
    /CHECK\s*DATE\s+CHECK\s*NUMBER[\s\S]*?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+([0-9]{4,})/i
  );
  const directCheckNumber =
    normalized.match(/CHECK\s*NUMBER\s*:?\s*#?\s*([0-9]{4,})/i)?.[1] ||
    normalized.match(/\bCHECK\s*#\s*:?\s*([0-9]{4,})/i)?.[1] ||
    "";
  const directCheckDate =
    normalized.match(/CHECK\s*DATE\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] ||
    null;

  return {
    checkDate: parseDate(pairedCheckMatch?.[1] || directCheckDate),
    checkNumber: pairedCheckMatch?.[2] || directCheckNumber,
  };
}

function parseUnfiTextLine(
  line: string,
  checkInfo: ParsedCheckInfo,
  fileName: string,
  fileType: string,
  lineNumber: number
): UnfiInvoiceRow | null {
  const cleanedLine = clean(line);
  if (!cleanedLine) return null;
  if (/vendor\s+no|total\s+paid|bank\s+of\s+america|void\s+after/i.test(cleanedLine)) {
    return null;
  }

  const tokens = cleanedLine.split(/\s+/).filter(Boolean);
  if (tokens.length < 5) return null;

  const invoiceDate = parseDate(tokens[0]);
  if (!invoiceDate) return null;

  const invoiceNumber = clean(tokens[1]);
  const amountIndexes = tokens.reduce<number[]>((indexes, token, index) => {
    if (index > 1 && isAmountToken(token)) indexes.push(index);
    return indexes;
  }, []);

  if (amountIndexes.length < 3) return null;

  const firstAmountIndex = amountIndexes[0];
  const description = clean(tokens.slice(2, firstAmountIndex).join(" "));
  const grossAmount = parseNumber(tokens[amountIndexes[0]]);
  const discountAmount = parseNumber(tokens[amountIndexes[1]]);
  const netAmount = parseNumber(tokens[amountIndexes[2]]);
  const checkDate = checkInfo.checkDate;

  if (!checkDate) {
    throw new Error(`Could not find Check Date in ${fileName}.`);
  }

  return {
    month: monthLabelFromDate(checkDate),
    type: getUnfiType(invoiceNumber, description),
    check_date: checkDate,
    check_number: checkInfo.checkNumber,
    invoice_date: invoiceDate,
    invoice_number: invoiceNumber,
    description,
    gross_amount: grossAmount,
    discount_amount: discountAmount,
    net_amount: netAmount,
    source_file_name: fileName,
    source_file_type: fileType,
    line_number: lineNumber,
  } satisfies UnfiInvoiceRow;
}

function parseUnfiText(text: string, fileName: string, fileType: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter(Boolean);
  const checkInfo = extractCheckInfoFromText(text);

  if (!checkInfo.checkDate) {
    throw new Error(`Could not find Check Date in ${fileName}.`);
  }

  const headerIndex = lines.findIndex((line, index) => {
    const normalized = normalizeHeader(
      [line, lines[index + 1] || "", lines[index + 2] || ""].join(" ")
    );

    return (
      normalized.includes("invoicedate") &&
      normalized.includes("invoicenumber") &&
      normalized.includes("grossamount") &&
      normalized.includes("discountamount") &&
      normalized.includes("netamount")
    );
  });

  if (headerIndex === -1) {
    throw new Error(`Could not find the UNFI invoice table header in ${fileName}.`);
  }

  return lines
    .slice(headerIndex + 1)
    .map((line, index) =>
      parseUnfiTextLine(line, checkInfo, fileName, fileType, headerIndex + index + 2)
    )
    .filter((row): row is UnfiInvoiceRow => Boolean(row));
}

function parseUnfiWorksheet(rawRows: WorksheetRow[], fileName: string) {
  const fullText = rawRows.map((row) => row.map(clean).join(" ")).join("\n");
  const fallbackCheckInfo = extractCheckInfoFromText(fullText);
  const headerRowIndex = rawRows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.includes("invoicedate") &&
      normalized.includes("invoicenumber") &&
      normalized.includes("grossamount") &&
      normalized.includes("discountamount") &&
      normalized.includes("netamount")
    );
  });

  if (headerRowIndex === -1) {
    throw new Error(`Could not find the UNFI invoice table header in ${fileName}.`);
  }

  const headers = rawRows[headerRowIndex];
  const checkDateIndex = getHeaderIndex(headers, ["Check Date"]);
  const checkNumberIndex = getHeaderIndex(headers, ["Check Number", "Check #"]);
  const invoiceDateIndex = getHeaderIndex(headers, ["Invoice Date"]);
  const invoiceNumberIndex = getHeaderIndex(headers, ["Invoice Number", "Invoice #"]);
  const descriptionIndex = getHeaderIndex(headers, ["Description"]);
  const grossAmountIndex = getHeaderIndex(headers, ["Gross Amount"]);
  const discountAmountIndex = getHeaderIndex(headers, ["Discount Amount"]);
  const netAmountIndex = getHeaderIndex(headers, ["Net Amount"]);

  if (invoiceDateIndex === -1 || invoiceNumberIndex === -1 || netAmountIndex === -1) {
    throw new Error(`Missing required UNFI invoice columns in ${fileName}.`);
  }

  const parsedRows: UnfiInvoiceRow[] = [];
  const fileType = getFileType(fileName);

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => clean(cell))) return;

    const checkDate =
      parseDate(getValue(row, checkDateIndex)) || fallbackCheckInfo.checkDate;
    const checkNumber =
      clean(getValue(row, checkNumberIndex)) || fallbackCheckInfo.checkNumber;
    const invoiceDate = parseDate(getValue(row, invoiceDateIndex));
    const invoiceNumber = clean(getValue(row, invoiceNumberIndex));
    const description = clean(getValue(row, descriptionIndex));
    const grossAmount = parseNumber(getValue(row, grossAmountIndex));
    const discountAmount = parseNumber(getValue(row, discountAmountIndex));
    const netAmount = parseNumber(getValue(row, netAmountIndex));

    if (!checkDate) {
      throw new Error(`Could not find Check Date in ${fileName}.`);
    }

    if (
      !invoiceDate &&
      !invoiceNumber &&
      !description &&
      grossAmount == null &&
      discountAmount == null &&
      netAmount == null
    ) {
      return;
    }

    parsedRows.push({
      month: monthLabelFromDate(checkDate),
      type: getUnfiType(invoiceNumber, description),
      check_date: checkDate,
      check_number: checkNumber,
      invoice_date: invoiceDate,
      invoice_number: invoiceNumber,
      description,
      gross_amount: grossAmount,
      discount_amount: discountAmount,
      net_amount: netAmount,
      source_file_name: fileName,
      source_file_type: fileType,
      line_number: headerRowIndex + index + 2,
    });
  });

  return parsedRows;
}

async function extractTextFromPdf(file: File) {
  const pdfjsLib = (await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  )) as unknown as PdfJsLib;

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const spansByLine = new Map<number, Array<{ x: number; text: string }>>();

    for (const item of textContent.items) {
      if (!item.str?.trim()) continue;

      const y = Math.round(item.transform?.[5] ?? 0);
      const x = item.transform?.[4] ?? 0;
      const bucket = Math.round(y / 3) * 3;

      if (!spansByLine.has(bucket)) spansByLine.set(bucket, []);
      spansByLine.get(bucket)!.push({ x, text: item.str });
    }

    pageTexts.push(
      Array.from(spansByLine.keys())
        .sort((a, b) => b - a)
        .map((bucket) =>
          spansByLine
            .get(bucket)!
            .sort((a, b) => a.x - b.x)
            .map((span) => span.text)
            .join(" ")
        )
        .join("\n")
    );
  }

  return pageTexts.join("\n");
}

async function parseUnfiFile(file: File) {
  const fileType = getFileType(file.name);

  if (fileType === "excel") {
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: false,
      raw: false,
    });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<WorksheetRow>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    return parseUnfiWorksheet(rawRows, file.name);
  }

  if (fileType === "pdf") {
    return parseUnfiText(await extractTextFromPdf(file), file.name, fileType);
  }

  throw new Error(`${file.name}: upload an Excel, CSV, or PDF file.`);
}

async function fetchAllUnfiRows() {
  let from = 0;
  let allRows: UnfiInvoiceRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("unfi_invoices")
      .select("*")
      .order("check_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as UnfiInvoiceRow[];
    allRows = [...allRows, ...batch];

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export default function UnfiInvoicesView() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [startupCache] = useState<UnfiInvoicesCache | null>(() =>
    readBrowserCache<UnfiInvoicesCache>(UNFI_INVOICES_CACHE_KEY)
  );
  const [rows, setRows] = useState<UnfiInvoiceRow[]>(() => startupCache?.rows || []);
  const [loading, setLoading] = useState(() => !startupCache);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUploadBox, setShowUploadBox] = useState(false);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("All Months");
  const [typeFilter, setTypeFilter] = useState("All Types");

  const loadRows = async (hasCachedData = false) => {
    try {
      if (!hasCachedData) setLoading(true);
      setLoadError("");
      const data = await fetchAllUnfiRows();
      setRows(data);
      writeBrowserCache<UnfiInvoicesCache>(UNFI_INVOICES_CACHE_KEY, { rows: data });
    } catch (error: unknown) {
      console.error("Failed to load unfi_invoices:", error);
      const message = getErrorMessage(error, "Failed to load UNFI invoices.");
      setLoadError(
        message.includes("Could not find the table")
          ? "Supabase table public.unfi_invoices is not available yet."
          : message
      );
      if (!hasCachedData) setRows([]);
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

  const typeOptions = useMemo(() => {
    const options = new Set<string>(UNFI_TYPE_OPTIONS);

    for (const row of rows) {
      const type = clean(row.type);
      if (type) options.add(type);
    }

    return Array.from(options);
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const dateCompare = clean(b.check_date).localeCompare(clean(a.check_date));
      if (dateCompare !== 0) return dateCompare;

      const checkCompare = clean(b.check_number).localeCompare(clean(a.check_number));
      if (checkCompare !== 0) return checkCompare;

      return Number(a.line_number || 0) - Number(b.line_number || 0);
    });
  }, [rows]);

  const monthOptions = useMemo(
    () => [
      "All Months",
      ...Array.from(new Set(rows.map((row) => normalizeMonthLabel(row.month)).filter(Boolean))).sort(
        compareMonthLabelsDesc
      ),
    ],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedMonth = normalizeMonthLabel(monthFilter);

    return sortedRows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowType = clean(row.type);
      const matchesMonth = selectedMonth === "All Months" || rowMonth === selectedMonth;
      const matchesType = typeFilter === "All Types" || rowType === typeFilter;
      const matchesSearch =
        !q ||
        [
          rowMonth,
          rowType,
          row.check_date,
          row.check_number,
          row.invoice_date,
          row.invoice_number,
          row.description,
          row.gross_amount,
          row.discount_amount,
          row.net_amount,
          row.source_file_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      return matchesMonth && matchesType && matchesSearch;
    });
  }, [sortedRows, search, monthFilter, typeFilter]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.rows += 1;
          acc.netAmount += Number(row.net_amount || 0);
          acc.checks.add(`${row.check_number}__${row.check_date}`);
          return acc;
        },
        { rows: 0, netAmount: 0, checks: new Set<string>() }
      ),
    [filteredRows]
  );

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;

    try {
      setUploading(true);
      const files = Array.from(fileList);
      let uploadedCount = 0;

      for (const file of files) {
        const parsedRows = await parseUnfiFile(file);

        if (!parsedRows.length) {
          alert(`No UNFI invoice rows were parsed from ${file.name}.`);
          continue;
        }

        const existingForFile = rows.some((row) => clean(row.source_file_name) === file.name);

        if (existingForFile) {
          const shouldReplace = window.confirm(
            `UNFI invoice data already exists from ${file.name}.\n\nDo you want to replace it?`
          );

          if (!shouldReplace) continue;

          const { error: deleteError } = await supabase
            .from("unfi_invoices")
            .delete()
            .eq("source_file_name", file.name);

          if (deleteError) throw deleteError;
        }

        for (let index = 0; index < parsedRows.length; index += 1000) {
          const chunk = parsedRows.slice(index, index + 1000);
          const { error: insertError } = await supabase.from("unfi_invoices").insert(chunk);
          if (insertError) throw insertError;
        }

        uploadedCount += parsedRows.length;
      }

      await loadRows();
      setShowUploadBox(false);

      if (uploadedCount) {
        alert(`${uploadedCount.toLocaleString()} UNFI invoice rows uploaded successfully.`);
      }
    } catch (error: unknown) {
      alert(getErrorMessage(error, "UNFI invoice upload failed."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleExportToExcel = () => {
    if (!filteredRows.length) {
      alert("No rows to export.");
      return;
    }

    const exportRows = filteredRows.map((row) => ({
      Month: normalizeMonthLabel(row.month),
      Type: row.type,
      "Check Date": formatDisplayDate(row.check_date),
      "Check #": row.check_number,
      "Invoice Date": formatDisplayDate(row.invoice_date),
      "Invoice Number": row.invoice_number,
      Description: row.description,
      "Gross Amount": row.gross_amount,
      "Discount Amount": row.discount_amount,
      "Net Amount": row.net_amount,
      "Source File Name": row.source_file_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "UNFI Invoices");

    const fileNameParts = ["unfi_invoices"];
    if (monthFilter !== "All Months") {
      fileNameParts.push(normalizeMonthLabel(monthFilter).replace(/\s+/g, "_").replace(/'/g, ""));
    }

    XLSX.writeFile(workbook, `${fileNameParts.join("_")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">UNFI Invoices</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload UNFI remittance files and review rows from the check detail.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search check, invoice, description"
                  className="rounded-2xl pl-10 pr-10"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <select
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="All Types">All Types</option>
                {typeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={handleExportToExcel}
                disabled={!filteredRows.length}
              >
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={() => setShowUploadBox((prev) => !prev)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Data
              </Button>
            </div>
          </div>

          {showUploadBox && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  UNFI Invoice File
                </label>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls,.pdf"
                  onChange={(event) => void handleUpload(event.target.files)}
                  disabled={uploading}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rows</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{totals.rows.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Checks</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{totals.checks.size.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Net Amount</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(totals.netAmount)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading UNFI invoices...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            {loadError}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No UNFI invoice rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check #</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice Number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Gross Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Discount Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Net Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr
                      key={row.id || `${row.source_file_name}-${row.line_number}-${index}`}
                      className="border-t border-slate-200 bg-white"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{normalizeMonthLabel(row.month)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{clean(row.type) || UNFI_WM_INVOICE_TYPE}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.check_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.check_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.invoice_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.invoice_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatCurrency(row.gross_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatCurrency(row.discount_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(row.net_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
