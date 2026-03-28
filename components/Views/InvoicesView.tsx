"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, FileText, XCircle, FileSpreadsheet } from "lucide-react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type UploadRecord = {
  id: number;
  created_at: string;
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

const DOCUMENT_BUCKET = "document-uploads";

function normalizeType(raw: string) {
  const cleaned = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (/\$\s*1\s*promotion/i.test(cleaned) || /\b1\s*dollar\s*promotion\b/i.test(cleaned)) return "$1 Promotion";
  if (/distributor\s+charge/i.test(cleaned)) return "$1 Promotion";
  if (/customer\s+spoils\s+allowance/i.test(cleaned)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage\s+natural/i.test(cleaned)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage/i.test(cleaned)) return "Customer Spoils Allowance";
  if (/pass\s+thru\s+deduction/i.test(cleaned) || /pass\s+through\s+deduction/i.test(cleaned)) return "Pass Thru Deduction";
  if (/fresh\s+thyme\s+ppf/i.test(cleaned)) return "Pass Thru Deduction";
  if (/new\s+item\s+setup\s+fee/i.test(cleaned) || /new\s+item\s+set\s*up\s+fee/i.test(cleaned)) return "New Item Setup Fee";
  if (/new\s+item\s+setup/i.test(cleaned) || /new\s+item\s+set\s*up/i.test(cleaned)) return "New Item Setup";
  if (/intro\s+allowance\s+audit/i.test(cleaned)) return "Intro Allowance Audit";
  if (/introductory\s+fee/i.test(cleaned)) return "Introductory Fee";
  if (/wm\s+invoice/i.test(cleaned)) return "WM Invoice";
  if (/wonder\s+monday/i.test(cleaned)) return "WM Invoice";
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
  const banned = new Set([
    "invoice", "wonder", "wondermonday", "monday", "billto", "shipto",
    "details", "date", "invoicedate", "invoiceno", "number", "unknown",
  ]);
  return banned.has(v);
}

function parseMetadataFromText(text: string) {
  const normalizedText = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  const lowerText = normalizedText.toLowerCase();

  let invoice = "Unknown";
  let category = "Unknown";
  let pdf_date = "Unknown";

  const isStrictWMInvoice =
    /wonder\s+monday/i.test(lowerText) &&
    /invoice\s+details/i.test(lowerText) &&
    /invoice\s+no\.?/i.test(lowerText) &&
    /invoice\s+date/i.test(lowerText) &&
    /bill\s+to/i.test(lowerText) &&
    /ship\s+to/i.test(lowerText);

  const isDollarPromotion =
    /distributor\s+charge/i.test(lowerText) &&
    /received\s+by\s+customer/i.test(lowerText) &&
    /invoice\s*#\s*[a-z0-9-]+/i.test(normalizedText);

  const isFreshThymePpf =
    /fresh\s+thyme\s+ppf/i.test(lowerText) ||
    (/special\s+payee\s+number/i.test(lowerText) &&
      /master\s+reference\s+no/i.test(lowerText) &&
      /po\s*#/i.test(lowerText) &&
      /wonder\s+monday/i.test(lowerText));

  if (isDollarPromotion) {
    category = "$1 Promotion";
  } else if (isStrictWMInvoice) {
    category = "WM Invoice";
  } else if (isFreshThymePpf) {
    category = "Pass Thru Deduction";
  } else {
    const knownTypeMatchers = [
      { pattern: /\$\s*1\s*promotion/i, value: "$1 Promotion" },
      { pattern: /\b1\s*dollar\s*promotion\b/i, value: "$1 Promotion" },
      { pattern: /distributor\s+charge/i, value: "$1 Promotion" },
      { pattern: /customer\s+spoils\s+allowance/i, value: "Customer Spoils Allowance" },
      { pattern: /customer\s+spoilage\s+natural/i, value: "Customer Spoils Allowance" },
      { pattern: /customer\s+spoilage/i, value: "Customer Spoils Allowance" },
      { pattern: /pass\s+thru\s+deduction/i, value: "Pass Thru Deduction" },
      { pattern: /pass\s+through\s+deduction/i, value: "Pass Thru Deduction" },
      { pattern: /fresh\s+thyme\s+ppf/i, value: "Pass Thru Deduction" },
      { pattern: /new\s+item\s+setup\s+fee/i, value: "New Item Setup Fee" },
      { pattern: /new\s+item\s+set\s*up\s+fee/i, value: "New Item Setup Fee" },
      { pattern: /new\s+item\s+setup/i, value: "New Item Setup" },
      { pattern: /new\s+item\s+set\s*up/i, value: "New Item Setup" },
      { pattern: /intro\s+allowance\s+audit/i, value: "Intro Allowance Audit" },
      { pattern: /introductory\s+fee/i, value: "Introductory Fee" },
      { pattern: /wonder\s+monday/i, value: "WM Invoice" },
    ];
    for (const matcher of knownTypeMatchers) {
      if (matcher.pattern.test(lowerText)) {
        category = matcher.value;
        break;
      }
    }
    if (category === "Unknown") {
      const typeMatch = normalizedText.match(
        /(?:Type|Description|Category)\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{3,100})/i
      );
      if (typeMatch?.[1]) category = normalizeType(typeMatch[1]);
    }
  }

  if (category === "$1 Promotion" || isDollarPromotion) {
    const promoInvoiceMatch = normalizedText.match(/invoice\s*#\s*[:\-]?\s*([A-Z0-9\-\/]+)/i);
    if (promoInvoiceMatch?.[1]) {
      const candidate = promoInvoiceMatch[1].trim();
      if (!isBadInvoiceCandidate(candidate)) invoice = normalizeInvoiceNumber(candidate);
    }
    const promoDateMatch =
      normalizedText.match(/\bdate\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i) ||
      normalizedText.match(/\bdate\b\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
    if (promoDateMatch?.[1]) pdf_date = normalizeDocDate(promoDateMatch[1]);
  }

  if (category === "WM Invoice" || isStrictWMInvoice) {
    const wmInvoiceMatch =
      normalizedText.match(/invoice\s*no\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i) ||
      normalizedText.match(/invoice\s*#\s*[:\-]?\s*([A-Z0-9\-\/]+)/i);
    if (wmInvoiceMatch?.[1]) {
      const candidate = wmInvoiceMatch[1].trim();
      if (!isBadInvoiceCandidate(candidate)) invoice = normalizeInvoiceNumber(candidate);
    }
    const wmDateMatch =
      normalizedText.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
      normalizedText.match(/ship\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (wmDateMatch?.[1]) pdf_date = normalizeDocDate(wmDateMatch[1]);
  }

  if (invoice === "Unknown" && category === "$1 Promotion") {
    const fb = normalizedText.match(/invoice\s*#\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i);
    if (fb?.[1]) {
      const candidate = fb[1].trim();
      if (!isBadInvoiceCandidate(candidate)) invoice = normalizeInvoiceNumber(candidate);
    }
    const dateFb =
      normalizedText.match(/\bdate\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i) ||
      normalizedText.match(/\bdate\b\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
    if (dateFb?.[1]) pdf_date = normalizeDocDate(dateFb[1]);
  }

  if (invoice === "Unknown" && category === "Pass Thru Deduction") {
    const ptMatch =
      normalizedText.match(/invoice\s*number\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i) ||
      normalizedText.match(/invoice\s*number\s*\n\s*([A-Z0-9.\-\/]+)/i) ||
      normalizedText.match(/invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i);
    if (ptMatch?.[1]) {
      const candidate = ptMatch[1].trim();
      if (!isBadInvoiceCandidate(candidate)) invoice = normalizeInvoiceNumber(candidate);
    }
    const ptDate =
      normalizedText.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
      normalizedText.match(/date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (ptDate?.[1]) pdf_date = normalizeDocDate(ptDate[1]);
  }

  if (invoice === "Unknown") {
    for (const pattern of [/\b(CN\d{9,})\b/i, /\b(CS\d{6,})\b/i, /\b([A-Z]{1,6}\d{6,})\b/]) {
      const match = normalizedText.match(pattern);
      if (match?.[1] && !isBadInvoiceCandidate(match[1])) {
        invoice = normalizeInvoiceNumber(match[1]);
        break;
      }
    }
  }

  if (invoice === "Unknown") {
    for (const pattern of [
      /Invoice\s*(?:Number|No\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i,
      /Invoice\s*(?:Number|No\.?|#)\s*\n\s*([A-Z0-9.\-\/]+)/i,
    ]) {
      const match = normalizedText.match(pattern);
      if (match?.[1] && !isBadInvoiceCandidate(match[1])) {
        invoice = normalizeInvoiceNumber(match[1]);
        break;
      }
    }
  }

  if (invoice === "Unknown" && (category === "WM Invoice" || /wonder\s+monday/i.test(lowerText))) {
    const wmFb =
      normalizedText.match(/invoice\s*no\.?\s*[:\-]?\s*(\d{1,10})\b/i) ||
      normalizedText.match(/invoice\s*#\s*[:\-]?\s*(\d{1,10})\b/i);
    if (wmFb?.[1] && !isBadInvoiceCandidate(wmFb[1])) invoice = normalizeInvoiceNumber(wmFb[1]);
  }

  if (invoice === "Unknown") {
    const fb = normalizedText.match(/\b([A-Z]{0,10}\d[A-Z0-9.\-\/]{1,})\b/);
    if (fb?.[1] && !isBadInvoiceCandidate(fb[1])) invoice = normalizeInvoiceNumber(fb[1]);
  }

  if (pdf_date === "Unknown") {
    for (const pattern of [
      /\bDate\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
      /Invoice\s+date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2})\b/,
    ]) {
      const match = normalizedText.match(pattern);
      if (match?.[1]) { pdf_date = normalizeDocDate(match[1]); break; }
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

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join("\n");
    fullText += `\n${pageText}\n`;
  }

  return { pdf, fullText: fullText.trim() };
}

async function extractTextWithOcr(pdf: any) {
  const worker = await createWorker("eng");
  let fullText = "";
  try {
    for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
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
  return fullText.trim();
}

async function extractPdfMetadata(file: File) {
  const { pdf, fullText } = await extractTextWithPdfJs(file);
  let parsed = parseMetadataFromText(fullText);
  const enoughText =
    parsed.category !== "Unknown" || parsed.invoice !== "Unknown" || parsed.pdf_date !== "Unknown";
  if (!enoughText) {
    const ocrText = await extractTextWithOcr(pdf);
    parsed = parseMetadataFromText(ocrText);
  }
  return parsed;
}

async function extractExcelMetadata(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  let fullText = "";
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: "" });
    fullText += " " + rows.flat().map((c) => String(c || "").trim()).filter(Boolean).join(" ");
  }
  return parseMetadataFromText(fullText);
}

async function extractDocumentMetadata(file: File): Promise<{
  category: string; invoice: string; pdf_date: string; file_type: "pdf" | "excel";
}> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return { ...(await extractExcelMetadata(file)), file_type: "excel" };
  }
  return { ...(await extractPdfMetadata(file)), file_type: "pdf" };
}

function toMonthName(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "long" });
}

function normalizeExcelDate(value: unknown) {
  if (typeof value === "number") {
    const jsDate = XLSX.SSF.parse_date_code(value);
    if (!jsDate) return "";
    return `${String(jsDate.m).padStart(2, "0")}/${String(jsDate.d).padStart(2, "0")}/${jsDate.y}`;
  }
  if (!value) return "";
  const str = String(value).trim();
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
  }
  return str;
}

function parseAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const num = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isNaN(num) ? null : num;
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

function formatMonthLabelFromDate(value: string | null | undefined) {
  const iso = parseIsoDateFromMmDdYyyy(value);
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// parseDetailRowsFromText
//
// Tuned for KeHE Customer Spoils Allowance PDF format.
// Each data row looks like (may be split across pdfjs text items / lines):
//
//   850067781066  CHEESECAKE KEY LIME PIE  WONDR  KROGER 587, DALLAS
//   02/18/2026  6293487  12  2%  $.82
//
// Key fixes vs original:
//   1. Amount regex handles $.82 (no digit before decimal): \$(\d*\.\d{2})
//   2. Block window is 10 lines (pdfjs splits text items onto separate lines)
//   3. Date is NOT required — only amount is required to accept a row
//   4. Customer name matched by "STORENAME number, CITY" pattern
//   5. Brand short-code (WONDR) stripped from end of item description
//   6. Header rows (UPC ITEM...) and TOTAL line are explicitly skipped
// ---------------------------------------------------------------------------
function parseDetailRowsFromText(text: string): Array<{
  upc: string; item: string; cust_name: string; amt: number;
}> {
  const rows: Array<{ upc: string; item: string; cust_name: string; amt: number }> = [];

  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  console.log("[parseDetailRows] total lines:", lines.length);

  // Matches $0.82, $.82, $1.23, $24.60 at end of block
  const AMT_RE = /\$(\d*\.\d{2})\s*$/;
  // Per-row date: MM/DD/YYYY
  const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
  // UPC starts line: 12 digits (KeHE standard)
  const UPC_RE = /^(\d{12})\b/;
  // Skip header and total lines
  const SKIP_RE = /^(UPC\s|TOTAL\s*:)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_RE.test(line)) continue;
    if (!UPC_RE.test(line)) continue;

    // Join up to 10 lines to capture rows split by pdfjs
    const block = lines.slice(i, i + 10).join(" ");
    console.log("[parseDetailRows] candidate block:", block);

    const amtMatch = block.match(AMT_RE);
    if (!amtMatch) {
      console.log("[parseDetailRows] skipped — no amount");
      continue;
    }

    const upc = UPC_RE.exec(block)![1];
    const amt = parseFloat(amtMatch[1]); // e.g. "0.82" or ".82"

    // Slice out the middle: after UPC, before the $ amount token
    const amtIdx = block.lastIndexOf(amtMatch[0]);
    let middle = block.slice(upc.length, amtIdx).trim();

    // Remove inline date from middle
    const dateMatch = middle.match(DATE_RE);
    if (dateMatch) middle = middle.replace(dateMatch[0], "").trim();

    // Remove trailing numeric/percent tail: "<Inv#> <Qty> <Pct%>"
    // e.g. "6293487 12 2%" at the end
    middle = middle.replace(/\s+\d+\s+\d+\s*%\s*$/, "").trim();
    middle = middle.replace(/\s+\d+\s*%\s*$/, "").trim();
    middle = middle.replace(/\s+\d{5,}\s*$/, "").trim(); // lone invoice number leftover

    // Customer name pattern for KeHE Spoils: "KROGER 587, DALLAS" or "DILLONS 34, WICHITA"
    // Always: WORD(S) + space + digits + comma + space + WORD(S)
    const custMatch = middle.match(/\b([A-Z]+(?:\s+[A-Z]+)*\s+\d+,\s+[A-Z][A-Z\s]*)$/i);
    let item = "";
    let cust_name = "";

    if (custMatch) {
      cust_name = custMatch[1].trim();
      item = middle.slice(0, middle.length - custMatch[1].length).trim();
    } else {
      const parts = middle.split(/\s{2,}/);
      if (parts.length >= 2) {
        item = parts.slice(0, -1).join(" ").trim();
        cust_name = parts[parts.length - 1].trim();
      } else {
        item = middle.trim();
        cust_name = "";
      }
    }

    // Strip trailing brand code from item (short ALL-CAPS word like "WONDR")
    item = item.replace(/\s+[A-Z]{2,8}\s*$/, "").trim();

    if (!item && !cust_name) {
      console.log("[parseDetailRows] skipped — empty item and customer");
      continue;
    }

    console.log("[parseDetailRows] row:", { upc, item, cust_name, amt });
    rows.push({ upc, item, cust_name, amt });
  }

  console.log("[parseDetailRows] total rows parsed:", rows.length);
  return rows;
}

async function replaceDatasetRowsForInvoice(
  invoice: string,
  type: string,
  pdfDate: string,
  file: File
) {
  const normalizedInvoice = normalizeInvoiceNumber(invoice);
  if (!normalizedInvoice) return 0;

  const { fullText } = await extractTextWithPdfJs(file);
  console.log("FULL PDF TEXT:", fullText);

  const detailRows = parseDetailRowsFromText(fullText);
  console.log("PARSED DETAIL ROWS:", detailRows);

  if (detailRows.length === 0) return 0;

  const invoiceDateIso = parseIsoDateFromMmDdYyyy(pdfDate);
  const monthLabel = formatMonthLabelFromDate(pdfDate);

  const inserts = detailRows.map((row) => ({
    month: monthLabel,
    invoice: normalizedInvoice,
    invoice_date: invoiceDateIso,
    type: type === "Unknown" ? "" : type,
    upc: row.upc,
    item: row.item,
    cust_name: row.cust_name,
    amt: row.amt,
  }));

  await supabase.from("broker_commission_datasets").delete().eq("invoice", normalizedInvoice);

  const { error: insertError } = await supabase.from("broker_commission_datasets").insert(inserts);
  if (insertError) throw new Error(`Failed saving dataset rows: ${insertError.message}`);

  return inserts.length;
}

async function syncInvoiceFromUpload(invoice: string, type: string) {
  if (!invoice || invoice === "Unknown") return;
  const normalizedInvoice = normalizeInvoiceNumber(invoice);

  const { data: invoiceRows, error: lookupError } = await supabase
    .from("invoices").select("id, invoice_number").limit(5000);
  if (lookupError) throw new Error(`Failed to find invoice ${invoice}: ${lookupError.message}`);

  const matched = (invoiceRows || []).find(
    (row) => normalizeInvoiceNumber(row.invoice_number || "") === normalizedInvoice
  );
  if (!matched) return;

  const { error } = await supabase
    .from("invoices")
    .update({ type: type === "Unknown" ? "" : type, doc_status: true })
    .eq("id", matched.id);
  if (error) throw new Error(`Failed to sync invoice ${invoice}: ${error.message}`);
}

export default function InvoicesView({
  invoiceUploadSignal,
  documentUploadSignal,
}: {
  invoiceUploadSignal: number;
  documentUploadSignal: number;
}) {
  const [rows, setRows] = useState<InvoiceRecord[]>([]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ show: boolean; text: string; type: ToastType }>({
    show: false, text: "", type: "success",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [monthFilter, setMonthFilter] = useState("Month");
  const [typeFilter, setTypeFilter] = useState("Type");
  const [documentFilter, setDocumentFilter] = useState("Documents");
  const [deleteMonth, setDeleteMonth] = useState("Delete Month");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvoiceUploadSignalRef = useRef(invoiceUploadSignal);
  const lastDocumentUploadSignalRef = useRef(documentUploadSignal);

  const showToast = (text: string, type: ToastType = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, text, type });
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, show: false })), 2500);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [{ data: invoiceData, error: ie }, { data: uploadData, error: ue }] = await Promise.all([
        supabase.from("invoices").select("*").order("check_date", { ascending: false }),
        supabase.from("uploads").select("*"),
      ]);
      if (ie) throw ie;
      if (ue) throw ue;
      setRows(invoiceData || []);
      setUploads(uploadData || []);
    } catch (error: any) {
      showToast(error.message || "Failed to load invoices.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  useEffect(() => {
    if (invoiceUploadSignal > 0 && invoiceUploadSignal !== lastInvoiceUploadSignalRef.current) {
      lastInvoiceUploadSignalRef.current = invoiceUploadSignal;
      invoiceInputRef.current?.click();
    }
  }, [invoiceUploadSignal]);

  useEffect(() => {
    if (documentUploadSignal > 0 && documentUploadSignal !== lastDocumentUploadSignalRef.current) {
      lastDocumentUploadSignalRef.current = documentUploadSignal;
      documentInputRef.current?.click();
    }
  }, [documentUploadSignal]);

  const uploadMap = useMemo(() => {
    const map = new Map<string, UploadRecord>();
    for (const u of uploads) {
      if (u.invoice) map.set(normalizeInvoiceNumber(u.invoice), u);
    }
    return map;
  }, [uploads]);

  const withoutDocumentCount = useMemo(() =>
    rows.filter((row) => {
      const n = normalizeInvoiceNumber(row.invoice_number || "");
      return n ? !uploadMap.has(n) : false;
    }).length,
  [rows, uploadMap]);

  const monthOptions = useMemo(() =>
    Array.from(new Set(rows.map((r) => r.month || ""))).filter(Boolean),
  [rows]);

  const typeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const n = normalizeInvoiceNumber(row.invoice_number || "");
      const t = n ? uploadMap.get(n)?.category || row.type || "" : row.type || "";
      if (t.trim()) values.add(t.trim());
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [rows, uploadMap]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const search = searchTerm.toLowerCase().trim();
    const n = normalizeInvoiceNumber(row.invoice_number || "");
    const hasDoc = !!(n && uploadMap.has(n));
    const liveType = n ? uploadMap.get(n)?.category || row.type || "" : row.type || "";

    return (
      (monthFilter === "Month" || row.month === monthFilter) &&
      (typeFilter === "Type" || liveType === typeFilter) &&
      (documentFilter === "Documents" ||
        (documentFilter === "With Document" && hasDoc) ||
        (documentFilter === "Without Document" && !hasDoc)) &&
      (!search ||
        (row.invoice_number || "").toLowerCase().includes(search) ||
        (row.dc_name || "").toLowerCase().includes(search) ||
        liveType.toLowerCase().includes(search) ||
        (row.check_number || "").toLowerCase().includes(search) ||
        String(row.check_amt ?? "").includes(search) ||
        (row.status || "").toLowerCase().includes(search))
    );
  }), [rows, searchTerm, monthFilter, typeFilter, documentFilter, uploadMap]);

  const openDocumentByInvoice = async (invoiceNumber: string | null) => {
    if (!invoiceNumber) return;
    const uploadRow = uploadMap.get(normalizeInvoiceNumber(invoiceNumber));
    if (!uploadRow?.file_path) return;
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(uploadRow.file_path, 60);
    if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank");
    else showToast("Unable to open file.", "error");
  };

  const handleInvoiceExcelUpload = async (file: File) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]], { defval: "" }
      );

      const mappedRows = json
        .map((row) => {
          const checkDate = normalizeExcelDate(row["Check Date"]);
          const invoiceNumber = String(row["Invoice #"] || "").trim();
          const matchedUpload = uploadMap.get(normalizeInvoiceNumber(invoiceNumber));
          return {
            month: toMonthName(checkDate),
            check_date: checkDate,
            check_number: String(row["Check #"] || "").trim(),
            check_amt: parseAmount(row["Check Amt"]) ?? parseAmount(row["Check Amount"]) ?? parseAmount(row["Check Amt "]) ?? null,
            invoice_number: invoiceNumber,
            invoice_amt: parseAmount(row["Invoice Amt"]) ?? 0,
            dc_name: String(row["DC Name"] || "").trim(),
            status: String(row["Status"] || "").trim(),
            type: matchedUpload?.category || "",
            doc_status: !!matchedUpload,
          };
        })
        .filter((r) => r.invoice_number);

      if (mappedRows.length === 0) { showToast("No valid invoices found.", "info"); return; }

      const { data: existing, error: ee } = await supabase
        .from("invoices").select("invoice_number")
        .in("invoice_number", mappedRows.map((r) => r.invoice_number));
      if (ee) throw ee;

      const existingSet = new Set((existing || []).map((i) => i.invoice_number).filter(Boolean));
      const newRows = mappedRows.filter((r) => !existingSet.has(r.invoice_number));

      if (newRows.length === 0) { showToast("All invoices already exist. Nothing added.", "info"); return; }

      const { error: ie } = await supabase.from("invoices").insert(newRows);
      if (ie) throw ie;

      showToast(`${newRows.length} new invoice(s) added, ${mappedRows.length - newRows.length} skipped.`, "success");
      await loadData();
    } catch (error: any) {
      showToast(error.message || "Invoice upload failed.", "error");
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
    metadata: { category: string; invoice: string; pdf_date: string; file_type: "pdf" | "excel" }
  ) => {
    const filePath = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const contentType = metadata.file_type === "excel"
      ? file.name.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";

    const { error: se } = await supabase.storage.from(DOCUMENT_BUCKET).upload(filePath, file, { cacheControl: "3600", upsert: false, contentType });
    if (se) throw new Error(`${file.name}: ${se.message || "upload failed."}`);

    const { error: de } = await supabase.from("uploads").insert({
      file_name: file.name, file_path: filePath, file_type: metadata.file_type,
      category: metadata.category, invoice: metadata.invoice, pdf_date: metadata.pdf_date,
    });
    if (de) throw new Error(`${file.name}: ${de.message || "database save failed."}`);

    await syncInvoiceFromUpload(metadata.invoice, metadata.category);
  };

  const replaceExistingDocument = async (
    existingUpload: UploadRecord,
    file: File,
    metadata: { category: string; invoice: string; pdf_date: string; file_type: "pdf" | "excel" }
  ) => {
    if (!window.confirm(`A document already exists for invoice ${metadata.invoice}. Replace with ${file.name}?`)) return { skipped: true };

    if (existingUpload.file_path) await supabase.storage.from(DOCUMENT_BUCKET).remove([existingUpload.file_path]);

    const filePath = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const contentType = metadata.file_type === "excel"
      ? file.name.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";

    const { error: se } = await supabase.storage.from(DOCUMENT_BUCKET).upload(filePath, file, { cacheControl: "3600", upsert: false, contentType });
    if (se) throw new Error(`${file.name}: ${se.message || "upload failed."}`);

    const { error: de } = await supabase.from("uploads").update({
      file_name: file.name, file_path: filePath, file_type: metadata.file_type,
      category: metadata.category, invoice: metadata.invoice, pdf_date: metadata.pdf_date,
    }).eq("id", existingUpload.id);
    if (de) throw new Error(`${file.name}: ${de.message || "database update failed."}`);

    await syncInvoiceFromUpload(metadata.invoice, metadata.category);
    return { replaced: true };
  };

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    if (!window.confirm(selectedFiles.length === 1 ? "Upload this file?" : `Upload ${selectedFiles.length} files?`)) {
      if (documentInputRef.current) documentInputRef.current.value = "";
      return;
    }

    try {
      let successCount = 0, replaceCount = 0, skippedCount = 0, datasetRowCount = 0;

      const { data: allInvoices, error: aie } = await supabase.from("invoices").select("id, invoice_number");
      if (aie) throw aie;

      const invoiceLookup = new Map<string, { id: number; invoice_number: string | null }>();
      for (const row of allInvoices || []) invoiceLookup.set(normalizeInvoiceNumber(row.invoice_number || ""), row);

      for (const file of selectedFiles) {
        const metadata = await extractDocumentMetadata(file);
        const normalizedInvoice = normalizeInvoiceNumber(metadata.invoice);

        if (metadata.invoice === "Unknown" || !normalizedInvoice) {
          showToast(`${file.name}: invoice reference not found.`, "error");
          skippedCount++; continue;
        }

        const matchedInvoice = invoiceLookup.get(normalizedInvoice);
        if (!matchedInvoice) {
          showToast(`${file.name}: invoice ${metadata.invoice} not in invoices file.`, "error");
          skippedCount++; continue;
        }

        const { data: dup, error: de } = await supabase.from("uploads").select("*").eq("invoice", matchedInvoice.invoice_number).limit(1);
        if (de) { showToast(`${file.name}: failed checking existing file.`, "error"); skippedCount++; continue; }

        const existingUpload = dup && dup.length > 0 ? dup[0] : null;
        const finalMetadata = { ...metadata, invoice: matchedInvoice.invoice_number || metadata.invoice };

        if (existingUpload) {
          const result = await replaceExistingDocument(existingUpload, file, finalMetadata);
          if (result.skipped) { skippedCount++; continue; }
          if (finalMetadata.file_type === "pdf") {
            datasetRowCount += await replaceDatasetRowsForInvoice(finalMetadata.invoice, finalMetadata.category, finalMetadata.pdf_date, file);
          }
          replaceCount++; continue;
        }

        await uploadNewDocument(file, finalMetadata);
        if (finalMetadata.file_type === "pdf") {
          datasetRowCount += await replaceDatasetRowsForInvoice(finalMetadata.invoice, finalMetadata.category, finalMetadata.pdf_date, file);
        }
        successCount++;
      }

      await loadData();
      if (successCount > 0 || replaceCount > 0 || skippedCount > 0) {
        showToast(`${successCount} uploaded, ${replaceCount} replaced, ${skippedCount} skipped, ${datasetRowCount} dataset rows saved.`, "success");
      }
    } catch (error: any) {
      showToast(error.message || "File upload failed.", "error");
    } finally {
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const toggleSelectOne = (id: number) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

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
    } catch (error: any) {
      showToast(error.message || "Delete failed.", "error");
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

      <div className="sticky top-0 z-40 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <Card className="rounded-3xl">
          <CardContent className="space-y-4 pt-6">
            <div className={`grid gap-3 ${selectMode ? "md:grid-cols-7" : "md:grid-cols-6"}`}>
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search invoice, DC, status, type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="Month">Month</option>
                {monthOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="Type">Type</option>
                {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>

              <div className="relative">
                <select value={documentFilter} onChange={(e) => setDocumentFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-12 text-sm">
                  <option value="Documents">Documents</option>
                  <option value="With Document">With Document</option>
                  <option value="Without Document">Without Document{withoutDocumentCount > 0 ? ` (${withoutDocumentCount})` : ""}</option>
                </select>
                {withoutDocumentCount > 0 && (
                  <button type="button" onClick={() => setDocumentFilter("Without Document")}
                    className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-600"
                    title={`Show ${withoutDocumentCount} invoices without document`}>
                    {withoutDocumentCount > 99 ? "99+" : withoutDocumentCount}
                  </button>
                )}
              </div>

              {selectMode && (
                <select value={deleteMonth} onChange={(e) => setDeleteMonth(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="Delete Month">Delete Month</option>
                  {monthOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}

              <div className="flex gap-2">
                <Button type="button" variant={selectMode ? "default" : "outline"}
                  onClick={() => setSelectMode((prev) => { const next = !prev; if (!next) { setSelectedIds([]); setDeleteMonth("Delete Month"); } return next; })}
                  className="flex-1">
                  Select
                </Button>
                <Button type="button" variant="destructive" onClick={handleDeleteSelected} disabled={!selectMode} className="flex-1">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
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
            <div className="overflow-x-auto rounded-2xl border">
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
                    const uploadRow = row.invoice_number ? uploadMap.get(normalizeInvoiceNumber(row.invoice_number)) : undefined;
                    const hasDocument = !!uploadRow;
                    return (
                      <tr key={row.id} className="border-t">
                        {selectMode && (
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelectOne(row.id)} />
                          </td>
                        )}
                        <td className="px-4 py-3">{row.month || ""}</td>
                        <td className="px-4 py-3">{row.check_date || ""}</td>
                        <td className="px-4 py-3">{row.check_number || ""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.check_amt)}</td>
                        <td className="px-4 py-3">{row.invoice_number || ""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.invoice_amt)}</td>
                        <td className="px-4 py-3">{row.dc_name || ""}</td>
                        <td className="px-4 py-3">{row.status || ""}</td>
                        <td className="px-4 py-3">{uploadRow?.category || row.type || ""}</td>
                        <td className="px-4 py-3">
                          {hasDocument ? (
                            <button type="button" onClick={() => openDocumentByInvoice(row.invoice_number)}
                              className="text-red-600 hover:text-red-700"
                              title={uploadRow?.file_type === "excel" ? "Open Excel" : "Open PDF"}>
                              {uploadRow?.file_type === "excel" ? <FileSpreadsheet className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                            </button>
                          ) : (
                            <XCircle className="h-5 w-5 text-red-600" />
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