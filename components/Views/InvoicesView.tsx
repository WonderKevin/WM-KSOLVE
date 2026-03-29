"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, FileText, XCircle, FileSpreadsheet, RefreshCw } from "lucide-react";
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
type DatasetRow = { upc: string; item: string; cust_name: string; amt: number; };

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
  return String(raw || "").replace(/\s+/g, "").replace(/[.]+$/g, "").trim().toUpperCase();
}

function isBadInvoiceCandidate(value: string) {
  const v = normalizeInvoiceNumber(value).toLowerCase();
  if (!v) return true;
  return new Set(["invoice","wonder","wondermonday","monday","billto","shipto","details","date","invoicedate","invoiceno","number","unknown"]).has(v);
}

function parseAmount(value: unknown): number | null {
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

// "March '26" format
function formatMonthShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  // Try MM/DD/YYYY
  const mdy = String(dateStr).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(`${mdy[3]}-${mdy[1].padStart(2,"0")}-${mdy[2].padStart(2,"0")}T00:00:00`);
    if (!isNaN(d.getTime())) return `${d.toLocaleString("en-US",{month:"long"})} '${String(d.getFullYear()).slice(-2)}`;
  }
  // Try ISO or any date
  const d = new Date(String(dateStr));
  if (!isNaN(d.getTime())) return `${d.toLocaleString("en-US",{month:"long"})} '${String(d.getFullYear()).slice(-2)}`;
  return String(dateStr);
}

function formatMonthLabelFromDate(value: string | null | undefined): string {
  const iso = parseIsoDateFromMmDdYyyy(value);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US",{month:"long"})} '${String(d.getFullYear()).slice(-2)}`;
}

function normalizeExcelDate(value: unknown) {
  if (typeof value === "number") {
    const jsDate = XLSX.SSF.parse_date_code(value);
    if (!jsDate) return "";
    return `${String(jsDate.m).padStart(2,"0")}/${String(jsDate.d).padStart(2,"0")}/${jsDate.y}`;
  }
  if (!value) return "";
  const str = String(value).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  return str;
}

function parseMetadataFromText(text: string) {
  const norm = text.replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\s*\n\s*/g,"\n").trim();
  const lower = norm.toLowerCase();
  let invoice = "Unknown", category = "Unknown", pdf_date = "Unknown";

  const isWMInvoicePdf = /wonder\s*monday/i.test(lower) && /ship\s+to/i.test(lower) && /kehe\s+distributors/i.test(lower) && /invoice\s+no/i.test(lower);
  const isStrictWMInvoice = /wonder\s+monday/i.test(lower) && /invoice\s+details/i.test(lower) && /invoice\s+no\.?/i.test(lower) && /bill\s+to/i.test(lower) && /ship\s+to/i.test(lower);
  const isDollarPromotion = /distributor\s+charge/i.test(lower) && /received\s+by\s+customer/i.test(lower);
  const isFreshThymePpf = /fresh\s+thyme\s+ppf/i.test(lower) || (/special\s+payee\s+number/i.test(lower) && /master\s+reference\s+no/i.test(lower) && /wonder\s+monday/i.test(lower));
  const isFreshThymeSas = /fresh\s+thyme\s+sas/i.test(lower) && /chargeback/i.test(lower);

  if (isDollarPromotion) category = "$1 Promotion";
  else if (isStrictWMInvoice || isWMInvoicePdf) category = "WM Invoice";
  else if (isFreshThymePpf || isFreshThymeSas) category = "Pass Thru Deduction";
  else {
    const matchers = [
      {p:/\$\s*1\s*promotion/i,v:"$1 Promotion"},{p:/distributor\s+charge/i,v:"$1 Promotion"},
      {p:/customer\s+spoils\s+allowance/i,v:"Customer Spoils Allowance"},{p:/customer\s+spoilage/i,v:"Customer Spoils Allowance"},
      {p:/pass\s+thru\s+deduction/i,v:"Pass Thru Deduction"},{p:/fresh\s+thyme\s+ppf/i,v:"Pass Thru Deduction"},
      {p:/new\s+item\s+setup\s+fee/i,v:"New Item Setup Fee"},{p:/new\s+item\s+setup/i,v:"New Item Setup"},
      {p:/intro\s+allowance\s+audit/i,v:"Intro Allowance Audit"},{p:/introductory\s+fee/i,v:"Introductory Fee"},
      {p:/wonder\s+monday/i,v:"WM Invoice"},
    ];
    for (const {p,v} of matchers) { if (p.test(lower)) { category=v; break; } }
    if (category==="Unknown") { const m=norm.match(/(?:Type|Description|Category)\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{3,100})/i); if (m?.[1]) category=normalizeType(m[1]); }
  }

  if (category==="WM Invoice"||isStrictWMInvoice||isWMInvoicePdf) {
    const m=norm.match(/invoice\s*no\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i)||norm.match(/invoice\s*#\s*[:\-]?\s*([A-Z0-9\-\/]+)/i);
    if (m?.[1]&&!isBadInvoiceCandidate(m[1])) invoice=normalizeInvoiceNumber(m[1]);
    const d=norm.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)||norm.match(/ship\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (d?.[1]) pdf_date=normalizeDocDate(d[1]);
  }
  if (category==="$1 Promotion"||isDollarPromotion) {
    const m=norm.match(/invoice\s*#\s*0*(\d+)/i)||norm.match(/invoice\s+#(\d+)/i);
    if (m?.[1]&&!isBadInvoiceCandidate(m[1])) invoice=normalizeInvoiceNumber(m[1]);
    const d=norm.match(/\bdate\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
    if (d?.[1]) pdf_date=normalizeDocDate(d[1]);
  }
  if (invoice==="Unknown"&&(category==="Pass Thru Deduction"||isFreshThymeSas)) {
    const m=norm.match(/invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i);
    if (m?.[1]&&!isBadInvoiceCandidate(m[1])) invoice=normalizeInvoiceNumber(m[1]);
    const d=norm.match(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)||norm.match(/date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (d?.[1]) pdf_date=normalizeDocDate(d[1]);
  }
  if (invoice==="Unknown") {
    for (const p of [/\b(CN\d{9,})\b/i,/\b(CS\d{6,})\b/i,/\b([A-Z]{1,6}\d{6,})\b/]) { const m=norm.match(p); if (m?.[1]&&!isBadInvoiceCandidate(m[1])) { invoice=normalizeInvoiceNumber(m[1]); break; } }
  }
  if (invoice==="Unknown") {
    for (const p of [/Invoice\s*(?:Number|No\.?|#)\s*[:\-]?\s*([A-Z0-9.\-\/]+)/i]) { const m=norm.match(p); if (m?.[1]&&!isBadInvoiceCandidate(m[1])) { invoice=normalizeInvoiceNumber(m[1]); break; } }
  }
  if (invoice==="Unknown"&&(category==="WM Invoice"||/wonder\s+monday/i.test(lower))) {
    const m=norm.match(/invoice\s*no\.?\s*[:\-]?\s*(\d{1,10})\b/i)||norm.match(/invoice\s*#\s*[:\-]?\s*(\d{1,10})\b/i);
    if (m?.[1]&&!isBadInvoiceCandidate(m[1])) invoice=normalizeInvoiceNumber(m[1]);
  }
  if (invoice==="Unknown") { const m=norm.match(/\b([A-Z]{0,10}\d[A-Z0-9.\-\/]{1,})\b/); if (m?.[1]&&!isBadInvoiceCandidate(m[1])) invoice=normalizeInvoiceNumber(m[1]); }
  if (pdf_date==="Unknown") {
    for (const p of [/\bDate\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,/Invoice\s+date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,/Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/,/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2})\b/]) {
      const m=norm.match(p); if (m?.[1]) { pdf_date=normalizeDocDate(m[1]); break; }
    }
  }
  return { category, invoice, pdf_date };
}

async function extractTextWithPdfJs(file: File) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    fullText += "\n" + tc.items.map((i: any) => ("str" in i ? i.str : "")).join("\n") + "\n";
  }
  return { pdf, fullText: fullText.trim() };
}

async function extractTextWithOcr(pdf: any) {
  const worker = await createWorker("eng");
  let fullText = "";
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      fullText += "\n" + (await worker.recognize(canvas.toDataURL("image/png"))).data.text + "\n";
    }
  } finally { await worker.terminate(); }
  return fullText.trim();
}

async function extractPdfMetadata(file: File) {
  const { pdf, fullText } = await extractTextWithPdfJs(file);
  let parsed = parseMetadataFromText(fullText);
  if (parsed.category==="Unknown"&&parsed.invoice==="Unknown"&&parsed.pdf_date==="Unknown") {
    parsed = parseMetadataFromText(await extractTextWithOcr(pdf));
  }
  return parsed;
}

async function extractExcelMetadata(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  let fullText = "";
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
    fullText += " " + rows.flat().map((c) => String(c||"").trim()).filter(Boolean).join(" ");
  }
  return parseMetadataFromText(fullText);
}

async function extractDocumentMetadata(file: File): Promise<{ category: string; invoice: string; pdf_date: string; file_type: "pdf"|"excel" }> {
  const ln = file.name.toLowerCase();
  if (ln.endsWith(".xlsx")||ln.endsWith(".xls")) return { ...(await extractExcelMetadata(file)), file_type: "excel" };
  return { ...(await extractPdfMetadata(file)), file_type: "pdf" };
}

async function fetchProductLookup(): Promise<Map<string,string>> {
  const { data, error } = await supabase.from("product_list").select("upc, item_description");
  if (error) return new Map();
  const map = new Map<string,string>();
  for (const r of data??[]) if (r.upc) map.set(String(r.upc).trim(), r.item_description??"");
  return map;
}

async function fetchInvoiceType(invoiceNumber: string): Promise<string> {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  // Check invoices table first
  const { data: invData, error: invErr } = await supabase.from("invoices").select("type, invoice_number").limit(5000);
  if (!invErr) {
    const matched = (invData||[]).find(r => normalizeInvoiceNumber(r.invoice_number||"") === norm);
    if (matched?.type) return matched.type;
  }
  // Fall back to uploads table category (WM Invoice, $1 Promotion, etc.)
  const { data: upData, error: upErr } = await supabase.from("uploads").select("category, invoice").limit(5000);
  if (!upErr) {
    const matched = (upData||[]).find(r => normalizeInvoiceNumber(r.invoice||"") === norm);
    if (matched?.category) return matched.category;
  }
  return "";
}

// FORMAT 1: KeHE Spoils PDF
function parseSpoilsPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text.replace(/\u00a0/g," ").replace(/\r/g,"\n").replace(/[ \t]+/g," ").split("\n").map(l=>l.trim()).filter(Boolean);
  const UPC_RE=/^(\d{12})$/, AMT_RE=/^\$(\d*\.\d{2})$/, SKIP_RE=/^(UPC\s|TOTAL\s*:)/i;
  for (let i=0;i<lines.length;i++) {
    if (SKIP_RE.test(lines[i])||!UPC_RE.test(lines[i])) continue;
    const amtMatch=(lines[i+8]??"").match(AMT_RE);
    if (!amtMatch) continue;
    rows.push({ upc: lines[i], item: lines[i+1]??"", cust_name: lines[i+3]??"", amt: parseFloat(amtMatch[1]) });
  }
  return rows;
}

// FORMAT 2: Fresh Thyme SAS Chargeback PDF
function parseFreshThymeSasPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text.replace(/\u00a0/g," ").replace(/\r/g,"\n").replace(/[ \t]+/g," ").split("\n").map(l=>l.trim()).filter(Boolean);
  let epFee=0;
  for (const l of lines) { if (/ep\s*fee/i.test(l)) { const m=l.match(/\$(\d*\.\d{2})/); if (m) epFee=parseFloat(m[1]); } }
  const raw: Array<{upc:string;qty:number;amt:number}> = [];
  for (const l of lines) {
    if (!/^\d{12}\b/.test(l)||/ep\s*fee|chargeback|invoice\s+total|sub\s*total/i.test(l)) continue;
    const um=l.match(/^(\d{12})/), am=l.match(/\$(\d*\.\d{2})\s*$/);
    if (!um||!am) continue;
    const nums=(l.slice(12).trim().match(/\b(\d+)\b/g)||[]);
    raw.push({ upc:um[1], qty:nums.length?parseInt(nums[nums.length-1]):1, amt:parseFloat(am[1]) });
  }
  if (!raw.length) return rows;
  const tq=raw.reduce((s,r)=>s+r.qty,0);
  for (const r of raw) rows.push({ upc:r.upc, item:"", cust_name:"", amt:Math.round((r.amt+(tq>0?r.qty/tq*epFee:0))*100)/100 });
  return rows;
}

// FORMAT 3: WM Invoice PDF
// Confirmed pdfjs line structure — every token is its own line:
//   "HP-KEYL-134" → "110" → "$39.12" → "$4,303.20"
//   "MA 2%" → "KeHE MA 2%" → "1" → "−" → "$86.06" → "−" → "$86.06"
// Strategy: find the SKU line, then read qty=next line, skip rate, amount=line after rate
function parseWMInvoicePdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text.replace(/\u00a0/g," ").replace(/\r/g,"\n").replace(/[ \t]+/g," ").split("\n").map(l=>l.trim()).filter(Boolean);
  console.log("[WMInvoice] total lines:", lines.length);

  // Customer: first non-header line after "Ship to"
  let customer = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^ship\s+to$/i.test(lines[i])) {
      for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
        const c = lines[j].trim();
        if (c && !/^(bill\s+to|ship\s+to|shipping|invoice|note|#)/i.test(c)) { customer = c; break; }
      }
      break;
    }
  }

  // MA 2% amount — look for line with "MA 2%", then find the negative amount
  // pdfjs emits: "MA 2%" "KeHE MA 2%" "1" "−" "$86.06" "−" "$86.06"
  // The last "$XX.XX" after MA 2% row is the total MA amount
  let maAmount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^ma\s*2%$/i.test(lines[i])) {
      // Scan next 10 lines for dollar amounts, take the last one as the MA total
      const block = lines.slice(i, i + 10).join(" ");
      const amounts = [...block.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
      if (amounts.length > 0) {
        maAmount = -Math.abs(parseFloat(amounts[amounts.length - 1][1].replace(/,/g, "")));
      }
      break;
    }
  }

  // SKU pattern: a line that matches "XX-XXXX-XXX" format (e.g. HP-KEYL-134)
  // Following lines: qty (digits only), then rate ($X.XX), then amount ($X,XXX.XX)
  const SKU_RE = /^([A-Z]{2,6}-[A-Z]{2,8}-\d{2,4})$/;
  const AMT_RE = /^\$\s*([\d,]+\.\d{2})$/;
  const DIGITS_RE = /^\d+$/;

  const raw: Array<{upc: string; qty: number; amt: number}> = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const skuMatch = lines[i].match(SKU_RE);
    if (!skuMatch) continue;
    const sku = skuMatch[1];
    if (seen.has(sku)) continue;

    // Next line should be qty (pure digits)
    const qtyLine = lines[i + 1] ?? "";
    if (!DIGITS_RE.test(qtyLine)) continue;
    const qty = parseInt(qtyLine);

    // Then rate ($X.XX) — skip it
    // Then amount ($X,XXX.XX)
    // Look in next 5 lines for two consecutive $amounts
    let rate = "", amount = "";
    for (let j = i + 2; j < Math.min(i + 8, lines.length); j++) {
      if (AMT_RE.test(lines[j])) {
        if (!rate) { rate = lines[j]; }
        else { amount = lines[j]; break; }
      }
    }

    if (!amount) continue;
    const amtMatch = amount.match(AMT_RE);
    if (!amtMatch) continue;

    seen.add(sku);
    raw.push({ upc: sku, qty, amt: parseFloat(amtMatch[1].replace(/,/g, "")) });
  }

  console.log("[WMInvoice] customer:", customer, "| maAmount:", maAmount, "| raw:", JSON.stringify(raw));

  if (!raw.length) return rows;
  const tq = raw.reduce((s, r) => s + r.qty, 0);
  for (const r of raw) {
    rows.push({
      upc: r.upc, item: "", cust_name: customer,
      amt: Math.round((r.amt + (tq > 0 ? r.qty / tq * maAmount : 0)) * 100) / 100,
    });
  }
  return rows;
}

// FORMAT 4: $1 Promotion PDF (Distributor Charge)
// Confirmed pdfjs line structure — every token is its own line:
//   "SOLD TO:" → "KRO ATL 412, ATLANTA" (next line)
//   UPC row: "850067781097" → "12" → "WONDR CHEESECAKE" → ... → "12.00"
// EXT-COST is the last number in each UPC block (look ahead 10 lines)
function parseDollarPromotionPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text.replace(/\u00a0/g," ").replace(/\r/g,"\n").replace(/[ \t]+/g," ").split("\n").map(l=>l.trim()).filter(Boolean);
  console.log("[DollarPromo] total lines:", lines.length);

  let currentCustomer = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "SOLD TO:" with customer inline: "SOLD TO: QFC 101, BELFAIR"
    const soldToInline = line.match(/^sold\s+to:\s*(.+)/i);
    if (soldToInline && soldToInline[1].trim()) {
      currentCustomer = soldToInline[1].trim();
      continue;
    }

    // "SOLD TO:" alone — customer is on the next non-empty non-address line
    if (/^sold\s+to:\s*$/i.test(line)) {
      for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
        const next = lines[j].trim();
        // Skip pure zip codes, phone numbers, or very short strings
        // Customer lines: "KRO ATL 412, ATLANTA" or "PICK N SAVE #412" or "QFC 101, BELFAIR"
        if (next && !/^\d{5,}$/.test(next) && !/^telephone/i.test(next) && next.length > 3) {
          currentCustomer = next;
          break;
        }
      }
      continue;
    }

    // UPC row: exactly 12 digits
    if (!/^\d{12}$/.test(line)) continue;
    const upc = line;

    // EXT-COST: scan ahead up to 15 lines, collect all plain numbers/decimals
    // The last one before the next SOLD TO or UPC is EXT-COST
    let extCost = 0;
    for (let j = i+1; j < Math.min(i+15, lines.length); j++) {
      const l = lines[j];
      // Stop at next UPC or SOLD TO
      if (/^\d{12}$/.test(l) || /^sold\s+to/i.test(l)) break;
      // Match a plain number like "12.00" or "4.72" or "1.00"
      const numMatch = l.match(/^([\d,]+\.\d{2})$/);
      if (numMatch) extCost = parseFloat(numMatch[1].replace(/,/g, ""));
    }

    if (!extCost) continue;
    rows.push({ upc, item: "", cust_name: currentCustomer, amt: extCost });
  }

  console.log("[DollarPromo] rows:", JSON.stringify(rows));
  return rows;
}

// FORMAT 5: Excel Product Details
function parseExcelProductDetailsRows(buffer: ArrayBuffer): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const wb=XLSX.read(buffer,{type:"array"});
  const sn=wb.SheetNames.find(n=>/product\s*details/i.test(n));
  if (!sn) return rows;
  const json=XLSX.utils.sheet_to_json<Record<string,any>>(wb.Sheets[sn],{defval:""});
  if (!json.length) return rows;
  const keys=Object.keys(json[0]);
  const ck=keys.find(k=>/customer\s*name/i.test(k))??"";
  const dk=keys.find(k=>/^division$/i.test(k))??"";
  const hk=keys.find(k=>/kehe\s*dc/i.test(k))??"";
  const ak=keys.find(k=>/scanned\s*sales/i.test(k))??keys.find(k=>/bill\s*amount/i.test(k))??"";
  const uk=keys.find(k=>/^upc$/i.test(k))??"";
  for (const row of json) {
    const upc=String(row[uk]||"").trim();
    if (!upc||!/^\d{10,14}$/.test(upc)) continue;
    let cust="";
    if (ck&&row[ck]) cust=String(row[ck]).trim();
    else if (dk&&row[dk]) cust=String(row[dk]).trim();
    else if (hk&&row[hk]) cust=`DC ${String(row[hk]).trim()}`;
    const amt=parseAmount(row[ak]);
    if (amt===null||amt===0) continue;
    rows.push({ upc, item:"", cust_name:cust, amt });
  }
  return rows;
}


// FORMAT 6: New Item Setup Fee PDF (KeHE New Item Distribution)
// Cover page has: DC#: 19, Type: New Item Setup Fee, Invoice #: I41636519
// Item page has: UPC in row, Invoice Total = amount for all UPCs
// Customer = "DC {dc_number}" from cover page
function parseNewItemSetupPdfRows(text: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = text
    .replace(/\u00a0/g, " ").replace(/\r/g, "\n").replace(/[ \t]+/g, " ")
    .split("\n").map(l => l.trim()).filter(Boolean);

  console.log("[NewItemSetup] total lines:", lines.length);

  // Extract DC# for customer
  let dcCustomer = "";
  for (const line of lines) {
    const m = line.match(/^dc\s*#\s*[:\-]?\s*(\d+)/i);
    if (m) { dcCustomer = `DC ${m[1]}`; break; }
  }

  // Extract Invoice Total as the amount
  let invoiceTotal = 0;
  for (const line of lines) {
    if (/invoice\s+total/i.test(line)) {
      const m = line.match(/\$\s*([\d,]+\.\d{2})/);
      if (m) { invoiceTotal = parseFloat(m[1].replace(/,/g, "")); break; }
    }
  }
  // Also scan for standalone "$50.00" style after "Invoice Total:"
  if (!invoiceTotal) {
    for (let i = 0; i < lines.length; i++) {
      if (/invoice\s+total/i.test(lines[i])) {
        for (let j = i; j < Math.min(i + 4, lines.length); j++) {
          const m = lines[j].match(/^\$?\s*([\d,]+\.\d{2})$/);
          if (m) { invoiceTotal = parseFloat(m[1].replace(/,/g, "")); break; }
        }
        break;
      }
    }
  }

  // Extract UPCs — 10-14 digit numbers on their own or in item rows
  // Row format: "02601586 85006778110 WONDER MONDAY CHEESECAKE DBL CHOCOLAT 3/2/2026"
  const upcs: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    // Match 10-14 digit UPC (not a date or invoice number pattern)
    const matches = [...line.matchAll(/\b(\d{10,14})\b/g)];
    for (const m of matches) {
      const upc = m[1];
      if (seen.has(upc)) continue;
      // Skip obvious non-UPCs: zip codes (5 digits), invoice numbers starting with I
      if (upc.length < 10) continue;
      seen.add(upc);
      upcs.push(upc);
    }
  }

  console.log("[NewItemSetup] dcCustomer:", dcCustomer, "| invoiceTotal:", invoiceTotal, "| upcs:", upcs);

  if (!upcs.length || !invoiceTotal) return rows;

  // Distribute total evenly across all UPCs
  const amtPerUpc = Math.round((invoiceTotal / upcs.length) * 100) / 100;
  for (const upc of upcs) {
    rows.push({ upc, item: "", cust_name: dcCustomer, amt: amtPerUpc });
  }
  return rows;
}

async function parseDetailRows(file: File, fullText: string): Promise<DatasetRow[]> {
  const lt=fullText.toLowerCase(), ln=file.name.toLowerCase();
  if (ln.endsWith(".xlsx")||ln.endsWith(".xls")) return parseExcelProductDetailsRows(await file.arrayBuffer());
  if (/fresh\s+thyme\s+sas/i.test(lt)&&/chargeback/i.test(lt)) return parseFreshThymeSasPdfRows(fullText);
  if (/wonder\s*monday/i.test(lt)&&/ship\s+to/i.test(lt)&&/kehe\s+distributors/i.test(lt)&&/invoice\s+no/i.test(lt)) return parseWMInvoicePdfRows(fullText);
  if (/distributor\s+charge/i.test(lt)&&/sold\s+to/i.test(lt)) return parseDollarPromotionPdfRows(fullText);
  if (/new\s+item\s+set\s*up/i.test(lt)&&/invoice\s+total/i.test(lt)&&/dc\s*#/i.test(lt)) return parseNewItemSetupPdfRows(fullText);
  return parseSpoilsPdfRows(fullText);
}

async function replaceDatasetRowsForInvoice(invoice: string, pdfDate: string, file: File, categoryFallback = "") {
  const ni=normalizeInvoiceNumber(invoice);
  if (!ni) return 0;
  const ln=file.name.toLowerCase(), isExcel=ln.endsWith(".xlsx")||ln.endsWith(".xls");
  let detailRows: DatasetRow[]=[];
  if (isExcel) detailRows=parseExcelProductDetailsRows(await file.arrayBuffer());
  else { const {fullText}=await extractTextWithPdfJs(file); console.log("FULL PDF TEXT:",fullText); detailRows=await parseDetailRows(file,fullText); if (!categoryFallback) { const pm=parseMetadataFromText(fullText); if (pm.category!=="Unknown") categoryFallback=pm.category; } }
  console.log("PARSED DETAIL ROWS:",detailRows);
  if (!detailRows.length) return 0;
  const [pl,it]=await Promise.all([fetchProductLookup(),fetchInvoiceType(ni)]); const finalType=it||categoryFallback;
  const inserts=detailRows.map(r=>({ month:formatMonthLabelFromDate(pdfDate), invoice:ni, invoice_date:parseIsoDateFromMmDdYyyy(pdfDate), type:finalType, upc:r.upc, item:pl.get(r.upc)||r.item, cust_name:r.cust_name, amt:r.amt }));
  await supabase.from("broker_commission_datasets").delete().eq("invoice",ni);
  const {error}=await supabase.from("broker_commission_datasets").insert(inserts);
  if (error) throw new Error(`Failed saving dataset rows: ${error.message}`);
  return inserts.length;
}

async function reprocessAllUploads(onProgress:(msg:string)=>void): Promise<{processed:number;failed:number;totalRows:number}> {
  const {data:all,error}=await supabase.from("uploads").select("*");
  if (error) throw new Error(`Failed to fetch uploads: ${error.message}`);
  let processed=0,failed=0,totalRows=0;
  for (const u of all??[]) {
    if (!u.file_path||!u.invoice) continue;
    try {
      onProgress(`Processing ${u.file_name}...`);
      const {data:fd,error:de}=await supabase.storage.from(DOCUMENT_BUCKET).download(u.file_path);
      if (de||!fd) { failed++; continue; }
      const f=new File([fd],u.file_name,{ type:u.file_type==="excel"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf" });
      totalRows+=await replaceDatasetRowsForInvoice(u.invoice,u.pdf_date??"",f,u.category||"");
      processed++;
    } catch(e:any) { console.error(`Failed ${u.file_name}:`,e); failed++; }
  }
  return {processed,failed,totalRows};
}

async function syncInvoiceFromUpload(invoice: string, type: string) {
  if (!invoice||invoice==="Unknown") return;
  const ni=normalizeInvoiceNumber(invoice);
  const {data,error}=await supabase.from("invoices").select("id,invoice_number").limit(5000);
  if (error) return;
  const matched=(data||[]).find(r=>normalizeInvoiceNumber(r.invoice_number||"")===ni);
  if (!matched) return;
  await supabase.from("invoices").update({type:type==="Unknown"?"":type,doc_status:true}).eq("id",matched.id);
}

export default function InvoicesView({ invoiceUploadSignal, documentUploadSignal }: { invoiceUploadSignal: number; documentUploadSignal: number }) {
  const [rows,setRows]=useState<InvoiceRecord[]>([]);
  const [uploads,setUploads]=useState<UploadRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [reprocessing,setReprocessing]=useState(false);
  const [toast,setToast]=useState<{show:boolean;text:string;type:ToastType}>({show:false,text:"",type:"success"});
  const [searchTerm,setSearchTerm]=useState("");
  const [monthFilter,setMonthFilter]=useState("Month");
  const [typeFilter,setTypeFilter]=useState("Type");
  const [documentFilter,setDocumentFilter]=useState("Documents");
  const [deleteMonth,setDeleteMonth]=useState("Delete Month");
  const [selectMode,setSelectMode]=useState(false);
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  const invoiceInputRef=useRef<HTMLInputElement|null>(null);
  const documentInputRef=useRef<HTMLInputElement|null>(null);
  const toastTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lastInvRef=useRef(invoiceUploadSignal);
  const lastDocRef=useRef(documentUploadSignal);

  const showToast=(text:string,type:ToastType="success")=>{
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({show:true,text,type});
    toastTimerRef.current=setTimeout(()=>setToast(p=>({...p,show:false})),4000);
  };

  const loadData=async()=>{
    try {
      setLoading(true);
      const [{data:id,error:ie},{data:ud,error:ue}]=await Promise.all([
        supabase.from("invoices").select("*").order("check_date",{ascending:false}),
        supabase.from("uploads").select("*"),
      ]);
      if (ie) throw ie; if (ue) throw ue;
      setRows(id||[]); setUploads(ud||[]);
    } catch(e:any) { showToast(e.message||"Failed to load.","error"); }
    finally { setLoading(false); }
  };

  useEffect(()=>{ loadData(); return()=>{ if(toastTimerRef.current) clearTimeout(toastTimerRef.current); }; },[]);
  useEffect(()=>{ if(invoiceUploadSignal>0&&invoiceUploadSignal!==lastInvRef.current){ lastInvRef.current=invoiceUploadSignal; invoiceInputRef.current?.click(); } },[invoiceUploadSignal]);
  useEffect(()=>{ if(documentUploadSignal>0&&documentUploadSignal!==lastDocRef.current){ lastDocRef.current=documentUploadSignal; documentInputRef.current?.click(); } },[documentUploadSignal]);

  const uploadMap=useMemo(()=>{ const m=new Map<string,UploadRecord>(); for(const u of uploads) if(u.invoice) m.set(normalizeInvoiceNumber(u.invoice),u); return m; },[uploads]);
  const withoutDocumentCount=useMemo(()=>rows.filter(r=>{ const n=normalizeInvoiceNumber(r.invoice_number||""); return n?!uploadMap.has(n):false; }).length,[rows,uploadMap]);
  const monthOptions=useMemo(()=>Array.from(new Set(rows.map(r=>r.month||""))).filter(Boolean),[rows]);
  const typeOptions=useMemo(()=>{ const v=new Set<string>(); for(const r of rows){ const n=normalizeInvoiceNumber(r.invoice_number||""); const t=n?uploadMap.get(n)?.category||r.type||"":r.type||""; if(t.trim()) v.add(t.trim()); } return Array.from(v).sort((a,b)=>a.localeCompare(b)); },[rows,uploadMap]);

  const filteredRows=useMemo(()=>rows.filter(row=>{
    const s=searchTerm.toLowerCase().trim();
    const n=normalizeInvoiceNumber(row.invoice_number||"");
    const hasDoc=!!(n&&uploadMap.has(n));
    const liveType=n?uploadMap.get(n)?.category||row.type||"":row.type||"";
    return (monthFilter==="Month"||row.month===monthFilter)&&(typeFilter==="Type"||liveType===typeFilter)&&
      (documentFilter==="Documents"||(documentFilter==="With Document"&&hasDoc)||(documentFilter==="Without Document"&&!hasDoc))&&
      (!s||(row.invoice_number||"").toLowerCase().includes(s)||(row.dc_name||"").toLowerCase().includes(s)||liveType.toLowerCase().includes(s)||(row.check_number||"").toLowerCase().includes(s)||String(row.check_amt??"").includes(s)||(row.status||"").toLowerCase().includes(s));
  }),[rows,searchTerm,monthFilter,typeFilter,documentFilter,uploadMap]);

  const openDocumentByInvoice=async(invoiceNumber:string|null)=>{
    if (!invoiceNumber) return;
    const u=uploadMap.get(normalizeInvoiceNumber(invoiceNumber));
    if (!u?.file_path) return;
    const {data,error}=await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(u.file_path,60);
    if (!error&&data?.signedUrl) window.open(data.signedUrl,"_blank"); else showToast("Unable to open file.","error");
  };

  const handleInvoiceExcelUpload=async(file:File)=>{
    try {
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const json=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:""});
      const mappedRows=json.map(row=>{
        const cd=normalizeExcelDate(row["Check Date"]);
        const inv=String(row["Invoice #"]||"").trim();
        const mu=uploadMap.get(normalizeInvoiceNumber(inv));
        return { month:formatMonthShort(cd), check_date:cd, check_number:String(row["Check #"]||"").trim(), check_amt:parseAmount(row["Check Amt"])??parseAmount(row["Check Amount"])??null, invoice_number:inv, invoice_amt:parseAmount(row["Invoice Amt"])??0, dc_name:String(row["DC Name"]||"").trim(), status:String(row["Status"]||"").trim(), type:mu?.category||"", doc_status:!!mu };
      }).filter(r=>r.invoice_number);
      if (!mappedRows.length) { showToast("No valid invoices found.","info"); return; }
      const {data:ex,error:ee}=await supabase.from("invoices").select("invoice_number").in("invoice_number",mappedRows.map(r=>r.invoice_number));
      if (ee) throw ee;
      const exSet=new Set((ex||[]).map(i=>i.invoice_number).filter(Boolean));
      const newRows=mappedRows.filter(r=>!exSet.has(r.invoice_number));
      if (!newRows.length) { showToast("All invoices already exist.","info"); return; }
      const {error:ie}=await supabase.from("invoices").upsert(newRows,{onConflict:"invoice_number",ignoreDuplicates:true});
      if (ie) throw ie;
      showToast(`${newRows.length} new invoice(s) added, ${mappedRows.length-newRows.length} skipped.`,"success");
      await loadData();
    } catch(e:any) { showToast(e.message||"Invoice upload failed.","error"); }
  };

  const handleInvoiceExcelChange=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if (!f) return;
    if (!window.confirm("Are you sure you want to upload this file?")) { if(invoiceInputRef.current) invoiceInputRef.current.value=""; return; }
    await handleInvoiceExcelUpload(f);
    if (invoiceInputRef.current) invoiceInputRef.current.value="";
  };

  const uploadNewDocument=async(file:File,meta:{category:string;invoice:string;pdf_date:string;file_type:"pdf"|"excel"})=>{
    const fp=`${Date.now()}-${file.name.replace(/\s+/g,"-")}`;
    const ct=meta.file_type==="excel"?file.name.toLowerCase().endsWith(".xls")?"application/vnd.ms-excel":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf";
    const {error:se}=await supabase.storage.from(DOCUMENT_BUCKET).upload(fp,file,{cacheControl:"3600",upsert:false,contentType:ct});
    if (se) throw new Error(`${file.name}: ${se.message}`);
    const {error:de}=await supabase.from("uploads").insert({file_name:file.name,file_path:fp,file_type:meta.file_type,category:meta.category,invoice:meta.invoice,pdf_date:meta.pdf_date});
    if (de) throw new Error(`${file.name}: ${de.message}`);
    await syncInvoiceFromUpload(meta.invoice,meta.category);
  };

  const replaceExistingDocument=async(eu:UploadRecord,file:File,meta:{category:string;invoice:string;pdf_date:string;file_type:"pdf"|"excel"})=>{
    if (!window.confirm(`A document already exists for invoice ${meta.invoice}. Replace with ${file.name}?`)) return {skipped:true};
    if (eu.file_path) await supabase.storage.from(DOCUMENT_BUCKET).remove([eu.file_path]);
    const fp=`${Date.now()}-${file.name.replace(/\s+/g,"-")}`;
    const ct=meta.file_type==="excel"?file.name.toLowerCase().endsWith(".xls")?"application/vnd.ms-excel":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf";
    const {error:se}=await supabase.storage.from(DOCUMENT_BUCKET).upload(fp,file,{cacheControl:"3600",upsert:false,contentType:ct});
    if (se) throw new Error(`${file.name}: ${se.message}`);
    const {error:de}=await supabase.from("uploads").update({file_name:file.name,file_path:fp,file_type:meta.file_type,category:meta.category,invoice:meta.invoice,pdf_date:meta.pdf_date}).eq("id",eu.id);
    if (de) throw new Error(`${file.name}: ${de.message}`);
    await syncInvoiceFromUpload(meta.invoice,meta.category);
    return {replaced:true};
  };

  const handleDocumentChange=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]); if (!files.length) return;
    if (!window.confirm(files.length===1?"Upload this file?":`Upload ${files.length} files?`)) { if(documentInputRef.current) documentInputRef.current.value=""; return; }
    try {
      let ok=0,rep=0,skip=0,rows=0;
      const {data:ai,error:aie}=await supabase.from("invoices").select("id,invoice_number");
      if (aie) throw aie;
      const il=new Map<string,{id:number;invoice_number:string|null}>();
      for (const r of ai||[]) il.set(normalizeInvoiceNumber(r.invoice_number||""),r);
      for (const file of files) {
        const meta=await extractDocumentMetadata(file);
        const ni=normalizeInvoiceNumber(meta.invoice);
        if (meta.invoice==="Unknown"||!ni) { showToast(`${file.name}: invoice reference not found.`,"error"); skip++; continue; }
        const mi=il.get(ni);
        if (!mi) { showToast(`${file.name}: invoice ${meta.invoice} not in invoices file.`,"error"); skip++; continue; }
        const {data:dup,error:de}=await supabase.from("uploads").select("*").eq("invoice",mi.invoice_number).limit(1);
        if (de) { showToast(`${file.name}: failed checking existing.`,"error"); skip++; continue; }
        const eu=dup&&dup.length>0?dup[0]:null;
        const fm={...meta,invoice:mi.invoice_number||meta.invoice};
        if (eu) {
          const r=await replaceExistingDocument(eu,file,fm);
          if (r.skipped) { skip++; continue; }
          rows+=await replaceDatasetRowsForInvoice(fm.invoice,fm.pdf_date,file,fm.category||"");
          rep++; continue;
        }
        await uploadNewDocument(file,fm);
        rows+=await replaceDatasetRowsForInvoice(fm.invoice,fm.pdf_date,file,fm.category||"");
        ok++;
      }
      await loadData();
      if (ok>0||rep>0||skip>0) showToast(`${ok} uploaded, ${rep} replaced, ${skip} skipped, ${rows} dataset rows saved.`,"success");
    } catch(e:any) { showToast(e.message||"File upload failed.","error"); }
    finally { if(documentInputRef.current) documentInputRef.current.value=""; }
  };

  const handleReprocessAll=async()=>{
    if (!window.confirm("Re-parse all uploaded files and rebuild Data Sets table. Continue?")) return;
    setReprocessing(true); showToast("Reprocessing all uploads...","info");
    try {
      const {processed,failed,totalRows}=await reprocessAllUploads(msg=>showToast(msg,"info"));
      showToast(`Done! ${processed} processed, ${failed} failed, ${totalRows} rows saved.`,"success");
    } catch(e:any) { showToast(e.message||"Reprocess failed.","error"); }
    finally { setReprocessing(false); }
  };

  const toggleSelectOne=(id:number)=>setSelectedIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const handleDeleteSelected=async()=>{
    if (selectedIds.length===0&&deleteMonth==="Delete Month") { showToast("No rows selected.","info"); return; }
    if (!window.confirm("Are you sure you want to delete the data?")) return;
    try {
      if (selectedIds.length>0) { const {error}=await supabase.from("invoices").delete().in("id",selectedIds); if(error) throw error; }
      else if (deleteMonth!=="Delete Month") { const {error}=await supabase.from("invoices").delete().eq("month",deleteMonth); if(error) throw error; }
      setSelectedIds([]); setDeleteMonth("Delete Month");
      showToast("Selected rows deleted.","success"); await loadData();
    } catch(e:any) { showToast(e.message||"Delete failed.","error"); }
  };

  return (
    <div className="space-y-6">
      <input ref={invoiceInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleInvoiceExcelChange}/>
      <input ref={documentInputRef} type="file" accept="application/pdf,.xlsx,.xls" multiple hidden onChange={handleDocumentChange}/>
      {toast.show&&(
        <div className="fixed right-6 top-6 z-[100]">
          <div className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${toast.type==="success"?"border-green-200 bg-green-50 text-green-700":toast.type==="error"?"border-red-200 bg-red-50 text-red-700":"border-slate-200 bg-slate-50 text-slate-700"}`}>{toast.text}</div>
        </div>
      )}
      <div className="sticky top-0 z-40 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <Card className="rounded-3xl">
          <CardContent className="space-y-4 pt-6">
            <div className={`grid gap-3 ${selectMode?"md:grid-cols-8":"md:grid-cols-7"}`}>
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
                <Input placeholder="Search invoice, DC, status, type..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="pl-9"/>
              </div>
              <select value={monthFilter} onChange={e=>setMonthFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="Month">Month</option>{monthOptions.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
              <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="Type">Type</option>{typeOptions.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
              <div className="relative">
                <select value={documentFilter} onChange={e=>setDocumentFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-12 text-sm">
                  <option value="Documents">Documents</option>
                  <option value="With Document">With Document</option>
                  <option value="Without Document">Without Document{withoutDocumentCount>0?` (${withoutDocumentCount})`:""}</option>
                </select>
                {withoutDocumentCount>0&&<button type="button" onClick={()=>setDocumentFilter("Without Document")} className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-600">{withoutDocumentCount>99?"99+":withoutDocumentCount}</button>}
              </div>
              {selectMode&&<select value={deleteMonth} onChange={e=>setDeleteMonth(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="Delete Month">Delete Month</option>{monthOptions.map(o=><option key={o} value={o}>{o}</option>)}</select>}
              <Button type="button" variant="outline" onClick={handleReprocessAll} disabled={reprocessing} className="flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${reprocessing?"animate-spin":""}`}/>{reprocessing?"Processing...":"Reprocess All"}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant={selectMode?"default":"outline"} onClick={()=>setSelectMode(p=>{ const n=!p; if(!n){setSelectedIds([]);setDeleteMonth("Delete Month");} return n; })} className="flex-1">Select</Button>
                <Button type="button" variant="destructive" onClick={handleDeleteSelected} disabled={!selectMode} className="flex-1"><Trash2 className="mr-2 h-4 w-4"/>Delete</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-3xl">
        <CardContent className="pt-6">
          {loading?<p className="text-sm text-slate-500">Loading invoices...</p>:filteredRows.length===0?<p className="text-sm text-slate-500">No invoices found.</p>:(
            <div className="overflow-x-auto rounded-2xl border">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    {selectMode&&<th className="px-4 py-3 text-left font-semibold"></th>}
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
                  {filteredRows.map(row=>{
                    const ur=row.invoice_number?uploadMap.get(normalizeInvoiceNumber(row.invoice_number)):undefined;
                    const hasDoc=!!ur;
                    const displayMonth=formatMonthShort(row.check_date)||row.month||"";
                    return (
                      <tr key={row.id} className="border-t">
                        {selectMode&&<td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={()=>toggleSelectOne(row.id)}/></td>}
                        <td className="px-4 py-3">{displayMonth}</td>
                        <td className="px-4 py-3">{row.check_date||""}</td>
                        <td className="px-4 py-3">{row.check_number||""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.check_amt)}</td>
                        <td className="px-4 py-3">{row.invoice_number||""}</td>
                        <td className="px-4 py-3">{formatCurrency(row.invoice_amt)}</td>
                        <td className="px-4 py-3">{row.dc_name||""}</td>
                        <td className="px-4 py-3">{row.status||""}</td>
                        <td className="px-4 py-3">{ur?.category||row.type||""}</td>
                        <td className="px-4 py-3">
                          {hasDoc?(
                            <button type="button" onClick={()=>openDocumentByInvoice(row.invoice_number)} className="text-red-600 hover:text-red-700" title={ur?.file_type==="excel"?"Open Excel":"Open PDF"}>
                              {ur?.file_type==="excel"?<FileSpreadsheet className="h-5 w-5"/>:<FileText className="h-5 w-5"/>}
                            </button>
                          ):<XCircle className="h-5 w-5 text-red-600"/>}
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