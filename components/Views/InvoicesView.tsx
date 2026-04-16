"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Trash2,
  FileText,
  XCircle,
  FileSpreadsheet,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type UploadRecord = {
  id: number;
  created_at: string;
  uploaded_at?: string | null;
  file_name: string;
  file_path: string;
  file_type: string | null;
  category: string | null;
  invoice: string | null;
  pdf_date: string | null;
};

type InvoiceRecord = {
  id: number;
  created_at: string;
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  check_amt: number | null;
  invoice_number: string | null;
  invoice_amt: number | null;
  dc_name: string | null;
  status: string | null;
  type: string | null;
  doc_status: boolean | null;
};

type ToastType = "success" | "error" | "info";

type DatasetRow = {
  upc: string;
  item: string;
  cust_name: string;
  amt: number;
  qty?: number;
  rate?: number;
};

type DatasetInsert = {
  month: string;
  check_date: string | null;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  cust_name: string;
  amt: number;
};

type DeductionTypeRecord = {
  id: string;
  document_type: string;
  deduction_type: string;
};

type NewDeductionTypeModal = {
  open: boolean;
  detectedName: string;
  docTypeName: string;
  deductionName: string;
  pendingFile: File | null;
  pendingMeta: {
    category: string;
    invoice: string;
    pdf_date: string;
    file_type: "pdf" | "excel";
  } | null;
  pendingIsReplace: boolean;
  pendingExistingUpload: UploadRecord | null;
};

type UpcEntry = {
  upc: string;
  description: string;
  descEditMode: boolean;
  descEditValue: string;
};

type NewUpcModal = {
  open: boolean;
  upcs: UpcEntry[];
  pendingInvoice: string;
  pendingPdfDate: string;
  pendingFile: File | null;
  pendingCategory: string;
};

const DOCUMENT_BUCKET = "document-uploads";

function normalizeType(raw: string) {
  const c = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (/\$\s*1\s*promotion/i.test(c) || /\b1\s*dollar\s*promotion\b/i.test(c)) return "$1 Promotion";
  if (/distributor\s+charge/i.test(c)) return "$1 Promotion";
  if (/customer\s+spoils\s+allowance/i.test(c)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage\s+natural/i.test(c)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage/i.test(c)) return "Customer Spoils Allowance";
  if (/pass\s+thru\s+deduction/i.test(c) || /pass\s+through\s+deduction/i.test(c)) return "Pass Thru Deduction";
  if (/fresh\s+thyme\s+ppf/i.test(c)) return "Pass Thru Deduction";
  if (/new\s+item\s+setup\s+fee/i.test(c) || /new\s+item\s+set\s*up\s+fee/i.test(c)) return "New Item Setup Fee";
  if (/new\s+item\s+setup/i.test(c) || /new\s+item\s+set\s*up/i.test(c)) return "New Item Setup";
  if (/intro\s+allowance\s+audit/i.test(c)) return "Intro Allowance Audit";
  if (/introductory\s+fee/i.test(c)) return "Introductory Fee";
  if (/wm\s+invoice/i.test(c) || /wonder\s+monday/i.test(c)) return "WM Invoice";
  return raw.replace(/\s+/g, " ").trim() || "Unknown";
}

function normalizeDocDate(raw: string) {
  const cleaned = raw.replace(/\s+/g, "").trim();
  const match = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!match) return raw.trim();
  let [, mm, dd, yyyy] = match;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  return `${mm.padStart(2, "0")}/${dd.padStart(2, "0")}/${yyyy}`;
}

function normalizeInvoiceNumber(raw: string) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

function isBadInvoiceCandidate(value: string) {
  const v = normalizeInvoiceNumber(value).toLowerCase();
  if (!v) return true;
  return new Set([
    "invoice", "wonder", "wondermonday", "monday", "billto", "shipto",
    "details", "date", "invoicedate", "invoiceno", "number", "unknown",
  ]).has(v);
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const num = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isNaN(num) ? null : num;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeSku(raw: string) {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase()
    .trim();
}

function isWmInvoiceType(type: string) {
  return normalizeType(String(type || "")) === "WM Invoice";
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function parseIsoDateFromMmDdYyyy(value: string | null | undefined) {
  if (!value || value === "Unknown") return null;
  const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isoDateToMmDdYyyy(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = String(value).trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const isoWithTime = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoWithTime) return `${isoWithTime[2]}/${isoWithTime[3]}/${isoWithTime[1]}`;
  const normalized = normalizeDocDate(trimmed);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) return normalized;
  return "";
}

function formatMonthShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const mdy = String(dateStr).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(`${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}T00:00:00`);
    if (!isNaN(d.getTime())) {
      return `${d.toLocaleString("en-US", { month: "long" })} '${String(d.getFullYear()).slice(-2)}`;
    }
  }
  const d = new Date(String(dateStr));
  if (!isNaN(d.getTime())) {
    return `${d.toLocaleString("en-US", { month: "long" })} '${String(d.getFullYear()).slice(-2)}`;
  }
  return String(dateStr);
}

function formatMonthLabelFromDate(value: string | null | undefined): string {
  const iso = parseIsoDateFromMmDdYyyy(value);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { month: "long" })} '${String(d.getFullYear()).slice(-2)}`;
}

function normalizeExcelDate(value: unknown) {
  if (typeof value === "number") {
    const jsDate = XLSX.SSF.parse_date_code(value);
    if (!jsDate) return "";
    return `${String(jsDate.m).padStart(2, "0")}/${String(jsDate.d).padStart(2, "0")}/${jsDate.y}`;
  }
  if (!value) return "";
  const str = String(value).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  }
  return str;
}

async function detectFileTypeFromContent(file: File): Promise<"pdf" | "excel" | "unknown"> {
  try {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();

    if (header.length >= 4 && header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) return "pdf";

    if (header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b) {
      try {
        const text = await file.slice(0, 1024).text();
        if (text.includes("xl/") || text.includes("workbook.xml") || text.includes("sheet")) return "excel";
      } catch {}
      return "excel";
    }

    if (
      header.length >= 8 &&
      header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0 &&
      header[4] === 0xa1 && header[5] === 0xb1 && header[6] === 0x1a && header[7] === 0xe1
    ) return "excel";

    if (
      name.endsWith(".xlsx") || name.endsWith(".xls") ||
      type.includes("spreadsheet") || type.includes("excel") ||
      type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      type === "application/vnd.ms-excel"
    ) return "excel";

    if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
    return "unknown";
  } catch (error) {
    console.error("File type detection error:", error);
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".pdf")) return "pdf";
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "excel";
    return "unknown";
  }
}

async function isExcelFile(file: File) {
  return (await detectFileTypeFromContent(file)) === "excel";
}

async function isPdfFile(file: File) {
  return (await detectFileTypeFromContent(file)) === "pdf";
}

function detectStoredFileType(fileName?: string | null, fileType?: string | null): "pdf" | "excel" {
  const name = String(fileName || "").toLowerCase();
  const type = String(fileType || "").toLowerCase();
  if (type === "excel" || name.endsWith(".xlsx") || name.endsWith(".xls")) return "excel";
  if (type === "pdf" || name.endsWith(".pdf")) return "pdf";
  throw new Error(`Unsupported stored file type: ${fileName || "unknown file"}`);
}

function getExcelMimeType(fileName?: string | null) {
  return String(fileName || "").toLowerCase().endsWith(".xls")
    ? "application/vnd.ms-excel"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function getUploadContentType(file: File, fileType: "pdf" | "excel") {
  if (fileType === "pdf") return "application/pdf";
  return getExcelMimeType(file.name);
}

async function uploadToStorageWithRetry(
  filePath: string,
  file: File,
  contentType: string,
  retries = 3
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType });
    if (!error) return;
    lastError = new Error(error.message);
    if (error.message?.toLowerCase().includes("already exists")) throw lastError;
    if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  throw lastError!;
}

function parseMetadataFromText(text: string) {
  const norm = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  const lower = norm.toLowerCase();
  let invoice = "Unknown";
  let category = "Unknown";
  let pdf_date = "Unknown";

  const isCustomerSpoilageNatural =
  /customer\s+spoils\s+allowance/i.test(lower) ||
  /customer\s+spoilage\s+natural/i.test(lower) ||
  /customer\s+spoilage/i.test(lower) ||
  /spoilage\s+detail\s+below/i.test(lower);

  const isWMInvoicePdf =
    /wonder\s*monday/i.test(lower) &&
    /ship\s+to/i.test(lower) &&
    /kehe\s+distributors/i.test(lower) &&
    /invoice\s+no/i.test(lower);

  const isStrictWMInvoice =
    /wonder\s+monday/i.test(lower) &&
    /invoice\s+details/i.test(lower) &&
    /invoice\s+no\.?/i.test(lower) &&
    /bill\s+to/i.test(lower) &&
    /ship\s+to/i.test(lower);

  const isDollarPromotion =
    /distributor\s+charge/i.test(lower) &&
    /received\s+by\s+customer/i.test(lower);

  const isFreshThymePpf =
    !isCustomerSpoilageNatural &&
    (
      /fresh\s+thyme\s+ppf/i.test(lower) ||
      (
        /special\s+payee\s+number/i.test(lower) &&
        /master\s+reference\s+no/i.test(lower) &&
        /wonder\s+monday/i.test(lower)
      )
    );

  const isFreshThymeSas =
    /fresh\s+thyme\s+sas/i.test(lower) &&
    /chargeback/i.test(lower);

  // ── Category detection ──────────────────────────────────────────────────────
  if (isCustomerSpoilageNatural) category = "Customer Spoils Allowance";
  else if (isDollarPromotion) category = "$1 Promotion";
  else if (isStrictWMInvoice || isWMInvoicePdf) category = "WM Invoice";
  else if (isFreshThymePpf || isFreshThymeSas) category = "Pass Thru Deduction";
  else {
    const matchers = [
      { p: /\$\s*1\s*promotion/i, v: "$1 Promotion" },
      { p: /distributor\s+charge/i, v: "$1 Promotion" },
      { p: /customer\s+spoils\s+allowance/i, v: "Customer Spoils Allowance" },
      { p: /customer\s+spoilage\s+natural/i, v: "Customer Spoils Allowance" },
      { p: /customer\s+spoilage/i, v: "Customer Spoils Allowance" },
      { p: /pass\s+thru\s+deduction/i, v: "Pass Thru Deduction" },
      { p: /fresh\s+thyme\s+ppf/i, v: "Pass Thru Deduction" },
      { p: /new\s+item\s+setup\s+fee/i, v: "New Item Setup Fee" },
      { p: /new\s+item\s+setup/i, v: "New Item Setup" },
      { p: /intro\s+allowance\s+audit/i, v: "Intro Allowance Audit" },
      { p: /introductory\s+fee/i, v: "Introductory Fee" },
      { p: /wonder\s+monday/i, v: "WM Invoice" },
    ];
    for (const { p, v } of matchers) {
      if (p.test(lower)) { category = v; break; }
    }
    if (category === "Unknown") {
      const m = norm.match(/(?:Type|Description|Category)\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{3,100})/i);
      if (m?.[1]) category = normalizeType(m[1]);
    }
  }

  // ── Helper: safe invoice candidate ─────────────────────────────────────────
  // Rejects reference numbers, dates, comment codes like "12/452009"
  const isSafeInvoice = (raw: string): boolean => {
    const v = normalizeInvoiceNumber(raw);
    if (!v || isBadInvoiceCandidate(v)) return false;
    // Reject slash-separated values (reference/comment codes like 12/452009)
    if (/\//.test(raw)) return false;
    // Reject pure date-like patterns mm/dd/yy or dd/mm/yy
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(raw.trim())) return false;
    // Reject very long pure-digit strings that look like reference numbers (7+ digits)
    // UNLESS they start with leading zeros (invoice style like 0101348)
    if (/^\d{7,}$/.test(v) && !/^0\d+$/.test(v)) return false;
    return true;
  };

  // ── WM Invoice / Strict WM Invoice ─────────────────────────────────────────
  if (category === "WM Invoice" || isStrictWMInvoice || isWMInvoicePdf) {
    const m =
      norm.match(/invoice\s*no\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i) ||
      norm.match(/invoice\s*#\s*[:\-]?\s*([A-Z0-9\-\/]+)/i);
    if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);

    const d =
      norm.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
      norm.match(/ship\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (d?.[1]) pdf_date = normalizeDocDate(d[1]);
  }

  // ── $1 Promotion / Distributor Charge ──────────────────────────────────────
  if (category === "$1 Promotion" || isDollarPromotion) {
    // Priority 1: explicit "INVOICE #XXXXXXX" pattern — handles leading zeros
    const explicit =
      norm.match(/INVOICE\s*#\s*(\d+)/i) ||
      norm.match(/INVOICE\s+NUMBER\s*[:\-]?\s*(\d+)/i);
    if (explicit?.[1] && isSafeInvoice(explicit[1])) {
      invoice = normalizeInvoiceNumber(explicit[1]);
    }

    // Priority 2: "Invoice #" anywhere with optional leading zeros
    if (invoice === "Unknown") {
      const m = norm.match(/invoice\s*#\s*0*(\d+)/i);
      if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);
    }

    // Priority 3: filename-style invoice at very start of text (e.g. "#0101348")
    if (invoice === "Unknown") {
      const m = norm.match(/#\s*(0\d{4,})\b/);
      if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);
    }

    // Date
    const d = norm.match(/\bdate\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
    if (d?.[1]) pdf_date = normalizeDocDate(d[1]);

    // Fallback date: bottom "Date MM/DD/YYYY" stamp common in these PDFs
    if (pdf_date === "Unknown") {
      const d2 = norm.match(/\bDate\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/);
      if (d2?.[1]) pdf_date = normalizeDocDate(d2[1]);
    }
  }

  // ── Pass Thru Deduction / Fresh Thyme SAS ──────────────────────────────────
  if (invoice === "Unknown" && (category === "Pass Thru Deduction" || isFreshThymeSas)) {
    const m = norm.match(/invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i);
    if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);

    const d =
      norm.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
      norm.match(/date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (d?.[1]) pdf_date = normalizeDocDate(d[1]);
  }

  // ── Customer Spoils Allowance ───────────────────────────────────────────────
  if (invoice === "Unknown" && category === "Customer Spoils Allowance") {
    const m =
      norm.match(/invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i) ||
      norm.match(/\b(CN\d{9,})\b/i);
    if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);

    const d =
      norm.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
      norm.match(/date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (d?.[1]) pdf_date = normalizeDocDate(d[1]);
  }

  // ── Generic CN / CS / alphanumeric fallbacks ────────────────────────────────
  if (invoice === "Unknown") {
    for (const p of [/\b(CN\d{9,})\b/i, /\b(CS\d{6,})\b/i, /\b([A-Z]{1,6}\d{6,})\b/]) {
      const m = norm.match(p);
      if (m?.[1] && isSafeInvoice(m[1])) { invoice = normalizeInvoiceNumber(m[1]); break; }
    }
  }

  // ── Generic "Invoice Number/No/#" label ─────────────────────────────────────
  if (invoice === "Unknown") {
    const generic = norm.match(/Invoice\s*(?:Number|No\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i);
    if (generic?.[1] && isSafeInvoice(generic[1])) invoice = normalizeInvoiceNumber(generic[1]);
  }

  // ── WM Invoice last-chance numeric ──────────────────────────────────────────
  if (invoice === "Unknown" && (category === "WM Invoice" || /wonder\s+monday/i.test(lower))) {
    const m =
      norm.match(/invoice\s*no\.?\s*[:\-]?\s*(\d{1,10})\b/i) ||
      norm.match(/invoice\s*#\s*[:\-]?\s*(\d{1,10})\b/i);
    if (m?.[1] && isSafeInvoice(m[1])) invoice = normalizeInvoiceNumber(m[1]);
  }

  // ── REMOVED the old greedy catch-all fallback ────────────────────────────────
  // The old regex /\b([A-Z]{0,10}\d[A-Z0-9.\-\/]{1,})\b/ was grabbing
  // reference numbers like 8975225 and comment codes like 12/452009.
  // Each category now has its own targeted fallback above instead.

  // ── Date fallbacks ──────────────────────────────────────────────────────────
  if (pdf_date === "Unknown") {
    for (const p of [
      /\bDate\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/i,
      /Invoice\s+date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2})\b/,
    ]) {
      const m = norm.match(p);
      if (m?.[1]) { pdf_date = normalizeDocDate(m[1]); break; }
    }
  }

  return { category, invoice, pdf_date };
}

async function extractTextWithPdfJs(file: File) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  console.log(`[extractTextWithPdfJs] numPages: ${pdf.numPages}`);

  const pageTexts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    const spansByLine = new Map<number, string[]>();

    for (const item of tc.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round((item as any).transform?.[5] ?? 0);
      const bucket = Math.round(y / 3) * 3;
      if (!spansByLine.has(bucket)) spansByLine.set(bucket, []);
      spansByLine.get(bucket)!.push(item.str);
    }

    const sortedBuckets = Array.from(spansByLine.keys()).sort((a, b) => b - a);
    const pageLines = sortedBuckets.map((bucket) => spansByLine.get(bucket)!.join(" "));

    pageTexts.push(pageLines.join("\n"));
    console.log(`[extractTextWithPdfJs] page ${p}: ${pageLines.length} lines, ${pageTexts[pageTexts.length - 1].length} chars`);
  }

  const fullText = pageTexts.join("\n").trim();
  console.log(`[extractTextWithPdfJs] total chars: ${fullText.length}`);

  return { pdf, fullText };
}

async function safeExtractPdfText(file: File) {
  const detectedType = await detectFileTypeFromContent(file);
  if (detectedType === "excel") {
    throw new Error(`${file.name}: this file is an Excel spreadsheet, not a PDF. Please upload it as an Excel document.`);
  }
  try {
    return await extractTextWithPdfJs(file);
  } catch (err: any) {
    throw new Error(`${file.name}: failed to read PDF. ${err?.message || "Invalid or corrupted PDF file."}`);
  }
}

async function extractTextWithOcr(pdf: any) {
  const worker = await createWorker("eng");
  let fullText = "";
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      fullText += "\n" + (await worker.recognize(canvas.toDataURL("image/png"))).data.text + "\n";
      console.log(`[extractTextWithOcr] page ${p} OCR done`);
    }
  } finally {
    await worker.terminate();
  }
  return fullText.trim();
}

async function extractPdfMetadata(file: File) {
  const { pdf, fullText } = await safeExtractPdfText(file);
  let parsed = parseMetadataFromText(fullText);
  if (parsed.category === "Unknown" && parsed.invoice === "Unknown" && parsed.pdf_date === "Unknown") {
    parsed = parseMetadataFromText(await extractTextWithOcr(pdf));
  }
  return parsed;
}

async function extractExcelMetadata(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  let fullText = "";
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
    fullText += " " + rows.flat().map((c) => String(c || "").trim()).filter(Boolean).join(" ");
  }
  return parseMetadataFromText(fullText);
}

async function extractDocumentMetadata(
  file: File,
  deductionTypes: DeductionTypeRecord[]
): Promise<{
  category: string;
  invoice: string;
  pdf_date: string;
  file_type: "pdf" | "excel";
  detected_name?: string;
}> {
  const detected = await detectFileTypeFromContent(file);

  const cleanText = (value: string) =>
    String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();

  const findHeaderMatch = (headerText: string) => {
    const normalizedHeader = cleanText(headerText).toLowerCase();

    const exactMatch = (deductionTypes || []).find((d) =>
      cleanText(d.document_type).toLowerCase() === normalizedHeader
    );
    if (exactMatch) return exactMatch;

    const containsMatch = (deductionTypes || []).find((d) => {
      const docType = cleanText(d.document_type).toLowerCase();
      return docType && normalizedHeader.includes(docType);
    });
    if (containsMatch) return containsMatch;

    return null;
  };

  if (detected === "excel") {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });

    const firstSheetName = wb.SheetNames[0];
    const firstSheet = wb.Sheets[firstSheetName];

    const firstRows = XLSX.utils.sheet_to_json<any[]>(firstSheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    const topRows = firstRows.slice(0, 20);

    const topLines = topRows
      .map((row) =>
        row
          .map((c) => String(c || "").trim())
          .filter(Boolean)
          .join(" ")
      )
      .map((line) => cleanText(line))
      .filter(Boolean);

    const headerCandidate =
      topLines
        .filter((line) => line.length >= 4)
        .sort((a, b) => b.length - a.length)[0] || "";

    let fullText = "";
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sn], {
        header: 1,
        raw: false,
        defval: "",
      });
      fullText +=
        " " +
        rows
          .flat()
          .map((c) => String(c || "").trim())
          .filter(Boolean)
          .join(" ");
    }
    fullText = cleanText(fullText);

    const parsed = parseMetadataFromText(fullText);

    const headerMatch = findHeaderMatch(headerCandidate);
    if (headerMatch) {
      return {
        category: headerMatch.deduction_type,
        invoice: parsed.invoice,
        pdf_date: parsed.pdf_date,
        file_type: "excel",
        detected_name: headerMatch.document_type,
      };
    }

    if (headerCandidate) {
      return {
        category: "Unknown",
        invoice: parsed.invoice,
        pdf_date: parsed.pdf_date,
        file_type: "excel",
        detected_name: headerCandidate,
      };
    }

    return {
      category: "Unknown",
      invoice: parsed.invoice,
      pdf_date: parsed.pdf_date,
      file_type: "excel",
      detected_name: "Unknown Header",
    };
  }

    return {
      category: parsed.category,
      invoice: parsed.invoice,
      pdf_date: parsed.pdf_date,
      file_type: "excel",
      detected_name: parsed.category,
    };
  }

  if (detected === "pdf") {
    const parsed = await extractPdfMetadata(file);
    return {
      ...parsed,
      file_type: "pdf",
      detected_name: parsed.category,
    };
  }

  throw new Error(`${file.name}: unsupported file type. Please upload PDF, XLSX, or XLS.`);
}

async function fetchProductLookup(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("product_list").select("upc, item_description");
  if (error) return new Map();
  const map = new Map<string, string>();
  for (const r of data ?? []) {
    const key = normalizeSku(String(r.upc || "").trim());
    if (key) map.set(key, r.item_description ?? "");
  }
  return map;
}

async function fetchDeductionTypes(): Promise<DeductionTypeRecord[]> {
  const { data, error } = await supabase
    .from("deduction_types")
    .select("id, document_type, deduction_type")
    .order("deduction_type");
  if (error) return [];
  return data ?? [];
}

async function saveDeductionType(documentType: string, deductionType: string): Promise<void> {
  await supabase.from("deduction_types").insert({ document_type: documentType, deduction_type: deductionType });
}

async function saveProductListEntry(upc: string, description: string): Promise<void> {
  await supabase.from("product_list").upsert({ upc, item_description: description }, { onConflict: "upc" });
}

async function fetchInvoiceType(invoiceNumber: string): Promise<string> {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  const { data: invData, error: invErr } = await supabase.from("invoices").select("type, invoice_number").limit(5000);
  if (!invErr) {
    const matched = (invData || []).find((r) => normalizeInvoiceNumber(r.invoice_number || "") === norm);
    if (matched?.type) return matched.type;
  }
  const { data: upData, error: upErr } = await supabase.from("uploads").select("category, invoice").limit(5000);
  if (!upErr) {
    const matched = (upData || []).find((r) => normalizeInvoiceNumber(r.invoice || "") === norm);
    if (matched?.category) return matched.category;
  }
  return "";
}

async function fetchInvoiceAmount(invoice: string): Promise<number> {
  const ni = normalizeInvoiceNumber(invoice);
  if (!ni) return 0;
  const { data, error } = await supabase.from("invoices").select("invoice_number, invoice_amt").limit(5000);
  if (error) return 0;
  const matched = (data || []).find((r) => normalizeInvoiceNumber(r.invoice_number || "") === ni);
  return Number(matched?.invoice_amt || 0);
}

async function fetchInvoiceCheckDate(invoice: string): Promise<string> {
  const ni = normalizeInvoiceNumber(invoice);
  if (!ni) return "";
  const { data, error } = await supabase.from("invoices").select("invoice_number, check_date").limit(5000);
  if (error) return "";
  const matched = (data || []).find((r) => normalizeInvoiceNumber(r.invoice_number || "") === ni);
  return isoDateToMmDdYyyy(matched?.check_date || "");
}

const DEBUG_MODE = true;

function parseSpoilsPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];

  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let currentUpc = "";
  let inFlatTable = false;

  const debug = {
    totalLines: lines.length,
    upcHeaders: [] as Array<{ lineIndex: number; upc: string; line: string; mode: string }>,
    parsedRows: [] as Array<{ lineIndex: number; upc: string; customer: string; amount: number; mode: string }>,
    skipped: [] as Array<{ lineIndex: number; line: string; reason: string; currentUpc: string }>,
  };

  const isNoiseLine = (line: string) =>
    /^page\s+\d+\s+of\s+\d+$/i.test(line) ||
    /^\w+day,\s+\w+\s+\d{1,2},\s+\d{4}\s+page\s+\d+\s+of\s+\d+$/i.test(line) ||
    /^all\s+inquir/i.test(line) ||
    /vendorperformance@/i.test(line);

  const extractAmount = (value: string): number | null => {
    const m = value.match(/-?\$?\s*(\d+\.\d{2,4}|\.\d{2,4})/);
    if (!m) return null;
    const raw = m[1].startsWith(".") ? `0${m[1]}` : m[1];
    return parseFloat(raw);
  };

  const isSpoilsTableHeader = (line: string) =>
    /UPC.*ITEM.*BRAND.*C(?:ust|ustomer).*Name.*Date.*Inv.*Qty.*Amt/i.test(line) ||
    /^\s*UPC\s+ITEM\s+BRAND\s+Cust/i.test(line) ||
    /^\s*UPC\s+ITEM\s+BRAND/i.test(line);

  const looksLikeFlatSpoilsRow = (line: string): boolean =>
    /^\d{10,14}\s+/.test(line) &&
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(line) &&
    /\$?\.?\d+\.\d{2}$/.test(line.trim());

  const normalizeCustomerName = (value: string): string =>
    value
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim();

  const stripTrailingTokensBeforeDate = (value: string): string => {
    let out = value.trim();

    // Some OCR/PDF text extractions can leave invoice/qty/rate tokens before the date split.
    // Remove them only if they appear at the very end.
    out = out.replace(/\s+\d+\s+\d+(?:\.\d+)?%\s*$/i, "");
    out = out.replace(/\s+\d{5,10}\s*$/i, "");

    return normalizeCustomerName(out);
  };

  const parseFlatSpoilsTableRowLoose = (line: string): DatasetRow | null => {
    const cleaned = line.replace(/\s+/g, " ").trim();
  
    // Example:
    // 850067781066 CHEESECAKE KEY LIME PIE WONDR KRO COL 264, LANCASTER 02/12/2026 406863 12 2% $.77
  
    const rowMatch = cleaned.match(
      /^(\d{10,14})\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%\s+\$?(\d+\.\d{2}|\.\d{2})$/i
    );
  
    if (!rowMatch) {
      console.log("[parseFlatSpoilsTableRowLoose] NO ROW MATCH:", cleaned);
      return null;
    }
  
    const [
      ,
      upc,
      leftSide,   // ITEM + BRAND + CUSTOMER
      _date,
      _invoice,
      qtyRaw,
      rateRaw,
      amtRaw,
    ] = rowMatch;
  
    const brandMatch = leftSide.match(/^(.*)\s+\bWONDR\b\s+(.+)$/i);
    if (!brandMatch) {
      console.log("[parseFlatSpoilsTableRowLoose] NO BRAND SPLIT:", cleaned);
      return null;
    }
  
    const customerName = brandMatch[2].trim();
    if (!customerName) {
      console.log("[parseFlatSpoilsTableRowLoose] EMPTY CUSTOMER:", cleaned);
      return null;
    }
  
    const normalizedAmt = amtRaw.startsWith(".") ? `0${amtRaw}` : amtRaw;
    const amt = parseFloat(normalizedAmt);
    if (Number.isNaN(amt)) {
      console.log("[parseFlatSpoilsTableRowLoose] BAD AMOUNT:", cleaned, amtRaw);
      return null;
    }
  
    return {
      upc: upc.trim(),
      item: "",
      cust_name: customerName,
      amt,
      qty: parseInt(qtyRaw, 10),
      rate: parseFloat(rateRaw) / 100,
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isNoiseLine(line)) continue;

    if (isSpoilsTableHeader(line) || /Spoilage\s+Detail\s+Below/i.test(line)) {
      inFlatTable = true;
      currentUpc = "";
      continue;
    }

  // ── Format 1: flat table rows ─────────────────────────────────────────────
  if (inFlatTable) {
    if (
      /^TOTAL\s*:?\s*\$?[\d,]+\.\d{2}$/i.test(line) ||
      /^invoice\s+total\b/i.test(line) ||
      /^accounts\s+due\b/i.test(line)
    ) {
      inFlatTable = false;
      continue;
    }

    const flatRow = parseFlatSpoilsTableRowLoose(line);

    if (flatRow) {
      rows.push(flatRow);
      debug.parsedRows.push({
        lineIndex: i,
        upc: flatRow.upc,
        customer: flatRow.cust_name,
        amount: flatRow.amt,
        mode: "flat-table-loose",
      });
      continue;
    } else {
      console.log("[parseSpoilsPdfRows] FLAT ROW FAILED:", i, line);
      debug.skipped.push({
        lineIndex: i,
        line,
        reason: "flat-table row failed",
        currentUpc,
      });
    }
  }

  // Safety: sometimes OCR gives a flat row even when header wasn't captured
  if (!inFlatTable && looksLikeFlatSpoilsRow(line)) {
    const flatRow = parseFlatSpoilsTableRowLoose(line);
    if (flatRow) {
      rows.push(flatRow);
      debug.parsedRows.push({
        lineIndex: i,
        upc: flatRow.upc,
        customer: flatRow.cust_name,
        amount: flatRow.amt,
        mode: "flat-opportunistic",
      });
      continue;
    }
  }

    // ── Format 2: grouped UPC blocks ──────────────────────────────────────────
    const upcMatch = line.match(/^UPC\s*:?\s*(\d{10,14})\b/i);
    if (upcMatch) {
      currentUpc = upcMatch[1];
      inFlatTable = false;
      debug.upcHeaders.push({ lineIndex: i, upc: currentUpc, line, mode: "same-line" });
      continue;
    }

    if (/^UPC\s*:?\s*$/i.test(line)) {
      const nextLine = lines[i + 1] || "";
      const nextUpcMatch = nextLine.match(/^(\d{10,14})\b/);
      if (nextUpcMatch) {
        currentUpc = nextUpcMatch[1];
        inFlatTable = false;
        debug.upcHeaders.push({
          lineIndex: i,
          upc: currentUpc,
          line: `${line} ${nextLine}`,
          mode: "next-line",
        });
      }
      continue;
    }

    if (!currentUpc) continue;

    // Variant 2A: customer and W/E on the same line
    if (/^\d{4,6}\s+/.test(line) && /\bW\/E\b/i.test(line)) {
      const customerMatch = line.match(/^\d{4,6}\s+(.+?)\s+W\/E\b/i);
      const amount = extractAmount(line);

      if (customerMatch && amount !== null) {
        const customerName = normalizeCustomerName(customerMatch[1]);
        const row: DatasetRow = {
          upc: currentUpc,
          item: "",
          cust_name: customerName,
          amt: amount,
        };
        rows.push(row);
        debug.parsedRows.push({
          lineIndex: i,
          upc: currentUpc,
          customer: row.cust_name,
          amount: row.amt,
          mode: "single-line",
        });
        continue;
      }

      debug.skipped.push({
        lineIndex: i,
        line,
        reason: "single-line row failed",
        currentUpc,
      });
      continue;
    }

    // Variant 2B: store number on one line, customer lines next, W/E later
    if (/^\d{4,6}$/.test(line)) {
      let weIdx = -1;
      for (let k = i + 1; k < Math.min(i + 10, lines.length); k++) {
        if (/^W\/E\s+\d{1,2}\/\d{1,2}\/\d{4}/i.test(lines[k])) {
          weIdx = k;
          break;
        }
      }

      if (weIdx === -1) {
        debug.skipped.push({
          lineIndex: i,
          line,
          reason: "no W/E date found in next 10 lines",
          currentUpc,
        });
        continue;
      }

      const customerName = normalizeCustomerName(lines.slice(i + 1, weIdx).join(" "));
      if (!customerName) {
        debug.skipped.push({
          lineIndex: i,
          line,
          reason: "empty customer name before W/E",
          currentUpc,
        });
        continue;
      }

      let amount: number | null = null;
      let amountIdx = -1;

      const weLineAmount = extractAmount(lines[weIdx]);
      if (weLineAmount !== null) {
        amount = weLineAmount;
        amountIdx = weIdx;
      }

      if (amount === null) {
        for (let k = weIdx + 1; k < Math.min(weIdx + 8, lines.length); k++) {
          const parsed = extractAmount(lines[k]);
          if (parsed !== null) {
            amount = parsed;
            amountIdx = k;
            break;
          }
        }
      }

      if (amount === null) {
        debug.skipped.push({
          lineIndex: i,
          line,
          reason: "no allowance amount found after W/E",
          currentUpc,
        });
        continue;
      }

      rows.push({
        upc: currentUpc,
        item: "",
        cust_name: customerName,
        amt: amount,
      });

      debug.parsedRows.push({
        lineIndex: i,
        upc: currentUpc,
        customer: customerName,
        amount,
        mode: "split-row",
      });

      if (amountIdx > i) i = amountIdx;
      continue;
    }
  }

  if (DEBUG_MODE) {
    console.log("=== SPOILS DEBUG START ===");
    console.log("UPC HEADERS:"); console.table(debug.upcHeaders);
    console.log("PARSED ROWS:"); console.table(debug.parsedRows);
    console.log("SKIPPED:"); console.table(debug.skipped);
    console.log("FINAL ROW COUNT:", rows.length);
    console.log("=== SPOILS DEBUG END ===");
  }

  return rows;
}

function isSpoilsFormat(text: string) {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  return (
    /customer\s+spoil(?:s|age)\s+allowance/i.test(normalized) ||
    /spoilage\s+detail\s+below/i.test(normalized) ||
    /UPC.*ITEM.*BRAND.*C(?:ust|ustomer).*Name.*Date.*Inv.*Qty.*Amt/i.test(normalized) ||
    (/UPC\s*:?/i.test(normalized) && /\bW\/E\b/i.test(normalized))
  );
}

// ─── FIXED parseFreshThymeSasPdfRows ─────────────────────────────────────────
function parseFreshThymeSasPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // DC customer
  let dcCustomer = "";
  for (let i = 0; i < lines.length; i++) {
    const sameLine = lines[i].match(/dc\s*#\s*[:\-]?\s*(\d+)/i);
    if (sameLine) { dcCustomer = `DC ${sameLine[1]}`; break; }
    if (/^dc\s*#\s*[:\-]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].match(/^(\d+)$/);
        if (next) { dcCustomer = `DC ${next[1]}`; break; }
      }
      if (dcCustomer) break;
    }
  }

  // EP Fee — handles both inline "EP FEE: $35.00" and split across lines
  let epFee = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/ep\s*fee/i.test(lines[i])) {
      // Try inline: "EP FEE: $35.00"
      const inlineMatch = lines[i].match(/ep\s*fee[^$]*\$\s*([\d,]+\.\d{2})/i);
      if (inlineMatch) {
        epFee = parseFloat(inlineMatch[1].replace(/,/g, ""));
        break;
      }
      // Try next few lines
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(/^\$?\s*([\d,]+\.\d{2})$/);
        if (m) { epFee = parseFloat(m[1].replace(/,/g, "")); break; }
      }
      if (epFee) break;
    }
  }

  console.log("[parseFreshThymeSasPdfRows] dcCustomer:", dcCustomer, "epFee:", epFee);
  console.log("[parseFreshThymeSasPdfRows] all lines:", lines);

  const raw: Array<{ upc: string; qty: number; amt: number }> = [];

  for (const l of lines) {
    const hasUpc = /^\d{12}\b/.test(l);
    const hasSummary = /ep\s*fee|chargeback|invoice\s+total|sub\s*total/i.test(l);
    const hasAmount = /\$\s*[\d,]+\.\d{2}/.test(l);

    if (hasUpc) {
      console.log("[parseFreshThymeSasPdfRows] candidate:", JSON.stringify(l), { hasUpc, hasSummary, hasAmount });
    }

    if (!hasUpc || hasSummary) continue;

    const um = l.match(/^(\d{12})/);
    // Last dollar amount on the line
    const allAmounts = [...l.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
    if (!um || !allAmounts.length) continue;

    const amt = parseFloat(allAmounts[allAmounts.length - 1][1].replace(/,/g, ""));

    // QTYShipped: number immediately before the last $ amount
    const afterUpc = l.slice(12).trim();
    const qtyMatch = afterUpc.match(/\b(\d+)\s+\$[\d,]+\.\d{2}\s*$/);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    raw.push({ upc: um[1], qty, amt });
  }

  console.log("[parseFreshThymeSasPdfRows] raw rows:", raw);

  if (!raw.length) return rows;

  const tq = raw.reduce((s, r) => s + r.qty, 0);

  for (const r of raw) {
    const epShare = epFee > 0 && tq > 0
      ? Math.round((r.qty / tq) * epFee * 100) / 100
      : 0;
    rows.push({
      upc: r.upc,
      item: "",
      cust_name: dcCustomer,
      amt: Math.round((r.amt + epShare) * 100) / 100,
    });
  }

  // Fix rounding drift on last row
  if (epFee > 0 && rows.length) {
    const totalEpAllocated = rows.reduce((s, r, i) => s + Math.round((r.amt - raw[i].amt) * 100) / 100, 0);
    const drift = Math.round((epFee - totalEpAllocated) * 100) / 100;
    if (drift !== 0) {
      rows[rows.length - 1].amt = Math.round((rows[rows.length - 1].amt + drift) * 100) / 100;
    }
  }

  console.log("[parseFreshThymeSasPdfRows] final rows:", rows);

  return rows;
}

function parseWMInvoicePdfRows(text: string): DatasetRow[] {
  const normalized = text
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ");

  // Only repair newline-split SKU suffix — do NOT repair space-separated
  // because "CK-CLAS-101- 44" would incorrectly merge qty into SKU.
  // The real split is: "CK-CLAS-101-44 $35.88 $1,578.72" on one line
  // and "12" (the suffix) on the next line.
  // So we repair: SKU ending in digits + newline + small number → merge suffix
  const preRepaired = normalized
    .replace(/((?:HP|CK|NSA)-[A-Z0-9]+-[A-Z0-9]+-)\s*\n\s*(\d{1,3})\b/gi, "$1$2");

  const lines = preRepaired
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  console.log("[parseWMInvoicePdfRows] lines after pre-repair:", lines);

  let customer = "";
  const customerMatch =
    preRepaired.match(/Ship to\s+([^\n]+(?:DC\d+)?)/i) ||
    preRepaired.match(/Ship to\s*\n([^\n]+)/i);
  if (customerMatch?.[1]) customer = customerMatch[1].trim();

  let maDeduction = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/\bma\s*2%/i.test(lines[i])) {
      const nearby: string[] = [];
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        if (/^total$/i.test(lines[j])) break;
        nearby.push(lines[j]);
      }
      const nearbyText = nearby.join(" ");
      const amounts = [...nearbyText.matchAll(/-\$([\d,]+\.\d{2})/g)];
      if (amounts.length > 0) {
        maDeduction = Math.abs(parseFloat(amounts[amounts.length - 1][1].replace(/,/g, "")));
      }
      break;
    }
  }

  // ROW_RE now also handles the case where the SKU suffix is on the next line:
  // "CK-CLAS-101-44 $35.88 $1,578.72\n12" → need to treat "12" as suffix not separate
  // We do a second pass on preRepaired to handle "SKU-DIGITS qty $rate $amt\nSUFFIX"
  // by rebuilding: find lines where next line is just 1-3 digits after a SKU data row
  // Replace the repairedLines loop with this:
const repairedLines: string[] = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const next = lines[i + 1] ?? "";

  // Detect: "...CK-CLAS-101- 44 $35.88 $1,578.72" where SKU has trailing dash+space
  // and next line "12" is the real suffix
  const brokenSkuMatch = line.match(
    /((?:HP|CK|NSA)-[A-Z0-9]+-[A-Z0-9]+-)\s+(\d+)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s*$/i
  );
  const nextIsSuffix = /^\d{1,3}$/.test(next.trim());

  if (brokenSkuMatch && nextIsSuffix) {
    // brokenSkuMatch[1] = "CK-CLAS-101-" (prefix with trailing dash)
    // brokenSkuMatch[2] = "44" (qty)
    // next = "12" (real suffix)
    const realSku = `${brokenSkuMatch[1]}${next.trim()}`; // "CK-CLAS-101-12"
    const fixedLine = line.replace(
      brokenSkuMatch[0],
      `${realSku} ${brokenSkuMatch[2]} $${brokenSkuMatch[3]} $${brokenSkuMatch[4]}`
    );
    repairedLines.push(fixedLine);
    i++; // skip suffix line
  } else {
    repairedLines.push(line);
  }
}

  const finalText = repairedLines.join("\n");
  console.log("[parseWMInvoicePdfRows] repairedLines:", repairedLines);

  const ROW_RE =
    /\b((?:HP|CK|NSA)-[A-Z0-9]+-[A-Z0-9]+(?:-\d+)?)\b\s+(\d+)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/gi;

  const raw: Array<{ upc: string; qty: number; grossAmt: number }> = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = ROW_RE.exec(finalText)) !== null) {
    const sku = normalizeSku(match[1]);
    const qty = parseInt(match[2], 10);
    const grossAmt = parseFloat(match[4].replace(/,/g, ""));
    const key = `${sku}__${qty}__${grossAmt}`;
    if (!seen.has(key)) { seen.add(key); raw.push({ upc: sku, qty, grossAmt }); }
  }

  console.log("[parseWMInvoicePdfRows] raw matches:", raw);

  if (!raw.length) return [];

  const totalQty = raw.reduce((sum, r) => sum + r.qty, 0);
  const grossTotal = round2(raw.reduce((sum, r) => sum + r.grossAmt, 0));

  let invoiceTotal = 0;
  for (let i = 0; i < repairedLines.length; i++) {
    if (/^total$/i.test(repairedLines[i])) {
      for (let j = i; j < Math.min(i + 4, repairedLines.length); j++) {
        const m = repairedLines[j].match(/\$([\d,]+\.\d{2})/);
        if (m) { invoiceTotal = parseFloat(m[1].replace(/,/g, "")); break; }
      }
      if (invoiceTotal) break;
    }
    const inlineTotal = repairedLines[i].match(/^total\s+\$([\d,]+\.\d{2})$/i);
    if (inlineTotal) { invoiceTotal = parseFloat(inlineTotal[1].replace(/,/g, "")); break; }
  }

  if (!maDeduction && invoiceTotal > 0 && grossTotal > invoiceTotal) {
    maDeduction = round2(grossTotal - invoiceTotal);
  }

  let runningMa = 0;
  const wmRows: DatasetRow[] = raw.map((r, idx) => {
    const isLast = idx === raw.length - 1;
    let maShare = 0;
    if (maDeduction > 0 && totalQty > 0) {
      if (isLast) {
        maShare = round2(maDeduction - runningMa);
      } else {
        maShare = round2(maDeduction * (r.qty / totalQty));
        runningMa = round2(runningMa + maShare);
      }
    }
    return {
      upc: r.upc,
      item: "",
      cust_name: customer,
      qty: r.qty,
      amt: round2(Math.max(r.grossAmt - maShare, 0)),
    };
  });

  const expectedNet = round2(Math.max(grossTotal - maDeduction, 0));
  const actualNet = round2(wmRows.reduce((sum, r) => sum + r.amt, 0));
  const drift = round2(expectedNet - actualNet);
  if (wmRows.length && drift !== 0) wmRows[wmRows.length - 1].amt = round2(wmRows[wmRows.length - 1].amt + drift);

  console.log("WM DEBUG", { customer, maDeduction, invoiceTotal, grossTotal, totalQty, rows: wmRows });
  return wmRows;
}

function parseDollarPromotionPdfRows(text: string): DatasetRow[] {
  console.log("[parseDollarPromotionPdfRows] INPUT TEXT:\n", text);

  const rows: DatasetRow[] = [];
  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let currentCustomer = "";

  for (const line of lines) {
    // Capture "SOLD TO: <customer name>" — everything after the colon
    const soldToMatch = line.match(/^SOLD\s+TO:\s*(.+)$/i);
    if (soldToMatch) {
      currentCustomer = soldToMatch[1].trim();
      console.log("[parseDollarPromotionPdfRows] SOLD TO:", currentCustomer);
      continue;
    }

    // Skip header/separator lines
    if (/UPC\s*#|---+/i.test(line)) continue;

    // Match data rows by leading 10-14 digit UPC
    const upcMatch = line.match(/^(\d{10,14})\s+/);
    if (!upcMatch) continue;

    // Extract last numeric value on the line as EXT-COST
    const allNumbers = [...line.matchAll(/([\d,]+\.\d{2})/g)];
    console.log("[parseDollarPromotionPdfRows] LINE:", line, "| ALL NUMBERS:", allNumbers.map(m => m[1]));

    if (!allNumbers.length) {
      console.log("[parseDollarPromotionPdfRows] SKIPPED (no numbers):", line);
      continue;
    }

    const extCost = parseFloat(
      allNumbers[allNumbers.length - 1][1].replace(/,/g, "")
    );

    if (!Number.isNaN(extCost) && extCost > 0) {
      const row: DatasetRow = {
        upc: upcMatch[1],
        item: "",
        cust_name: currentCustomer,
        amt: extCost,
      };
      console.log("[parseDollarPromotionPdfRows] PUSHED ROW:", row);
      rows.push(row);
    } else {
      console.log("[parseDollarPromotionPdfRows] SKIPPED (bad amount):", line, extCost);
    }
  }

  console.log("[parseDollarPromotionPdfRows] FINAL parsed rows:", rows);
  return rows;
}


function parseExcelProductDetailsRows(buffer: ArrayBuffer): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const wb = XLSX.read(buffer, { type: "array" });
  const sn = wb.SheetNames.find((n) => /product\s*details/i.test(n));
  if (!sn) return rows;

  const json = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sn], { defval: "" });
  if (!json.length) return rows;

  const keys = Object.keys(json[0]);
  const ck = keys.find((k) => /customer\s*name/i.test(k)) ?? "";
  const dk = keys.find((k) => /^division$/i.test(k)) ?? "";
  const hk = keys.find((k) => /kehe\s*dc/i.test(k)) ?? "";
  const ak = keys.find((k) => /scanned\s*sales/i.test(k)) ?? keys.find((k) => /bill\s*amount/i.test(k)) ?? "";
  const uk = keys.find((k) => /^upc$/i.test(k)) ?? "";
  const qk = keys.find((k) => /qty\s*ship/i.test(k)) ?? keys.find((k) => /^qty$/i.test(k)) ?? keys.find((k) => /qty/i.test(k)) ?? "";

  let epFee = 0;
  for (const sheetName of wb.SheetNames) {
    if (epFee) break;
    const allRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    for (let ri = 0; ri < allRows.length; ri++) {
      const row = allRows[ri];
      for (let ci = 0; ci < row.length; ci++) {
        if (/ep\s*fee/i.test(String(row[ci] || "").trim())) {
          for (let cj = ci + 1; cj < row.length; cj++) {
            const val = parseAmount(row[cj]);
            if (val !== null && val > 0) { epFee = val; break; }
          }
          if (!epFee && ri + 1 < allRows.length) {
            const nextRow = allRows[ri + 1];
            for (let cj = ci; cj < Math.min(ci + 3, nextRow.length); cj++) {
              const val = parseAmount(nextRow[cj]);
              if (val !== null && val > 0) { epFee = val; break; }
            }
          }
          break;
        }
      }
      if (epFee) break;
    }
  }

  const rawData: Array<{ upc: string; cust: string; amt: number; qty: number }> = [];
  for (const row of json) {
    const upc = String(row[uk] || "").trim();
    if (!upc || !/^\d{10,14}$/.test(upc)) continue;
    let cust = "";
    if (ck && row[ck]) cust = String(row[ck]).trim();
    else if (dk && row[dk]) cust = String(row[dk]).trim();
    else if (hk && row[hk]) cust = `DC ${String(row[hk]).trim()}`;
    const amt = parseAmount(row[ak]);
    if (amt === null || amt === 0) continue;
    rawData.push({ upc, cust, amt, qty: parseAmount(row[qk]) ?? 0 });
  }

  if (!rawData.length) return rows;
  const totalQty = rawData.reduce((s, r) => s + r.qty, 0);
  for (const r of rawData) {
    const epShare = epFee > 0 && totalQty > 0 ? (r.qty / totalQty) * epFee : 0;
    rows.push({ upc: r.upc, item: "", cust_name: r.cust, amt: Math.round((r.amt + epShare) * 100) / 100 });
  }

  return rows;
}

function parseNewItemSetupPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // DC customer
  let dcCustomer = "";
  for (let i = 0; i < lines.length; i++) {
    const sameLine = lines[i].match(/dc\s*#\s*[:\-]?\s*(\d+)/i);
    if (sameLine) { dcCustomer = `DC ${sameLine[1]}`; break; }
    if (/^dc\s*#\s*[:\-]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const next = lines[j].match(/^(\d+)$/);
        if (next) { dcCustomer = `DC ${next[1]}`; break; }
      }
      if (dcCustomer) break;
    }
  }

  // Invoice total — try inline first, then scan ALL subsequent lines (not just 4)
  // Also try extracting from the full text directly as a fallback
  let invoiceTotal = 0;

  // Strategy 1: inline on the same line as "invoice total"
  for (let i = 0; i < lines.length; i++) {
    if (/invoice\s+total/i.test(lines[i])) {
      const inlineMatch = lines[i].match(/\$?\s*([\d,]+\.\d{2})/);
      if (inlineMatch) {
        invoiceTotal = parseFloat(inlineMatch[1].replace(/,/g, ""));
        break;
      }
      // Strategy 2: scan forward up to 10 lines (was 4 — too tight)
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        // Skip noise lines
        if (/all\s+inquir/i.test(lines[j])) continue;
        if (/vendorsupport/i.test(lines[j])) continue;
        if (/accounts\s+due/i.test(lines[j])) continue;
        if (/payment\s+is\s+due/i.test(lines[j])) continue;
        const m = lines[j].match(/^\$?\s*([\d,]+\.\d{2})$/) ||
                  lines[j].match(/\$\s*([\d,]+\.\d{2})/);
        if (m) {
          invoiceTotal = parseFloat(m[1].replace(/,/g, ""));
          break;
        }
      }
      if (invoiceTotal) break;
    }
  }

  // Strategy 3: scan full text for any "$XX.XX" near "Invoice Total" 
  // handles cases where they're on the same line but regex grouping varies
  if (!invoiceTotal) {
    const totalMatch = text.match(/invoice\s+total[^\d$]*\$?\s*([\d,]+\.\d{2})/i);
    if (totalMatch) invoiceTotal = parseFloat(totalMatch[1].replace(/,/g, ""));
  }

  // Strategy 4: last-resort — find any dollar amount >= $50 in the doc
  // (these are always $50 per UPC for New Item Setup Fee)
  if (!invoiceTotal) {
    const allAmounts = [...text.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, "")))
      .filter((v) => v >= 50);
    if (allAmounts.length) invoiceTotal = allAmounts[0];
  }

  console.log("[parseNewItemSetupPdfRows] dcCustomer:", dcCustomer, "invoiceTotal:", invoiceTotal);

  // UPCs
  const upcs: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const m of [...line.matchAll(/\b(\d{10,14})\b/g)]) {
      // Exclude vendor numbers, special payee numbers, zip codes, phone numbers
      const v = m[1];
      if (v.length < 10) continue;
      // Exclude known non-UPC patterns: vendor#, special payee (87210556 = 8 digits, fine)
      // Only take 10-14 digit sequences
      if (!seen.has(v)) { seen.add(v); upcs.push(v); }
    }
  }

  console.log("[parseNewItemSetupPdfRows] upcs found:", upcs, "invoiceTotal:", invoiceTotal);

  if (!upcs.length || !invoiceTotal) return rows;

  const amtPerUpc = Math.round((invoiceTotal / upcs.length) * 100) / 100;
  for (const upc of upcs) {
    rows.push({ upc, item: "", cust_name: dcCustomer, amt: amtPerUpc });
  }

  return rows;
}

async function parseDetailRows(file: File, fullText?: string): Promise<DatasetRow[]> {
  console.log("[parseDetailRows] START", { fileName: file.name, providedFullText: !!fullText });

  if (await isExcelFile(file)) {
    console.log("[parseDetailRows] ROUTE -> Excel parser");
    return parseExcelProductDetailsRows(await file.arrayBuffer());
  }

  if (!(await isPdfFile(file))) throw new Error(`Unsupported document type for ${file.name}.`);

  const text = fullText ?? (await safeExtractPdfText(file)).fullText;
  const lt = text.toLowerCase();

  console.log("[parseDetailRows] FLAGS", {
    hasFreshThymeSas: /fresh\s+thyme\s+sas/i.test(lt),
    hasChargeback: /chargeback/i.test(lt),
    hasWonderMonday: /wonder\s*monday/i.test(lt),
    hasShipTo: /ship\s+to/i.test(lt),
    hasKehe: /kehe\s+distributors/i.test(lt),
    hasInvoiceNo: /invoice\s+no/i.test(lt),
    hasDistributorCharge: /distributor\s+charge/i.test(lt),
    hasSoldTo: /sold\s+to/i.test(lt),
    hasNewItemSetup: /new\s+item\s+set\s*up/i.test(lt),
    hasInvoiceTotal: /invoice\s+total/i.test(lt),
    hasDcHash: /dc\s*#/i.test(lt),
    hasUpcLabel: /UPC\s*:?/i.test(text),
    hasWE: /\bW\/E\b/i.test(text),
  });

  if (isSpoilsFormat(text)) {
    console.log("[parseDetailRows] ROUTE -> parseSpoilsPdfRows (FORCED)");
    return parseSpoilsPdfRows(text);
  }

  if (/fresh\s+thyme\s+sas/i.test(lt) && /chargeback/i.test(lt)) {
    console.log("[parseDetailRows] ROUTE -> parseFreshThymeSasPdfRows");
    return parseFreshThymeSasPdfRows(text);
  }

  if (
    /wonder\s*monday/i.test(lt) &&
    /ship\s+to/i.test(lt) &&
    /kehe\s+distributors/i.test(lt) &&
    /invoice\s+no/i.test(lt) &&
    !/customer\s+spoil/i.test(lt) &&
    !/UPC\s*:/i.test(lt)
  ) {
    console.log("[parseDetailRows] ROUTE -> parseWMInvoicePdfRows");
    return parseWMInvoicePdfRows(text);
  }

  if (/distributor\s+charge/i.test(lt) && /sold\s+to/i.test(lt)) {
    console.log("[parseDetailRows] ROUTE -> parseDollarPromotionPdfRows");
    return parseDollarPromotionPdfRows(text);
  }

  if (/new\s+item\s+set\s*up/i.test(lt) && /invoice\s+total/i.test(lt) && /dc\s*#/i.test(lt)) {
    console.log("[parseDetailRows] ROUTE -> parseNewItemSetupPdfRows");
    return parseNewItemSetupPdfRows(text);
  }

  console.log("[parseDetailRows] ROUTE -> parseSpoilsPdfRows");
  return parseSpoilsPdfRows(text);
}

function buildDatasetInsert(
  row: DatasetRow,
  productLookup: Map<string, string>,
  month: string,
  checkDate: string | null,
  invoiceNorm: string,
  type: string
): DatasetInsert {
  const normalizedType = normalizeType(type);
  const upc = normalizeSku(String(row.upc || "").trim());
  const amount = Number(row.amt || 0);
  return {
    month,
    check_date: checkDate,
    invoice: invoiceNorm,
    type: normalizedType,
    upc,
    item: productLookup.get(upc) || "",
    cust_name: String(row.cust_name || "").trim(),
    amt: isWmInvoiceType(normalizedType) ? round2(Math.abs(amount)) : round2(-Math.abs(amount)),
  };
}



async function replaceDatasetRowsForInvoice(
  invoice: string,
  file: File,
  options?: { categoryFallback?: string }
) {
  const ni = normalizeInvoiceNumber(invoice);
  if (!ni) return 0;

  let detailRows: DatasetRow[] = [];
  let categoryFallback = options?.categoryFallback || "";
  const detectedType = await detectFileTypeFromContent(file);

  if (detectedType === "excel") {
    detailRows = await parseDetailRows(file);
  } else if (detectedType === "pdf") {
    const { fullText } = await safeExtractPdfText(file);
    detailRows = await parseDetailRows(file, fullText);
    console.log("[replaceDatasetRowsForInvoice] detailRows:", detailRows);
    console.log("PARSED DETAIL ROWS", { invoice: ni, count: detailRows.length, rows: detailRows.slice(0, 10) });
    if (!categoryFallback) {
      const pm = parseMetadataFromText(fullText);
      if (pm.category !== "Unknown") categoryFallback = pm.category;
    }
  } else {
    throw new Error(`Unsupported document type for ${file.name}.`);
  }

  const [pl, it, invoiceAmt, invoiceCheckDate] = await Promise.all([
    fetchProductLookup(),
    fetchInvoiceType(ni),
    fetchInvoiceAmount(ni),
    fetchInvoiceCheckDate(ni),
  ]);

  console.log("[replaceDatasetRowsForInvoice] finalType raw:", it, "| categoryFallback:", categoryFallback);
  console.log("[replaceDatasetRowsForInvoice] invoiceCheckDate:", invoiceCheckDate);

  if (!invoiceCheckDate) {
    throw new Error(`No check date found in invoices for ${ni}. Upload the invoice Excel first.`);
  }

  const finalType = normalizeType(it || categoryFallback || "WM Invoice");
  console.log("[replaceDatasetRowsForInvoice] finalType normalized:", finalType);

  if (!detailRows.length) {
    detailRows = [{
      upc: "UNKNOWN",
      item: detectedType === "excel" ? "UNPARSED EXCEL DOCUMENT TEST 0406" : "UNPARSED PDF DOCUMENT TEST 0406",
      cust_name: "",
      amt: Math.abs(Number(invoiceAmt || 0)),
    }];
  }

  if (isWmInvoiceType(finalType)) {
    detailRows = detailRows.map((row) => ({
      ...row,
      upc: normalizeSku(row.upc || row.item || ""),
      amt: round2(Math.abs(Number(row.amt || 0))),
    }));
  }

  const datasetMonth = formatMonthLabelFromDate(invoiceCheckDate);
  const datasetCheckDate = parseIsoDateFromMmDdYyyy(invoiceCheckDate);

  const inserts: DatasetInsert[] = detailRows
    .filter((r) => {
      if (!isWmInvoiceType(finalType)) return true;
      const u = normalizeSku(r.upc);
      return u !== "MA2" && u !== "MA2%" && !/^ma\s*2%?$/i.test(r.upc);
    })
    .map((r) => buildDatasetInsert(r, pl, datasetMonth, datasetCheckDate, ni, finalType));

  console.log("[replaceDatasetRowsForInvoice] inserts:", inserts);

  const { error: deleteError } = await supabase.from("broker_commission_datasets").delete().eq("invoice", ni);
  if (deleteError) throw new Error(`Failed clearing old dataset rows: ${deleteError.message}`);
  if (!inserts.length) return 0;

  const { error: insertError } = await supabase
    .from("broker_commission_datasets")
    .insert(inserts);

  if (insertError) {
    throw new Error(`Failed saving dataset rows: ${insertError.message}`);
  }

  console.log("[replaceDatasetRowsForInvoice] SUCCESS — rows saved:", inserts.length);
  return inserts.length;
}

async function reprocessAllUploads(
  onProgress: (msg: string) => void,
  fromDate?: string,
  toDate?: string
): Promise<{ processed: number; failed: number; totalRows: number }> {
  const { data: all, error } = await supabase.from("uploads").select("*");
  if (error) throw new Error(`Failed to fetch uploads: ${error.message}`);

  let processed = 0, failed = 0, totalRows = 0;

  const uploads = (all ?? []).filter((u) => {
    if (!u.file_path || !u.invoice) return false;
    if (!fromDate && !toDate) return true;
    const effectiveDate = u.uploaded_at || u.created_at || "";
    const effectiveIso = effectiveDate ? String(effectiveDate).slice(0, 10) : "";
    if (fromDate && effectiveIso && effectiveIso < fromDate) return false;
    if (toDate && effectiveIso && effectiveIso > toDate) return false;
    return true;
  });

  onProgress(`Found ${uploads.length} upload(s) in selected upload-date range...`);

  for (const u of uploads) {
    try {
      onProgress(`Processing ${u.file_name}...`);
      const { data: fd, error: de } = await supabase.storage.from(DOCUMENT_BUCKET).download(u.file_path);
      if (de || !fd) { onProgress(`Failed download: ${u.file_name}`); failed++; continue; }

      const inferredType = detectStoredFileType(u.file_name, u.file_type);
      const mimeType = inferredType === "excel" ? getExcelMimeType(u.file_name) : "application/pdf";
      const f = new File([fd], u.file_name || "upload", { type: mimeType });
      const inserted = await replaceDatasetRowsForInvoice(u.invoice, f, { categoryFallback: u.category || "" });

      totalRows += inserted;
      processed++;
      onProgress(`Processed ${u.file_name}: ${inserted} row(s) saved.`);
    } catch (e: any) {
      console.error(`[reprocess] Failed ${u.file_name}:`, e);
      onProgress(`Failed ${u.file_name}: ${e?.message || "Unknown error"}`);
      failed++;
    }
  }

  return { processed, failed, totalRows };
}

async function syncInvoiceFromUpload(invoice: string, type: string) {
  if (!invoice || invoice === "Unknown") return;
  const ni = normalizeInvoiceNumber(invoice);
  const { data, error } = await supabase.from("invoices").select("id,invoice_number").limit(5000);
  if (error) return;
  const matched = (data || []).find((r) => normalizeInvoiceNumber(r.invoice_number || "") === ni);
  if (!matched) return;
  await supabase.from("invoices").update({ type: type === "Unknown" ? "" : type, doc_status: true }).eq("id", matched.id);
}

export default function InvoicesView({
  invoiceUploadSignal,
  documentUploadSignal,
  canReprocess = false,
  isAdmin = false,
}: {
  invoiceUploadSignal: number;
  documentUploadSignal: number;
  canReprocess?: boolean;
  isAdmin?: boolean;
}) {
  const [rows, setRows] = useState<InvoiceRecord[]>([]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessModalOpen, setReprocessModalOpen] = useState(false);
  const [reprocessFrom, setReprocessFrom] = useState("");
  const [reprocessTo, setReprocessTo] = useState("");

  const [deductionModal, setDeductionModal] = useState<NewDeductionTypeModal>({
    open: false, detectedName: "", docTypeName: "", deductionName: "",
    pendingFile: null, pendingMeta: null, pendingIsReplace: false, pendingExistingUpload: null,
  });

  const [deductionTypes, setDeductionTypes] = useState<DeductionTypeRecord[]>([]);

  const [upcModal, setUpcModal] = useState<NewUpcModal>({
    open: false, upcs: [], pendingInvoice: "", pendingPdfDate: "", pendingFile: null, pendingCategory: "",
  });

  const [existingDescriptions, setExistingDescriptions] = useState<string[]>([]);
  const [toast, setToast] = useState<{ show: boolean; text: string; type: ToastType }>({
    show: false, text: "", type: "success",
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [monthFilter, setMonthFilter] = useState("Month");
  const [typeFilter, setTypeFilter] = useState("Type");
  const [documentFilter, setDocumentFilter] = useState("Documents");
  const [documentDropdownOpen, setDocumentDropdownOpen] = useState(false);
  const [deleteMonth, setDeleteMonth] = useState("Delete Month");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvRef = useRef(invoiceUploadSignal);
  const lastDocRef = useRef(documentUploadSignal);
  const documentDropdownRef = useRef<HTMLDivElement | null>(null);

  const showToast = (text: string, type: ToastType = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, text, type });
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, show: false })), 4000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [{ data: id, error: ie }, { data: ud, error: ue }] = await Promise.all([
        supabase.from("invoices").select("*").order("check_date", { ascending: false }),
        supabase.from("uploads").select("*"),
      ]);
      if (ie) throw ie;
      if (ue) throw ue;
      setRows(id || []);
      setUploads(ud || []);
    } catch (e: any) {
      showToast(e.message || "Failed to load.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("Auth session:", session?.user?.email ?? "NO SESSION");
      if (!session) {
        showToast("You are not logged in. Please sign in.", "error");
        return;
      }
      loadData();
    });
    fetchDeductionTypes().then(setDeductionTypes);
    fetchProductLookup().then((map) => {
      setExistingDescriptions(Array.from(new Set(Array.from(map.values()).filter(Boolean))).sort());
    });
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  useEffect(() => {
    if (invoiceUploadSignal > 0 && invoiceUploadSignal !== lastInvRef.current) {
      lastInvRef.current = invoiceUploadSignal;
      invoiceInputRef.current?.click();
    }
  }, [invoiceUploadSignal]);

  useEffect(() => {
    if (documentUploadSignal > 0 && documentUploadSignal !== lastDocRef.current) {
      lastDocRef.current = documentUploadSignal;
      documentInputRef.current?.click();
    }
  }, [documentUploadSignal]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (documentDropdownRef.current && !documentDropdownRef.current.contains(event.target as Node)) {
        setDocumentDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const uploadMap = useMemo(() => {
    const m = new Map<string, UploadRecord>();
    for (const u of uploads) {
      if (u.invoice) m.set(normalizeInvoiceNumber(u.invoice), u);
    }
    return m;
  }, [uploads]);

  const withoutDocumentCount = useMemo(
    () => rows.filter((r) => { const n = normalizeInvoiceNumber(r.invoice_number || ""); return n ? !uploadMap.has(n) : false; }).length,
    [rows, uploadMap]
  );

  const monthOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.month || ""))).filter(Boolean),
    [rows]
  );

  const typeOptions = useMemo(() => {
    const v = new Set<string>();
    for (const r of rows) {
      const n = normalizeInvoiceNumber(r.invoice_number || "");
      const t = n ? uploadMap.get(n)?.category || r.type || "" : r.type || "";
      if (t.trim()) v.add(t.trim());
    }
    return Array.from(v).sort((a, b) => a.localeCompare(b));
  }, [rows, uploadMap]);

  const documentFilterLabel = useMemo(() => {
    if (documentFilter === "With Document") return "With Document";
    if (documentFilter === "Without Document") return "Without Document";
    return "Documents";
  }, [documentFilter]);

  const filteredRows = useMemo(
    () => rows.filter((row) => {
      const s = searchTerm.toLowerCase().trim();
      const n = normalizeInvoiceNumber(row.invoice_number || "");
      const hasDoc = !!(n && uploadMap.has(n));
      const liveType = n ? uploadMap.get(n)?.category || row.type || "" : row.type || "";
      return (
        (monthFilter === "Month" || row.month === monthFilter) &&
        (typeFilter === "Type" || liveType === typeFilter) &&
        (documentFilter === "Documents" ||
          (documentFilter === "With Document" && hasDoc) ||
          (documentFilter === "Without Document" && !hasDoc)) &&
        (!s ||
          (row.invoice_number || "").toLowerCase().includes(s) ||
          (row.dc_name || "").toLowerCase().includes(s) ||
          liveType.toLowerCase().includes(s) ||
          (row.check_number || "").toLowerCase().includes(s) ||
          String(row.check_amt ?? "").includes(s) ||
          (row.status || "").toLowerCase().includes(s))
      );
    }),
    [rows, searchTerm, monthFilter, typeFilter, documentFilter, uploadMap]
  );

  const openDocumentByInvoice = async (invoiceNumber: string | null) => {
    if (!invoiceNumber) return;
    const u = uploadMap.get(normalizeInvoiceNumber(invoiceNumber));
    if (!u?.file_path) return;
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(u.file_path, 60);
    if (error || !data?.signedUrl) { showToast("Unable to open file.", "error"); return; }
    try {
      const storedType = detectStoredFileType(u.file_name, u.file_type);
      if (storedType === "excel") {
        const a = document.createElement("a");
        a.href = data.signedUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.download = u.file_name || "document.xlsx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      showToast(e?.message || "Unable to open file.", "error");
    }
  };

  const handleInvoiceExcelUpload = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });

      const mappedRows = json.map((row) => {
        const cd = normalizeExcelDate(row["Check Date"]);
        const inv = String(row["Invoice #"] || "").trim();
        const mu = uploadMap.get(normalizeInvoiceNumber(inv));
        return {
          month: formatMonthShort(cd),
          check_date: cd,
          check_number: String(row["Check #"] || "").trim(),
          check_amt: parseAmount(row["Check Amt"]) ?? parseAmount(row["Check Amount"]) ?? null,
          invoice_number: inv,
          invoice_amt: parseAmount(row["Invoice Amt"]) ?? 0,
          dc_name: String(row["DC Name"] || "").trim(),
          status: String(row["Status"] || "").trim(),
          type: mu?.category || "",
          doc_status: !!mu,
        };
      }).filter((r) => r.invoice_number);

      if (!mappedRows.length) { showToast("No valid invoices found.", "info"); return; }

      const { data: ex, error: ee } = await supabase.from("invoices").select("invoice_number")
        .in("invoice_number", mappedRows.map((r) => r.invoice_number));
      if (ee) throw ee;

      const exSet = new Set((ex || []).map((i) => i.invoice_number).filter(Boolean));
      const newRows = mappedRows.filter((r) => !exSet.has(r.invoice_number));

      if (!newRows.length) { showToast("All invoices already exist.", "info"); return; }

      const { error: ie } = await supabase.from("invoices").upsert(newRows, { onConflict: "invoice_number", ignoreDuplicates: true });
      if (ie) throw ie;

      showToast(`${newRows.length} new invoice(s) added, ${mappedRows.length - newRows.length} skipped.`, "success");
      await loadData();
    } catch (e: any) {
      showToast(e.message || "Invoice upload failed.", "error");
    }
  };

  const handleInvoiceExcelChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!window.confirm("Are you sure you want to upload this file?")) {
      if (invoiceInputRef.current) invoiceInputRef.current.value = "";
      return;
    }
    await handleInvoiceExcelUpload(f);
    if (invoiceInputRef.current) invoiceInputRef.current.value = "";
  };

  const uploadNewDocument = async (
    file: File,
    meta: { category: string; invoice: string; pdf_date: string; file_type: "pdf" | "excel" }
  ) => {
    const fp = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const ct = getUploadContentType(file, meta.file_type);
    const nowIso = new Date().toISOString();
    await uploadToStorageWithRetry(fp, file, ct);
    const { error: de } = await supabase.from("uploads").insert({
      file_name: file.name, file_path: fp, file_type: meta.file_type,
      category: meta.category, invoice: meta.invoice, pdf_date: meta.pdf_date, uploaded_at: nowIso,
    });
    if (de) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([fp]);
      throw new Error(`${file.name}: ${de.message}`);
    }
    await syncInvoiceFromUpload(meta.invoice, meta.category);
  };

  const replaceExistingDocument = async (
    eu: UploadRecord,
    file: File,
    meta: { category: string; invoice: string; pdf_date: string; file_type: "pdf" | "excel" }
  ) => {
    if (!window.confirm(`A document already exists for invoice ${meta.invoice}. Replace with ${file.name}?`)) {
      return { skipped: true };
    }
    if (eu.file_path) await supabase.storage.from(DOCUMENT_BUCKET).remove([eu.file_path]);
    const fp = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const ct = getUploadContentType(file, meta.file_type);
    const nowIso = new Date().toISOString();
    await uploadToStorageWithRetry(fp, file, ct);
    const { error: de } = await supabase.from("uploads").update({
      file_name: file.name, file_path: fp, file_type: meta.file_type,
      category: meta.category, invoice: meta.invoice, pdf_date: meta.pdf_date, uploaded_at: nowIso,
    }).eq("id", eu.id);
    if (de) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([fp]);
      throw new Error(`${file.name}: ${de.message}`);
    }
    await syncInvoiceFromUpload(meta.invoice, meta.category);
    return { replaced: true };
  };

  const checkAndPromptUnknownUpcs = async (invoice: string, uploadDate: string, file: File, category: string) => {
    const parsed = await parseDetailRows(file);
    if (!parsed.length) return;
    const productMap = await fetchProductLookup();
    const unknown = parsed.filter((r) => { const key = normalizeSku(r.upc || ""); return key && !productMap.has(key); });
    const uniqueUnknown = Array.from(new Map(unknown.map((r) => [r.upc, r])).values());
    if (!uniqueUnknown.length) return;
    setUpcModal({
      open: true,
      upcs: uniqueUnknown.map((r) => ({ upc: r.upc, description: r.item || "", descEditMode: false, descEditValue: r.item || "" })),
      pendingInvoice: invoice,
      pendingPdfDate: uploadDate,
      pendingFile: file,
      pendingCategory: category,
    });
  };

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (!window.confirm(files.length === 1 ? "Upload this file?" : `Upload ${files.length} files?`)) {
      if (documentInputRef.current) documentInputRef.current.value = "";
      return;
    }
    if (documentInputRef.current) documentInputRef.current.value = "";

    try {
      let ok = 0, rep = 0, skip = 0, savedRows = 0, failed = 0;
      const { data: ai, error: aie } = await supabase.from("invoices").select("id,invoice_number");
      if (aie) throw aie;

      const invoiceLookup = new Map<string, { id: number; invoice_number: string | null }>();
      for (const r of ai || []) invoiceLookup.set(normalizeInvoiceNumber(r.invoice_number || ""), r);

      for (const file of files) {
        try {
          const detectedType = await detectFileTypeFromContent(file);
          if (detectedType === "unknown") { showToast(`${file.name}: unsupported file type.`, "error"); skip++; continue; }

          const meta = await extractDocumentMetadata(file, deductionTypes);
          const ni = normalizeInvoiceNumber(meta.invoice);
          if (meta.invoice === "Unknown" || !ni) { showToast(`${file.name}: invoice reference not found.`, "error"); skip++; continue; }

          const matchedInvoice = invoiceLookup.get(ni);
          if (!matchedInvoice) { showToast(`${file.name}: invoice ${meta.invoice} not in invoices file.`, "error"); skip++; continue; }

          const knownTypes = deductionTypes.map((t) => t.deduction_type.toLowerCase());
          const isUnknownType = !meta.category || meta.category === "Unknown" || !knownTypes.includes(meta.category.toLowerCase());

          if (isUnknownType) {
            const { data: dup2 } = await supabase.from("uploads").select("*").eq("invoice", matchedInvoice.invoice_number).limit(1);
            const eu2 = dup2 && dup2.length > 0 ? dup2[0] : null;
            setDeductionModal({
              open: true,
              detectedName: meta.category === "Unknown" ? "" : meta.category,
              docTypeName: "",
              deductionName: meta.category === "Unknown" ? "" : meta.category,
              pendingFile: file,
              pendingMeta: { ...meta, invoice: matchedInvoice.invoice_number || meta.invoice },
              pendingIsReplace: !!eu2,
              pendingExistingUpload: eu2,
            });
            return;
          }

          const { data: dup, error: de } = await supabase.from("uploads").select("*").eq("invoice", matchedInvoice.invoice_number).limit(1);
          if (de) { showToast(`${file.name}: failed checking existing upload.`, "error"); failed++; continue; }

          const existingUpload = dup && dup.length > 0 ? dup[0] : null;
          const finalMeta = { ...meta, invoice: matchedInvoice.invoice_number || meta.invoice };

          if (existingUpload) {
            const r = await replaceExistingDocument(existingUpload, file, finalMeta);
            if (r.skipped) { skip++; continue; }
            savedRows += await replaceDatasetRowsForInvoice(finalMeta.invoice, file, { categoryFallback: finalMeta.category || "" });
            rep++;
            checkAndPromptUnknownUpcs(finalMeta.invoice, new Date().toISOString(), file, finalMeta.category || "").catch(console.error);
          } else {
            await uploadNewDocument(file, finalMeta);
            savedRows += await replaceDatasetRowsForInvoice(finalMeta.invoice, file, { categoryFallback: finalMeta.category || "" });
            ok++;
            checkAndPromptUnknownUpcs(finalMeta.invoice, new Date().toISOString(), file, finalMeta.category || "").catch(console.error);
          }
        } catch (fileErr: any) {
          console.error(`[handleDocumentChange] ${file.name}`, fileErr);
          showToast(fileErr?.message || `${file.name}: upload failed.`, "error");
          failed++;
        }
      }

      await loadData();
      showToast(`${ok} uploaded, ${rep} replaced, ${skip} skipped, ${failed} failed, ${savedRows} dataset rows saved.`, failed > 0 ? "info" : "success");
    } catch (e: any) {
      showToast(e.message || "File upload failed.", "error");
      await loadData();
    }
  };

  const handleSaveDeductionType = async () => {
    const { deductionName, docTypeName, pendingFile, pendingMeta, pendingIsReplace, pendingExistingUpload } = deductionModal;
    if (!deductionName.trim()) { showToast("Please enter a deduction type name.", "error"); return; }
    if (!pendingFile || !pendingMeta) return;
    try {
      await saveDeductionType(docTypeName.trim() || deductionName.trim(), deductionName.trim());
      const refreshed = await fetchDeductionTypes();
      setDeductionTypes(refreshed);
      const fm = { ...pendingMeta, category: deductionName.trim() };
      if (pendingIsReplace && pendingExistingUpload) {
        const r = await replaceExistingDocument(pendingExistingUpload, pendingFile, fm);
        if (!r.skipped) await replaceDatasetRowsForInvoice(fm.invoice, pendingFile, { categoryFallback: fm.category });
      } else {
        await uploadNewDocument(pendingFile, fm);
        await replaceDatasetRowsForInvoice(fm.invoice, pendingFile, { categoryFallback: fm.category });
      }
      checkAndPromptUnknownUpcs(fm.invoice, new Date().toISOString(), pendingFile, fm.category).catch(console.error);
      setDeductionModal((p) => ({ ...p, open: false }));
      await loadData();
      showToast(`Deduction type "${deductionName}" saved and file uploaded.`, "success");
    } catch (e: any) {
      showToast(e.message || "Failed to save.", "error");
    }
  };

  const handleSaveUpcs = async () => {
    const { upcs, pendingInvoice, pendingFile, pendingCategory } = upcModal;
    try {
      for (const entry of upcs) {
        const desc = entry.descEditMode ? entry.descEditValue : entry.description;
        if (entry.upc && desc.trim()) await saveProductListEntry(entry.upc, desc.trim());
      }
      if (pendingFile && pendingInvoice) {
        await replaceDatasetRowsForInvoice(pendingInvoice, pendingFile, { categoryFallback: pendingCategory });
      }
      const newMap = await fetchProductLookup();
      setExistingDescriptions(Array.from(new Set(Array.from(newMap.values()).filter(Boolean))).sort());
      setUpcModal((p) => ({ ...p, open: false }));
      await loadData();
      showToast("UPC(s) saved successfully.", "success");
    } catch (e: any) {
      showToast(e.message || "Failed to save UPCs.", "error");
    }
  };

  const doReprocess = async () => {
    setReprocessModalOpen(false);
    setReprocessing(true);
    showToast("Reprocessing uploads...", "info");
    try {
      const { processed, failed, totalRows } = await reprocessAllUploads(
        (msg) => showToast(msg, "info"),
        reprocessFrom || undefined,
        reprocessTo || undefined
      );
      await loadData();
      showToast(`Done! ${processed} processed, ${failed} failed, ${totalRows} rows saved.`, failed > 0 ? "info" : "success");
    } catch (e: any) {
      showToast(e.message || "Reprocess failed.", "error");
    } finally {
      setReprocessing(false);
    }
  };

  const toggleSelectOne = (id: number) =>
    setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const handleDeleteRow = async (row: InvoiceRecord) => {
    if (!window.confirm(`Delete invoice row ${row.invoice_number || ""}?`)) return;
  
    try {
      const { error } = await supabase
        .from("invoices")
        .delete()
        .eq("id", row.id);
  
      if (error) throw error;
  
      showToast("Row deleted.", "success");
      await loadData();
    } catch (e: any) {
      showToast(e.message || "Delete failed.", "error");
    }
  };


  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0 && deleteMonth === "Delete Month") { showToast("No rows selected.", "info"); return; }
    if (!window.confirm("Are you sure you want to delete the data?")) return;
    try {
      if (selectedIds.length > 0) {
        const { error } = await supabase.from("invoices").delete().in("id", selectedIds);
        if (error) throw error;
      } else if (deleteMonth !== "Delete Month") {
        const { error } = await supabase.from("invoices").delete().eq("month", deleteMonth);
        if (error) throw error;
      }
      setSelectedIds([]);
      setDeleteMonth("Delete Month");
      showToast("Selected rows deleted.", "success");
      await loadData();
    } catch (e: any) {
      showToast(e.message || "Delete failed.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <input ref={invoiceInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleInvoiceExcelChange} />
      <input ref={documentInputRef} type="file" accept="application/pdf,.xlsx,.xls" multiple hidden onChange={handleDocumentChange} />

      {toast.show && (
        <div className="fixed right-6 top-6 z-[100]">
          <div className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${
            toast.type === "success" ? "border-green-200 bg-green-50 text-green-700"
              : toast.type === "error" ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-700"
          }`}>
            {toast.text}
          </div>
        </div>
      )}

      {reprocessModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-semibold">Reprocess Uploads</h3>
            <p className="mb-4 text-sm text-slate-500">Choose a date range to limit which uploads get reprocessed. Leave blank to reprocess all.</p>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">From Date</label>
                <input type="date" value={reprocessFrom} onChange={(e) => setReprocessFrom(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">To Date</label>
                <input type="date" value={reprocessTo} onChange={(e) => setReprocessTo(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setReprocessModalOpen(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={doReprocess} className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
                {reprocessFrom || reprocessTo ? "Reprocess Range" : "Reprocess All"}
              </button>
            </div>
          </div>
        </div>
      )}

{deductionModal.open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-semibold">Unknown Deduction Type</h3>
            <p className="mb-4 text-sm text-slate-500">
              {deductionModal.detectedName ? (
                <>
                  The detected type{" "}
                  <span className="font-semibold text-slate-700">
                    "{deductionModal.detectedName}"
                  </span>{" "}
                  is not in your deduction types. Would you like to add it?
                </>
              ) : (
                "No deduction type was detected. Please enter one to proceed."
              )}
            </p>

            <div className="mb-5 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Document Type
                </label>
                <input
                  type="text"
                  value={deductionModal.docTypeName}
                  onChange={(e) =>
                    setDeductionModal((p) => ({
                      ...p,
                      docTypeName: e.target.value,
                    }))
                  }
                  placeholder="e.g. Invoice, Chargeback, Credit Memo"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Deduction Type
                </label>

                <select
                  value={deductionModal.deductionName}
                  onChange={(e) => {
                    const selected = deductionTypes.find(
                      (t) => t.deduction_type === e.target.value
                    );

                    setDeductionModal((p) => ({
                      ...p,
                      deductionName: e.target.value,
                      docTypeName: selected?.document_type || p.docTypeName,
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="">Select deduction type</option>
                  {deductionTypes.map((t) => (
                    <option key={t.id} value={t.deduction_type}>
                      {t.deduction_type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() =>
                  setDeductionModal((p) => ({ ...p, open: false }))
                }
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDeductionType}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Save & Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {upcModal.open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-semibold">Unknown UPC{upcModal.upcs.length > 1 ? "s" : ""} Found</h3>
            <p className="mb-4 text-sm text-slate-500">
              The following UPC{upcModal.upcs.length > 1 ? "s were" : " was"} not found in the product list. Please add a description for each.
            </p>
            <div className="mb-5 max-h-80 space-y-4 overflow-auto">
              {upcModal.upcs.map((entry, idx) => (
                <div key={entry.upc} className="rounded-2xl border border-slate-100 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">UPC: {entry.upc}</p>
                  {entry.descEditMode ? (
                    <div className="flex gap-2">
                      <input type="text" value={entry.descEditValue}
                        onChange={(e) => setUpcModal((p) => ({ ...p, upcs: p.upcs.map((u, i) => i === idx ? { ...u, descEditValue: e.target.value } : u) }))}
                        placeholder="Enter item description"
                        className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-400"
                        autoFocus />
                      <button type="button"
                        onClick={() => setUpcModal((p) => ({ ...p, upcs: p.upcs.map((u, i) => i === idx ? { ...u, description: u.descEditValue, descEditMode: false } : u) }))}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white">Save</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-slate-700">{entry.description || <span className="text-slate-400">No description yet</span>}</p>
                      <button type="button"
                        onClick={() => setUpcModal((p) => ({ ...p, upcs: p.upcs.map((u, i) => i === idx ? { ...u, descEditMode: true } : u) }))}
                        className="rounded-xl border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">Edit</button>
                    </div>
                  )}
                  {!entry.descEditMode && existingDescriptions.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs text-slate-400">Pick existing description:</p>
                      <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
                        {existingDescriptions.slice(0, 100).map((desc) => (
                          <button key={`${entry.upc}-${desc}`} type="button"
                            onClick={() => setUpcModal((p) => ({ ...p, upcs: p.upcs.map((u, i) => i === idx ? { ...u, description: desc, descEditValue: desc } : u) }))}
                            className="rounded-full border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50">{desc}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setUpcModal((p) => ({ ...p, open: false }))} className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSaveUpcs} className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Save UPCs</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr]">
        <Card className="relative overflow-visible rounded-3xl">
          <CardContent className="overflow-visible pt-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              <div className="xl:col-span-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search invoice, DC, type, check #..." className="pl-9" />
                </div>
              </div>

              <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option>Month</option>
                {monthOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option>Type</option>
                {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <div className="relative z-50" ref={documentDropdownRef}>
                <button type="button" onClick={() => setDocumentDropdownOpen((p) => !p)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span>{documentFilterLabel}</span>
                    {withoutDocumentCount > 0 && (
                      <span onClick={(e) => { e.stopPropagation(); setDocumentFilter("Without Document"); setDocumentDropdownOpen(false); }}
                        className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 cursor-pointer" title="Show without documents">
                        {withoutDocumentCount > 99 ? "99+" : withoutDocumentCount}
                      </span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${documentDropdownOpen ? "rotate-180" : ""}`} />
                </button>
                {documentDropdownOpen && (
                  <div className="absolute left-0 top-full z-[120] mt-2 w-full min-w-[220px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    <button type="button" onClick={() => { setDocumentFilter("Documents"); setDocumentDropdownOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${documentFilter === "Documents" ? "bg-slate-50" : ""}`}>
                      <span>Documents</span>
                    </button>
                    <button type="button" onClick={() => { setDocumentFilter("With Document"); setDocumentDropdownOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${documentFilter === "With Document" ? "bg-slate-50" : ""}`}>
                      <span>With Document</span>
                    </button>
                    <button type="button" onClick={() => { setDocumentFilter("Without Document"); setDocumentDropdownOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${documentFilter === "Without Document" ? "bg-slate-50" : ""}`}>
                      <span>Without Document</span>
                      {withoutDocumentCount > 0 && (
                        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                          {withoutDocumentCount > 99 ? "99+" : withoutDocumentCount}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {canReprocess && isAdmin && (
                <Button type="button" variant="outline" onClick={() => setReprocessModalOpen(true)} disabled={reprocessing} className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />
                  {reprocessing ? "Processing..." : "Reprocess All"}
                </Button>
              )}

              <div className="flex gap-2">
                <Button type="button" variant={selectMode ? "default" : "outline"}
                  onClick={() => setSelectMode((p) => { const n = !p; if (!n) { setSelectedIds([]); setDeleteMonth("Delete Month"); } return n; })}
                  className="flex-1">Select</Button>
                <Button type="button" variant="destructive" onClick={handleDeleteSelected} disabled={!selectMode} className="flex-1">
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </Button>
              </div>
            </div>

            {selectMode && (
              <div className="mt-4 max-w-xs">
                <select value={deleteMonth} onChange={(e) => setDeleteMonth(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="Delete Month">Delete Month</option>
                  {monthOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl">
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-slate-500">Loading invoices...</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices found.</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-2xl border">
  <table className="min-w-full text-sm">
    <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    {selectMode && <th className="px-4 py-3 text-left font-semibold"></th>}
                    <th className="px-4 py-3 text-left font-semibold">Month</th>
                    <th className="px-4 py-3 text-left font-semibold">Check Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Check #</th>
                    <th className="px-4 py-3 text-left font-semibold">Check Amt</th>
                    <th className="px-4 py-3 text-left font-semibold">Invoice #</th>
                    <th className="px-4 py-3 text-left font-semibold">Invoice Amt</th>
                    <th className="px-4 py-3 text-left font-semibold">DC Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Type</th>
                    <th className="px-4 py-3 text-left font-semibold">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const ur = row.invoice_number ? uploadMap.get(normalizeInvoiceNumber(row.invoice_number)) : undefined;
                    const hasDoc = !!ur;
                    const displayMonth = formatMonthShort(row.check_date) || row.month || "";
                    const docType = ur ? detectStoredFileType(ur.file_name, ur.file_type) : null;
                    return (
                      <tr key={row.id} className="border-t">
                        {selectMode && (
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelectOne(row.id)} />
                          </td>
                        )}
                        <td className="px-4 py-3">{displayMonth}</td>
                        <td className="px-4 py-3">{row.check_date || ""}</td>
                        <td className="px-4 py-3">{row.check_number || ""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.check_amt)}</td>
                        <td className="px-4 py-3">{row.invoice_number || ""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.invoice_amt)}</td>
                        <td className="px-4 py-3">{row.dc_name || ""}</td>
                        <td className="px-4 py-3">{row.status || ""}</td>
                        <td className="px-4 py-3">{ur?.category || row.type || ""}</td>
                        <td className="px-4 py-3">
                          {hasDoc ? (
                            <button type="button" onClick={() => openDocumentByInvoice(row.invoice_number)}
                              className={docType === "excel" ? "text-green-600 hover:text-green-700" : "text-red-500 hover:text-red-700"}
                              title={docType === "excel" ? "Open Excel document" : "Open document"}>
                              {docType === "excel" ? <FileSpreadsheet className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                            </button>
                          ) : (
                            <button
  type="button"
  onClick={() => handleDeleteRow(row)}
  className="text-slate-300 hover:text-red-600"
  title="Delete row"
>
  <XCircle className="h-5 w-5" />
</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}