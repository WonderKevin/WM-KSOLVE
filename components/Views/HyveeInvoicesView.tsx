"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileImage, Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { readBrowserCache, writeBrowserCache } from "@/lib/browser-cache";

type WorksheetRow = unknown[];

type HyveeInvoiceRow = {
  id?: number;
  month: string;
  type: string;
  check_number: string;
  check_date: string | null;
  check_amount: number | null;
  invoice_number: string;
  invoice_date: string | null;
  gross_amount: number | null;
  discount_amount: number | null;
  adjustment_amount: number | null;
  memo_code: string;
  net_amount: number | null;
  explanation: string;
  source_file_name: string;
  source_file_type: string;
  source_file_path?: string | null;
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

type PdfViewport = {
  width: number;
  height: number;
};

type PdfPageProxy = {
  getTextContent(): Promise<PdfTextContent>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): { promise: Promise<void> };
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
};

type PdfJsLib = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocumentProxy> };
};

type ParsedCheckInfo = {
  checkNumber: string;
  checkDate: string | null;
  checkAmount: number | null;
};

const PAGE_SIZE = 1000;
const DOCUMENT_BUCKET = "ksolve-documents";
const HYVEE_INVOICES_CACHE_KEY = "wmksolve:report-cache:hyvee-invoices";
const HYVEE_TYPE_OPTIONS = [
  "Hy-Vee WM Invoice",
  "Hy-Vee EDLC Allowances",
  "Hy-Vee Ad Fees",
  "Hy-Vee Distribution (MCB) Allowances",
  "Hy-Vee Customer Spoils Allowance",
  "Hy-Vee Introduction Allowances",
  "Hy-Vee TPR Funding",
  "Hy-Vee Scan Allowance",
  "Hy-Vee Promo & Placement Funds",
  "Hy-Vee Slotting Fees",
  "Hy-Vee Display Fees",
  "Hy-Vee New Item Setup Fee",
] as const;
const HYVEE_DEFAULT_TYPE = "Hy-Vee EDLC Allowances";

type HyveeInvoicesCache = {
  rows: HyveeInvoiceRow[];
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

function normalizeInvoiceNumber(value: unknown) {
  const text = clean(value);
  if (!/^\d+$/.test(text)) return text;

  return text.replace(/^0+(?=\d)/, "");
}

function getHeaderIndex(headers: WorksheetRow, names: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const name of names) {
    const index = normalizedHeaders.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }

  return -1;
}

function getMemoCodeHeaderIndex(headers: WorksheetRow) {
  const exactIndex = headers.findIndex((header) => clean(header) === "**");
  if (exactIndex !== -1) return exactIndex;

  return getHeaderIndex(headers, ["Code", "Memo Code"]);
}

function getValue(row: WorksheetRow, index: number) {
  if (index < 0) return "";
  return row[index];
}

function parseNumber(value: unknown) {
  const original = clean(value).replace(/[−–—]/g, "-");
  const normalizedOriginal = original.replace(/[\u2212\u2013\u2014]/g, "-");
  if (!normalizedOriginal || /^-+$/.test(normalizedOriginal)) return null;

  const text = normalizedOriginal
    .replace(/[$,*#]/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .trim();

  if (!text || /^-+$/.test(text)) return null;

  const number = Number(text);
  if (Number.isNaN(number)) return null;

  return normalizedOriginal.includes("(") && normalizedOriginal.includes(")")
    ? -Math.abs(number)
    : number;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

  const monthNameMatch = text.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/i
  );
  if (monthNameMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const month = monthNames.indexOf(monthNameMatch[1].slice(0, 3).toLowerCase()) + 1;
    const year =
      monthNameMatch[3].length === 2
        ? Number(`20${monthNameMatch[3]}`)
        : Number(monthNameMatch[3]);

    return formatValidIsoDate(year, month, Number(monthNameMatch[2]));
  }

  return null;
}

function monthNameFromDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-US", { month: "long" });
}

function getMonthSortValue(value: string) {
  const monthIndex = new Date(`${value} 1, 2026`).getMonth();
  return Number.isNaN(monthIndex) ? -Infinity : monthIndex + 1;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;

  return value;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function getFileType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (["xlsx", "xls", "csv"].includes(extension)) return "excel";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff"].includes(extension)) {
    return "image";
  }
  return extension || "file";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
}

function sanitizeStorageSegment(value: string) {
  return clean(value)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function uploadHyveeSourceFile(file: File) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storagePath = `hyvee-invoices/${new Date().toISOString().slice(0, 10)}/${randomId}-${sanitizeStorageSegment(file.name) || "source-file"}`;
  const { error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || undefined,
      upsert: false,
    });

  if (error) throw error;
  return storagePath;
}

function extractCheckInfoFromText(text: string): ParsedCheckInfo {
  const normalized = text.replace(/\u00a0/g, " ");
  const checkNumber =
    normalized.match(/CHECK\s*NUMBER\s*:?\s*#?\s*([0-9]+)/i)?.[1] ||
    normalized.match(/\bCHECK\s*#\s*:?\s*([0-9]+)/i)?.[1] ||
    "";
  const rawCheckDate =
    normalized.match(/CHECK\s*DATE\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.[1] ||
    null;
  const checkAmount =
    parseNumber(
      normalized.match(/\$\s*\*+\s*([0-9,]+\.\d{2})/i)?.[1] || ""
    ) ??
    parseNumber(
      normalized.match(/\b([0-9,]+\.\d{2})\s*(?:\n|$)/)?.[1] || ""
    );

  return {
    checkNumber,
    checkDate: parseDate(rawCheckDate),
    checkAmount,
  };
}

function amountTokenIndexes(tokens: string[]) {
  return tokens.reduce<number[]>((indexes, token, index) => {
    if (parseNumber(token) != null) indexes.push(index);
    return indexes;
  }, []);
}

function findDateMatchInLine(line: string) {
  const match = line.match(
    /(^|\s)(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})(?=\s|$|[^\d])/
  );

  if (!match || match.index === undefined) return null;

  const rawDate = match[2];
  const parsedDate = parseDate(rawDate);
  if (!parsedDate) return null;

  const startIndex = match.index + match[1].length;

  return {
    rawDate,
    parsedDate,
    beforeDate: clean(line.slice(0, startIndex)),
    afterDate: clean(line.slice(startIndex + rawDate.length)),
  };
}

function parseHyveeTextLine(
  line: string,
  checkInfo: ParsedCheckInfo,
  fileName: string,
  fileType: string,
  selectedType: string,
  lineNumber: number,
  fallbackInvoiceNumber: string,
  fallbackInvoiceDate: string | null
) {
  const cleanedLine = clean(line);
  const normalizedLine = normalizeHeader(cleanedLine);

  if (!cleanedLine) return null;
  if (/amount\s*=\s*amount\s*bsr/i.test(cleanedLine)) return null;
  if (
    normalizedLine.includes("grossamount") ||
    normalizedLine.includes("discountamount") ||
    normalizedLine.includes("adjustmentamount")
  ) {
    return null;
  }

  const tokens = cleanedLine.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let invoiceNumber = "";
  let invoiceDate: string | null = null;
  let valueTokens = tokens;
  const lineDateMatch = findDateMatchInLine(cleanedLine);

  if (lineDateMatch) {
    invoiceNumber = normalizeInvoiceNumber(lineDateMatch.beforeDate);
    invoiceDate = lineDateMatch.parsedDate;
    valueTokens = lineDateMatch.afterDate.split(/\s+/).filter(Boolean);
  } else {
    const dateIndex = tokens.findIndex((token) => parseDate(token));

    if (dateIndex >= 0) {
      invoiceNumber = normalizeInvoiceNumber(tokens.slice(0, dateIndex).join(" "));
      invoiceDate = parseDate(tokens[dateIndex]);
      valueTokens = tokens.slice(dateIndex + 1);
    }
  }

  const indexes = amountTokenIndexes(valueTokens);
  if (!indexes.length) return null;

  const netIndex = indexes[indexes.length - 1];
  const netAmount = parseNumber(valueTokens[netIndex]);
  const beforeNet = valueTokens.slice(0, netIndex);
  const afterNet = valueTokens.slice(netIndex + 1);
  const memoCode =
    [...beforeNet].reverse().find((token) => /^[A-Z]{1,4}$/.test(token)) || "";
  const numericBefore = beforeNet
    .map((token) => parseNumber(token))
    .filter((value): value is number => value != null);
  const explanation = afterNet.join(" ");

  if (
    !invoiceNumber &&
    !invoiceDate &&
    !memoCode &&
    !explanation &&
    indexes.length >= 3
  ) {
    return null;
  }

  if (!invoiceNumber) invoiceNumber = fallbackInvoiceNumber;
  if (!invoiceDate) invoiceDate = fallbackInvoiceDate;

  let grossAmount: number | null = null;
  let discountAmount: number | null = null;
  let adjustmentAmount: number | null = null;

  if (memoCode === "CD") {
    discountAmount = numericBefore[numericBefore.length - 1] ?? null;
  } else if (memoCode === "BB") {
    adjustmentAmount = numericBefore[numericBefore.length - 1] ?? null;
  } else {
    grossAmount = numericBefore[0] ?? null;
    discountAmount = numericBefore[1] ?? null;
    adjustmentAmount = numericBefore[2] ?? null;
  }

  return {
    month: monthNameFromDate(checkInfo.checkDate),
    type: selectedType,
    check_number: checkInfo.checkNumber,
    check_date: checkInfo.checkDate,
    check_amount: checkInfo.checkAmount,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    gross_amount: grossAmount,
    discount_amount: discountAmount,
    adjustment_amount: adjustmentAmount,
    memo_code: memoCode,
    net_amount: netAmount,
    explanation,
    source_file_name: fileName,
    source_file_type: fileType,
    line_number: lineNumber,
  } satisfies HyveeInvoiceRow;
}

function finalizeParsedRows(rows: HyveeInvoiceRow[], checkAmount: number | null) {
  const computedRowTotal = round2(
    rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
  );
  const computedCheckAmount =
    checkAmount == null || Math.abs(Math.abs(checkAmount) - Math.abs(computedRowTotal)) > 0.5
      ? computedRowTotal
      : checkAmount;

  return rows.map((row) => ({
    ...row,
    check_amount: computedCheckAmount,
  }));
}

function sanitizeHyveeRowsForInsert(rows: HyveeInvoiceRow[]) {
  return rows.map((row) => ({
    ...row,
    check_date: parseDate(row.check_date),
    invoice_date: parseDate(row.invoice_date),
  }));
}

function isNoiseRow(row: HyveeInvoiceRow) {
  return /amount\s*=\s*amount\s*bsr/i.test(row.explanation || "");
}

function parseHyveeText(text: string, fileName: string, fileType: string, selectedType: string) {
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
      normalized.includes("invoicenumber") &&
      normalized.includes("invoicedate") &&
      normalized.includes("netamount")
    );
  });

  if (headerIndex === -1) {
    throw new Error(`Could not find the Hy-Vee invoice table header in ${fileName}.`);
  }

  const parsedRows: HyveeInvoiceRow[] = [];
  let currentInvoiceNumber = "";
  let currentInvoiceDate: string | null = null;

  lines.slice(headerIndex + 1).forEach((line, index) => {
    if (/vendor\s+name|check\s+number|invoice\s+number/i.test(line)) return;

    const parsed = parseHyveeTextLine(
      line,
      checkInfo,
      fileName,
      fileType,
      selectedType,
      headerIndex + index + 2,
      currentInvoiceNumber,
      currentInvoiceDate
    );

    if (!parsed) return;
    if (parsed.invoice_number) currentInvoiceNumber = parsed.invoice_number;
    if (parsed.invoice_date) currentInvoiceDate = parsed.invoice_date;
    parsedRows.push(parsed);
  });

  return finalizeParsedRows(parsedRows, checkInfo.checkAmount);
}

function parseHyveeWorksheet(rawRows: WorksheetRow[], fileName: string, selectedType: string) {
  const fullText = rawRows.map((row) => row.map(clean).join(" ")).join("\n");
  const checkInfo = extractCheckInfoFromText(fullText);

  if (!checkInfo.checkDate) {
    throw new Error(`Could not find Check Date in ${fileName}.`);
  }

  const headerRowIndex = rawRows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.includes("invoicenumber") &&
      normalized.includes("invoicedate") &&
      normalized.includes("netamount")
    );
  });

  if (headerRowIndex === -1) {
    throw new Error(`Could not find the Hy-Vee invoice table header in ${fileName}.`);
  }

  const headers = rawRows[headerRowIndex];
  const invoiceNumberIndex = getHeaderIndex(headers, ["Invoice Number"]);
  const invoiceDateIndex = getHeaderIndex(headers, ["Invoice Date"]);
  const grossAmountIndex = getHeaderIndex(headers, ["Gross Amount"]);
  const discountAmountIndex = getHeaderIndex(headers, ["Discount Amount"]);
  const adjustmentAmountIndex = getHeaderIndex(headers, ["Adjustment Amount"]);
  const memoCodeIndex = getMemoCodeHeaderIndex(headers);
  const netAmountIndex = getHeaderIndex(headers, ["Net Amount"]);
  const explanationIndex = getHeaderIndex(headers, ["Explanation"]);

  if (netAmountIndex === -1) {
    throw new Error(`Missing "Net Amount" column in ${fileName}.`);
  }

  const fileType = getFileType(fileName);
  const parsedRows: HyveeInvoiceRow[] = [];
  let currentInvoiceNumber = "";
  let currentInvoiceDate: string | null = null;

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => clean(cell))) return;

    const invoiceNumber = normalizeInvoiceNumber(getValue(row, invoiceNumberIndex));
    const invoiceDate = parseDate(getValue(row, invoiceDateIndex));
    const explanation = clean(getValue(row, explanationIndex));
    const memoCode = clean(getValue(row, memoCodeIndex));
    const grossAmount = parseNumber(getValue(row, grossAmountIndex));
    const discountAmount = parseNumber(getValue(row, discountAmountIndex));
    const adjustmentAmount = parseNumber(getValue(row, adjustmentAmountIndex));
    const netAmount = parseNumber(getValue(row, netAmountIndex));

    if (
      !invoiceNumber &&
      !invoiceDate &&
      !explanation &&
      !memoCode &&
      netAmount != null &&
      [grossAmount, discountAmount, adjustmentAmount].filter((value) => value != null)
        .length >= 2
    ) {
      return;
    }

    if (
      !invoiceNumber &&
      !invoiceDate &&
      grossAmount == null &&
      discountAmount == null &&
      adjustmentAmount == null &&
      netAmount == null &&
      !explanation &&
      !memoCode
    ) {
      return;
    }

    if (invoiceNumber) currentInvoiceNumber = invoiceNumber;
    if (invoiceDate) currentInvoiceDate = invoiceDate;

    parsedRows.push({
      month: monthNameFromDate(checkInfo.checkDate),
      type: selectedType,
      check_number: checkInfo.checkNumber,
      check_date: checkInfo.checkDate,
      check_amount: checkInfo.checkAmount,
      invoice_number: invoiceNumber || currentInvoiceNumber,
      invoice_date: invoiceDate || currentInvoiceDate,
      gross_amount: grossAmount,
      discount_amount: discountAmount,
      adjustment_amount: adjustmentAmount,
      memo_code: memoCode,
      net_amount: netAmount,
      explanation,
      source_file_name: fileName,
      source_file_type: fileType,
      line_number: headerRowIndex + index + 2,
    });
  });

  return finalizeParsedRows(parsedRows, checkInfo.checkAmount);
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
    const spansByLine = new Map<number, string[]>();

    for (const item of textContent.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform?.[5] ?? 0);
      const bucket = Math.round(y / 3) * 3;

      if (!spansByLine.has(bucket)) spansByLine.set(bucket, []);
      spansByLine.get(bucket)!.push(item.str);
    }

    pageTexts.push(
      Array.from(spansByLine.keys())
        .sort((a, b) => b - a)
        .map((bucket) => spansByLine.get(bucket)!.join(" "))
        .join("\n")
    );
  }

  return { pdf, text: pageTexts.join("\n") };
}

async function ocrPdf(pdf: PdfDocumentProxy) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  let fullText = "";

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas.toDataURL("image/png"));
      fullText += `\n${result.data.text}\n`;
    }
  } finally {
    await worker.terminate();
  }

  return fullText;
}

async function ocrImage(file: File) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");

  try {
    const result = await worker.recognize(await fileToDataUrl(file));
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function parseHyveeFile(file: File, selectedType: string) {
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

    return parseHyveeWorksheet(rawRows, file.name, selectedType);
  }

  if (fileType === "pdf") {
    const { pdf, text } = await extractTextFromPdf(file);

    try {
      return parseHyveeText(text, file.name, fileType, selectedType);
    } catch (error) {
      const ocrText = await ocrPdf(pdf);
      if (!ocrText.trim()) throw error;
      return parseHyveeText(ocrText, file.name, fileType, selectedType);
    }
  }

  if (fileType === "image") {
    return parseHyveeText(await ocrImage(file), file.name, fileType, selectedType);
  }

  throw new Error(`${file.name}: upload an Excel, CSV, PDF, or image file.`);
}

async function fetchAllHyveeRows() {
  let from = 0;
  let allRows: HyveeInvoiceRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("hyvee_invoices")
      .select("*")
      .order("check_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as HyveeInvoiceRow[];
    allRows = [...allRows, ...batch];

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export default function HyveeInvoicesView() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [startupCache] = useState<HyveeInvoicesCache | null>(() =>
    readBrowserCache<HyveeInvoicesCache>(HYVEE_INVOICES_CACHE_KEY)
  );
  const [rows, setRows] = useState<HyveeInvoiceRow[]>(() =>
    (startupCache?.rows || []).filter((row) => !isNoiseRow(row))
  );
  const [loading, setLoading] = useState(() => !startupCache);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingTypeId, setSavingTypeId] = useState<number | null>(null);
  const [showUploadBox, setShowUploadBox] = useState(false);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("All Months");
  const [typeFilter, setTypeFilter] = useState("All Types");

  const loadRows = async (hasCachedData = false) => {
    try {
      if (!hasCachedData) setLoading(true);
      setLoadError("");
      const data = (await fetchAllHyveeRows()).filter((row) => !isNoiseRow(row));
      setRows(data);
      writeBrowserCache<HyveeInvoicesCache>(HYVEE_INVOICES_CACHE_KEY, { rows: data });
    } catch (error: unknown) {
      console.error("Failed to load hyvee_invoices:", error);
      const message = getErrorMessage(error, "Failed to load Hy-Vee invoices.");
      setLoadError(
        message.includes("Could not find the table")
          ? "Supabase table public.hyvee_invoices is not available yet."
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
    const options = new Set<string>(HYVEE_TYPE_OPTIONS);

    for (const row of rows) {
      if (clean(row.type)) options.add(clean(row.type));
    }

    return Array.from(options);
  }, [rows]);

  const monthOptions = useMemo(() => {
    const options = Array.from(new Set(rows.map((row) => row.month).filter(Boolean)));

    return ["All Months", ...options.sort((a, b) => getMonthSortValue(b) - getMonthSortValue(a))];
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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return sortedRows.filter((row) => {
      const matchesMonth = monthFilter === "All Months" || row.month === monthFilter;
      const matchesType = typeFilter === "All Types" || row.type === typeFilter;
      const matchesSearch =
        !q ||
        [
          row.month,
          row.type,
          row.check_number,
          row.check_date,
          row.check_amount,
          row.invoice_number,
          row.invoice_date,
          row.gross_amount,
          row.discount_amount,
          row.adjustment_amount,
          row.memo_code,
          row.net_amount,
          row.explanation,
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

  const updateTypeLocally = (rowId: number, type: string) => {
    setRows((prev) => {
      const nextRows = prev.map((row) =>
        row.id === rowId ? { ...row, type } : row
      );

      writeBrowserCache<HyveeInvoicesCache>(HYVEE_INVOICES_CACHE_KEY, {
        rows: nextRows,
      });

      return nextRows;
    });
  };

  const saveRowType = async (row: HyveeInvoiceRow, nextType: string) => {
    if (!row.id) return;

    const normalizedType = clean(nextType);
    const currentType = clean(row.type);

    if (!normalizedType || normalizedType === currentType) return;

    setSavingTypeId(row.id);
    updateTypeLocally(row.id, normalizedType);

    const { error } = await supabase
      .from("hyvee_invoices")
      .update({ type: normalizedType })
      .eq("id", row.id);

    setSavingTypeId(null);

    if (error) {
      updateTypeLocally(row.id, currentType);
      alert(getErrorMessage(error, "Failed to save Hy-Vee invoice type."));
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;

    try {
      setUploading(true);
      const files = Array.from(fileList);
      let uploadedCount = 0;

      for (const file of files) {
        const selectedType = HYVEE_DEFAULT_TYPE;
        const baseParsedRows = sanitizeHyveeRowsForInsert(
          await parseHyveeFile(file, selectedType)
        );

        if (!baseParsedRows.length) {
          alert(`No Hy-Vee invoice rows were parsed from ${file.name}.`);
          continue;
        }

        const existingForFile = rows.some(
          (row) => clean(row.source_file_name) === file.name
        );

        if (existingForFile) {
          const shouldReplace = window.confirm(
            `Hy-Vee invoice data already exists from ${file.name}.\n\nDo you want to replace it?`
          );

          if (!shouldReplace) continue;

          const { error: deleteError } = await supabase
            .from("hyvee_invoices")
            .delete()
            .eq("source_file_name", file.name);

          if (deleteError) throw deleteError;
        }

        const sourceFilePath = await uploadHyveeSourceFile(file);
        const parsedRows = baseParsedRows.map((row) => ({
          ...row,
          source_file_path: sourceFilePath,
        }));

        for (let index = 0; index < parsedRows.length; index += 1000) {
          const chunk = parsedRows.slice(index, index + 1000);
          const { error: insertError } = await supabase
            .from("hyvee_invoices")
            .insert(chunk);

          if (insertError) throw insertError;
        }

        uploadedCount += parsedRows.length;
      }

      await loadRows();
      setShowUploadBox(false);

      if (uploadedCount) {
        alert(`${uploadedCount.toLocaleString()} Hy-Vee invoice rows uploaded successfully.`);
      }
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Hy-Vee invoice upload failed."));
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
      Month: row.month,
      Type: row.type,
      "Check #": row.check_number,
      "Check Date": formatDisplayDate(row.check_date),
      "Check Amount": row.check_amount,
      "Invoice Number": row.invoice_number,
      "Invoice Date": formatDisplayDate(row.invoice_date),
      "Gross Amount": row.gross_amount,
      "Discount Amount": row.discount_amount,
      "Adjustment Amount": row.adjustment_amount,
      "Net Amount": row.net_amount,
      Explanation: row.explanation,
      "Source File Name": row.source_file_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Hy-Vee Invoices");
    XLSX.writeFile(workbook, "hyvee_invoices.xlsx");
  };

  const downloadSourceFile = async (row: HyveeInvoiceRow) => {
    if (!row.source_file_path) {
      alert("No downloadable source file is saved for this row yet.");
      return;
    }

    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .download(row.source_file_path);

    if (error) {
      alert(getErrorMessage(error, "Failed to download source file."));
      return;
    }

    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = row.source_file_name || "hyvee-source-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Hy-Vee Invoices</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload Hy-Vee remittance files and review rows from the invoice table.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search check, invoice, explanation"
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
                  Hy-Vee Invoice File
                </label>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff"
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
            Loading Hy-Vee invoices...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            {loadError}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No Hy-Vee invoice rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check #</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Check Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice Number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Gross Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Discount Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Adjustment Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Net Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Explanation</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center font-semibold text-slate-700">Reference</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr
                      key={row.id || `${row.source_file_name}-${row.line_number}-${index}`}
                      className="border-t border-slate-200 bg-white"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.month}</td>
                      <td className="min-w-[240px] whitespace-nowrap px-4 py-3 text-slate-700">
                        <select
                          value={row.type}
                          onChange={(event) => void saveRowType(row, event.currentTarget.value)}
                          disabled={!row.id || savingTypeId === row.id}
                          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
                        >
                          {typeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.check_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.check_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(row.check_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.invoice_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.invoice_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatCurrency(row.gross_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatCurrency(row.discount_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatCurrency(row.adjustment_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(row.net_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.explanation}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-center text-slate-500">
                        <button
                          type="button"
                          onClick={() => void downloadSourceFile(row)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            row.source_file_path
                              ? `Download ${row.source_file_name}`
                              : "Source file not saved"
                          }
                          aria-label={
                            row.source_file_path
                              ? `Download ${row.source_file_name}`
                              : "Source file not saved"
                          }
                          disabled={!row.source_file_path}
                        >
                          <FileImage className="h-4 w-4" />
                        </button>
                      </td>
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
