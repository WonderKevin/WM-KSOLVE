import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type KsolveSearchRow = {
  Id: number;
  InvoiceNumber: string;
  JdeUpdateDate?: string | null;
  Remarks?: string | null;
  PoNumber?: string | null;
  InvoiceAmount?: number | null;
  InvoiceDate?: string | null;
  PayStatusCode?: string | null;
  ChargeTypeCode?: string | null;
  DcNumber?: string | null;
  DcNameDisplayable?: string | null;
  SpecialPayee?: number | null;
  Esn?: string | null;
  EsnAsString?: string | null;
  VendorName?: string | null;
  CheckNumber: number | null;
  CheckDate: string | null;
  CheckAmount?: number | null;
  DocumentUrl?: string | null;
  HasDocuments: boolean;
  CurrencyCode?: string | null;
  [key: string]: unknown;
};

type KsolveDocument = {
  DocumentLink: string;
  DocumentType: string;
  DocumentDisplayName: string;
  FileSizeInBytes: number | null;
  CreatedOn: string;
  FileSizeDisplayable: string;
};

type UploadedKsolveDocument = KsolveDocument & {
  StoragePath: string;
  SignedUrl: string | null;
};

type RunKsolveAutomationInput = {
  startDate: string;
  endDate: string;
  includeInvoiceSummary?: boolean;
  includeInvoiceFiles?: boolean;
};

type DeductionTypeRecord = {
  id?: string;
  document_type: string;
  deduction_type: string;
};

type DatasetRow = {
  upc: string;
  cust_name: string;
  amt: number;
};

type BrokerDatasetInsert = {
  month: string;
  check_date: string | null;
  invoice_date: string | null;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  cust_name: string;
  amt: number;
};

function parseIsoDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function formatKsolveDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatDisplayDate(date: string | null | undefined) {
  if (!date) return "";

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return "";

  return `${String(parsedDate.getMonth() + 1).padStart(2, "0")}/${String(
    parsedDate.getDate()
  ).padStart(2, "0")}/${parsedDate.getFullYear()}`;
}

function getMonthLabel(date: string | null | undefined) {
  if (!date) return "";

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return "";

  const month = parsedDate.toLocaleString("en-US", {
    month: "long",
  });
  const year = String(parsedDate.getFullYear()).slice(-2);

  return `${month} '${year}`;
}

function subtractDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() - days);
  return nextDate;
}

function isCheckDateInRange(
  checkDate: string | null,
  startDate: string,
  endDate: string
) {
  if (!checkDate) return false;

  const check = new Date(checkDate);
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  return check >= start && check <= end;
}

function getKsolveHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    authorization: `bearer ${process.env.KSOLVE_BEARER_TOKEN}`,
    cookie: process.env.KSOLVE_COOKIE || "",
    origin: "https://connect.kehe.com",
    referer: "https://connect.kehe.com/ksolve/",
    "content-type": "application/json;charset=UTF-8",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
  };
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function safeFilename(filename: string) {
  return filename.replace(/[<>:"/\\|?*]/g, "_");
}

function getFileType(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "excel";
  if (lower.endsWith(".csv")) return "csv";

  return "file";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function isSupportingDocument(document: KsolveDocument) {
  return document.DocumentType?.toLowerCase().trim() === "supporting document";
}

function normalizeType(raw: string) {
  const c = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();

  if (/\$\s*1\s*promotion/i.test(c) || /\b1\s*dollar\s*promotion\b/i.test(c)) {
    return "$1 Promotion";
  }

  if (/distributor\s+charge/i.test(c)) return "$1 Promotion";
  if (/customer\s+spoils\s+allowance/i.test(c)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage\s+natural/i.test(c)) return "Customer Spoils Allowance";
  if (/customer\s+spoilage/i.test(c)) return "Customer Spoils Allowance";
  if (/pass\s+thru\s+deduction/i.test(c) || /pass\s+through\s+deduction/i.test(c)) {
    return "Pass Thru Deduction";
  }
  if (/fresh\s+thyme\s+ppf/i.test(c)) return "Pass Thru Deduction";
  if (/kroger\s+disc/i.test(c) || /kroger\s+discount/i.test(c)) return "Pass Thru Deduction";
  if (/new\s+item\s+setup\s+fee/i.test(c) || /new\s+item\s+set\s*up\s+fee/i.test(c)) {
    return "New Item Setup Fee";
  }
  if (/new\s+item\s+setup/i.test(c) || /new\s+item\s+set\s*up/i.test(c)) {
    return "New Item Setup";
  }
  if (/intro\s+allowance\s+audit/i.test(c)) return "Intro Allowance Audit";
  if (/introductory\s+fee/i.test(c)) return "Introductory Fee";
  if (/wm\s+invoice/i.test(c) || /wonder\s+monday/i.test(c)) return "WM Invoice";

  return String(raw || "").replace(/\s+/g, " ").trim() || "Unknown";
}

function normalizeInvoiceNumber(raw: string | null | undefined) {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

function normalizeSku(raw: string | null | undefined) {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase()
    .trim();
}

function isWmInvoiceType(type: string) {
  return normalizeType(type) === "WM Invoice";
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

function formatDatasetDate(date: string | null | undefined) {
  if (!date) return null;
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return null;

  return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(
    parsedDate.getDate()
  ).padStart(2, "0")}`;
}

function parseExcelProductDetailsRows(buffer: Buffer): DatasetRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const productSheetName = workbook.SheetNames.find((name) => /product\s*details/i.test(name));
  if (!productSheetName) return [];

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[productSheetName], {
    defval: "",
  });
  if (!json.length) return [];

  const keys = Object.keys(json[0]);
  const customerKey = keys.find((key) => /customer\s*name/i.test(key)) ?? "";
  const divisionKey = keys.find((key) => /^division$/i.test(key)) ?? "";
  const dcKey = keys.find((key) => /kehe\s*dc/i.test(key)) ?? "";
  const amountKey =
    keys.find((key) => /bill\s*amount/i.test(key)) ??
    keys.find((key) => /scanned\s*sales/i.test(key)) ??
    "";
  const upcKey =
    keys.find((key) => /^upc$/i.test(key)) ??
    keys.find((key) => /upc/i.test(key)) ??
    "";
  const quantityKey =
    keys.find((key) => /qty\s*ship/i.test(key)) ??
    keys.find((key) => /^qty$/i.test(key)) ??
    keys.find((key) => /quantity/i.test(key)) ??
    keys.find((key) => /qty/i.test(key)) ??
    "";

  let extraFee = 0;

  for (const sheetName of workbook.SheetNames) {
    if (extraFee) break;

    const allRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });

    for (const row of allRows) {
      for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        const cellText = String(row[cellIndex] || "").trim();
        if (!/^(?:ep|processing)\s*fee\b/i.test(cellText)) continue;

        const inlineMatch = cellText.match(/(?:ep|processing)\s*fee[^0-9]*([\d,]+\.\d{2})/i);
        if (inlineMatch) {
          extraFee = Number(inlineMatch[1].replace(/,/g, ""));
          break;
        }

        for (let valueIndex = cellIndex + 1; valueIndex < row.length; valueIndex++) {
          const value = parseAmount(row[valueIndex]);
          if (value !== null) {
            extraFee = value;
            break;
          }
        }

        if (extraFee) break;
      }

      if (extraFee) break;
    }
  }

  const rawRows: Array<{ upc: string; cust_name: string; amt: number; qty: number | null }> = [];

  for (const row of json) {
    const upc = normalizeSku(String(row[upcKey] || "").trim());
    if (!upc || !/^\d{10,14}$/.test(upc)) continue;

    let custName = "";
    if (customerKey && row[customerKey]) custName = String(row[customerKey]).trim();
    else if (divisionKey && row[divisionKey]) custName = String(row[divisionKey]).trim();
    else if (dcKey && row[dcKey]) custName = `DC ${String(row[dcKey]).trim()}`;

    const amount = parseAmount(row[amountKey]);
    if (amount === null || amount === 0) continue;

    const quantityRaw = quantityKey ? parseAmount(row[quantityKey]) : null;
    rawRows.push({
      upc,
      cust_name: custName,
      amt: amount,
      qty: quantityRaw !== null && quantityRaw > 0 ? quantityRaw : null,
    });
  }

  if (!rawRows.length) return [];

  const hasAnyQuantity = rawRows.some((row) => row.qty !== null);
  const totalQuantity = rawRows.reduce((sum, row) => sum + (row.qty ?? 0), 0);
  const rows = rawRows.map((row) => {
    let feeShare = 0;
    if (extraFee > 0) {
      feeShare = hasAnyQuantity && totalQuantity > 0
        ? ((row.qty ?? 0) / totalQuantity) * extraFee
        : extraFee / rawRows.length;
    }

    return {
      upc: row.upc,
      cust_name: row.cust_name,
      amt: round2(row.amt + feeShare),
    };
  });

  if (extraFee > 0 && rows.length) {
    const expectedTotal = round2(rawRows.reduce((sum, row) => sum + row.amt, 0) + extraFee);
    const currentTotal = round2(rows.reduce((sum, row) => sum + row.amt, 0));
    const drift = round2(expectedTotal - currentTotal);
    if (drift !== 0) rows[rows.length - 1].amt = round2(rows[rows.length - 1].amt + drift);
  }

  return rows;
}

function normalizeForMatch(raw: string | null | undefined) {
  return normalizeType(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const KNOWN_DEDUCTION_TYPES = new Set([
  "$1 Promotion",
  "Customer Spoils Allowance",
  "Pass Thru Deduction",
  "New Item Setup Fee",
  "New Item Setup",
  "Intro Allowance Audit",
  "Introductory Fee",
  "WM Invoice",
]);

function getKnownDeductionType(raw: string | null | undefined) {
  const normalized = normalizeType(String(raw || ""));
  return KNOWN_DEDUCTION_TYPES.has(normalized) ? normalized : "";
}

function extractTextFromExcelBuffer(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  let text = "";

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    text +=
      " " +
      rows
        .flat()
        .map((cell) => String(cell || "").trim())
        .filter(Boolean)
        .join(" ");
  }

  return text.trim();
}

async function extractTextFromPdfBuffer(buffer: Buffer) {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjsLib.getDocument(new Uint8Array(buffer)).promise;

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pageTexts.push(
        textContent.items
          .map((item: unknown) =>
            typeof item === "object" && item && "str" in item
              ? String((item as { str?: string }).str || "")
              : ""
          )
          .filter(Boolean)
          .join(" ")
      );
    }

    return pageTexts.join("\n").trim();
  } catch (error) {
    console.warn("Failed reading downloaded PDF text for deduction type mapping:", error);
    return "";
  }
}

async function extractDocumentTextForMapping({
  buffer,
  filename,
  contentType,
}: {
  buffer: Buffer;
  filename: string;
  contentType: string;
}) {
  const lowerName = filename.toLowerCase();
  const lowerContentType = contentType.toLowerCase();

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerContentType.includes("spreadsheet") ||
    lowerContentType.includes("excel")
  ) {
    return extractTextFromExcelBuffer(buffer);
  }

  if (lowerName.endsWith(".pdf") || lowerContentType.includes("pdf")) {
    return extractTextFromPdfBuffer(buffer);
  }

  return "";
}

function getInvoiceType(row: KsolveSearchRow) {
  const invoiceNumber = String(row.InvoiceNumber || "").toUpperCase();

  if (row.ChargeTypeCode === "PV") return "WM Invoice";
  if (row.DocumentUrl) return "WM Invoice";

  if (invoiceNumber.startsWith("CN")) {
    return "Customer Spoils Allowance";
  }

  if (invoiceNumber.startsWith("CS")) {
    return "Customer Spoils Allowance";
  }

  if (
    invoiceNumber.startsWith("IAA") ||
    invoiceNumber.startsWith("PPF") ||
    invoiceNumber.startsWith("KD") ||
    invoiceNumber.startsWith("MCBP")
  ) {
    return "Pass Thru Deduction";
  }

  return "Unknown";
}

async function fetchDeductionTypes(): Promise<DeductionTypeRecord[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("deduction_types")
    .select("id, document_type, deduction_type");

  if (error) {
    console.warn(`Failed fetching deduction types: ${error.message}`);
    return [];
  }

  return data ?? [];
}

async function fetchProductLookupForDatasets() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("product_list").select("upc, item_description");

  if (error) {
    console.warn(`Failed fetching product lookup for dataset rows: ${error.message}`);
    return new Map<string, string>();
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const key = normalizeSku(String(row.upc || ""));
    if (key) map.set(key, row.item_description ?? "");
  }

  return map;
}

async function replaceAutomationExcelDatasetRows({
  buffer,
  row,
  invoice,
  category,
}: {
  buffer: Buffer;
  row: KsolveSearchRow;
  invoice: string;
  category: string;
}) {
  const invoiceNorm = normalizeInvoiceNumber(invoice);
  if (!invoiceNorm) return 0;

  const detailRows = parseExcelProductDetailsRows(buffer);
  if (!detailRows.length) {
    console.warn(`No Product Details dataset rows parsed for ${invoiceNorm}.`);
    return 0;
  }

  const datasetMonth = getMonthLabel(row.CheckDate);
  const datasetCheckDate = formatDatasetDate(row.CheckDate);
  if (!datasetMonth || !datasetCheckDate) {
    console.warn(`No check date available for ${invoiceNorm}; skipping dataset rows.`);
    return 0;
  }

  const finalType = normalizeType(category || getInvoiceType(row) || "Unknown");
  const productLookup = await fetchProductLookupForDatasets();
  const inserts: BrokerDatasetInsert[] = detailRows.map((detailRow) => {
    const upc = normalizeSku(detailRow.upc);
    const amount = Number(detailRow.amt || 0);

    return {
      month: datasetMonth,
      check_date: datasetCheckDate,
      invoice_date: isWmInvoiceType(finalType) ? formatDatasetDate(row.InvoiceDate) : null,
      invoice: invoiceNorm,
      type: finalType,
      upc,
      item: productLookup.get(upc) || "",
      cust_name: String(detailRow.cust_name || "").trim(),
      amt: isWmInvoiceType(finalType) ? round2(Math.abs(amount)) : round2(-Math.abs(amount)),
    };
  });

  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("broker_commission_datasets")
    .delete()
    .eq("invoice", invoiceNorm);

  if (deleteError) {
    throw new Error(`Failed clearing old dataset rows for ${invoiceNorm}: ${deleteError.message}`);
  }

  const { error: insertError } = await supabase
    .from("broker_commission_datasets")
    .insert(inserts);

  if (insertError) {
    throw new Error(`Failed saving dataset rows for ${invoiceNorm}: ${insertError.message}`);
  }

  return inserts.length;
}

function resolveAutomatedDeductionType({
  document,
  row,
  deductionTypes,
  documentText,
}: {
  document: KsolveDocument;
  row: KsolveSearchRow;
  deductionTypes: DeductionTypeRecord[];
  documentText?: string;
}) {
  const invoiceType = getInvoiceType(row);
  const textType = getKnownDeductionType(documentText);
  const candidates = [
    document.DocumentType,
    document.DocumentDisplayName,
    row.ChargeTypeCode || "",
    textType || documentText || "",
    invoiceType,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "Unknown");

  const normalizedCandidates = candidates.map(normalizeForMatch).filter(Boolean);

  const exactMatch = deductionTypes.find((record) => {
    const documentType = normalizeForMatch(record.document_type);
    return documentType && normalizedCandidates.includes(documentType);
  });

  if (exactMatch?.deduction_type) {
    return normalizeType(exactMatch.deduction_type);
  }

  const containsMatch = deductionTypes.find((record) => {
    const documentType = normalizeForMatch(record.document_type);
    if (!documentType) return false;

    return normalizedCandidates.some(
      (candidate) => candidate.includes(documentType) || documentType.includes(candidate)
    );
  });

  if (containsMatch?.deduction_type) {
    return normalizeType(containsMatch.deduction_type);
  }

  for (const candidate of candidates) {
    const knownType = getKnownDeductionType(candidate);
    if (knownType) return knownType;
  }

  if (invoiceType !== "Unknown") return invoiceType;

  console.warn(
    `No deduction type mapping found for invoice ${row.InvoiceNumber || "Unknown"}. ` +
      `DocumentType=${document.DocumentType || "Unknown"}; ` +
      `DocumentDisplayName=${document.DocumentDisplayName || "Unknown"}. ` +
      `Saving upload category as Unknown.`
  );

  return "Unknown";
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 5
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt < retries) {
        console.warn(`Fetch attempt ${attempt} returned retryable status ${response.status} for ${url}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 10000));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      console.warn(`Fetch attempt ${attempt} failed for ${url}`);
      console.warn(error);

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10000));
      }
    }
  }

  throw lastError;
}

async function insertUploadRecord({
  fileName,
  storagePath,
  category,
  invoice,
  pdfDate,
  fileType,
}: {
  fileName: string;
  storagePath: string;
  category: string;
  invoice: string;
  pdfDate: string;
  fileType: string;
}) {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("uploads").insert({
    file_name: fileName,
    file_path: storagePath,
    category,
    invoice,
    pdf_date: pdfDate,
    file_type: fileType,
  });

  if (error) {
    throw new Error(`Failed inserting upload record: ${error.message}`);
  }
}

async function upsertInvoiceRows(rows: KsolveSearchRow[]) {
  if (rows.length === 0) return;

  const supabase = getSupabaseClient();

  const invoiceRows = rows.map((row) => ({
    month: getMonthLabel(row.CheckDate),
    check_date: formatDisplayDate(row.CheckDate),
    check_number: row.CheckNumber ? String(row.CheckNumber) : "",
    invoice_number: row.InvoiceNumber || "",
    invoice_amt: row.InvoiceAmount ?? 0,
    dc_name: row.DcNameDisplayable || "",
    status: row.PayStatusCode || "",
    type: getInvoiceType(row),
    doc_status: row.HasDocuments ? "true" : "false",
    check_amt: row.CheckAmount ?? 0,
    deduction_type: row.ChargeTypeCode || null,
  }));

  const { error } = await supabase.from("invoices").upsert(invoiceRows, {
    onConflict: "invoice_number",
  });

  if (error) {
    throw new Error(`Failed upserting invoice rows: ${error.message}`);
  }
}

async function uploadBufferToSupabase({
  buffer,
  filename,
  contentType,
  startDate,
  endDate,
  category,
  invoice,
  pdfDate,
}: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  startDate: string;
  endDate: string;
  category: string;
  invoice: string;
  pdfDate: string;
}) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "ksolve-documents";
  const supabase = getSupabaseClient();

  const safeName = safeFilename(filename);
  const storagePath = `ksolve/${startDate}_to_${endDate}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Supabase upload failed for ${filename}: ${uploadError.message}`
    );
  }

  await insertUploadRecord({
    fileName: safeName,
    storagePath,
    category,
    invoice,
    pdfDate,
    fileType: getFileType(safeName),
  });

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signedUrlError) {
    console.warn(
      `Failed creating signed URL for ${filename}:`,
      signedUrlError.message
    );
  }

  return {
    storagePath,
    signedUrl: signedUrlData?.signedUrl || null,
  };
}

async function syncInvoiceTypeFromUpload(invoice: string, type: string) {
  if (!invoice || invoice === "Unknown" || !type || type === "Unknown") return;

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("invoices")
    .update({ type, doc_status: true })
    .eq("invoice_number", invoice);

  if (error) {
    console.warn(`Failed syncing invoice ${invoice} from upload category: ${error.message}`);
  }
}

async function uploadDocumentToSupabase({
  document,
  row,
  startDate,
  endDate,
  deductionTypes,
}: {
  document: KsolveDocument;
  row: KsolveSearchRow;
  startDate: string;
  endDate: string;
  deductionTypes: DeductionTypeRecord[];
}): Promise<UploadedKsolveDocument> {
  const downloadResponse = await fetchWithRetry(document.DocumentLink, {
    method: "GET",
    headers: getKsolveHeaders(),
  });

  if (!downloadResponse.ok) {
    const errorText = await downloadResponse.text();

    throw new Error(
      `Failed downloading ${document.DocumentDisplayName} (${downloadResponse.status}): ${errorText}`
    );
  }

  const contentType =
    downloadResponse.headers.get("content-type") || "application/octet-stream";

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const documentText = await extractDocumentTextForMapping({
    buffer,
    filename: document.DocumentDisplayName,
    contentType,
  });

  const category = resolveAutomatedDeductionType({
    document,
    row,
    deductionTypes,
    documentText,
  });

  const uploaded = await uploadBufferToSupabase({
    buffer,
    filename: document.DocumentDisplayName,
    contentType,
    startDate,
    endDate,
    category,
    invoice: row.InvoiceNumber || document.DocumentDisplayName,
    pdfDate: formatDisplayDate(row.CheckDate || row.InvoiceDate),
  });

  await syncInvoiceTypeFromUpload(row.InvoiceNumber || "", category);

  if (getFileType(document.DocumentDisplayName) === "excel") {
    const savedRows = await replaceAutomationExcelDatasetRows({
      buffer,
      row,
      invoice: row.InvoiceNumber || document.DocumentDisplayName,
      category,
    });
    console.log(
      `Saved ${savedRows} broker commission dataset row(s) for ${row.InvoiceNumber || document.DocumentDisplayName}.`
    );
  }

  return {
    ...document,
    StoragePath: uploaded.storagePath,
    SignedUrl: uploaded.signedUrl,
  };
}

async function uploadInvoiceSummaryToSupabase({
  rows,
  startDate,
  endDate,
}: {
  rows: KsolveSearchRow[];
  startDate: string;
  endDate: string;
}): Promise<UploadedKsolveDocument> {
  const summaryRows = rows.map((row) => ({
    "Invoice #": row.InvoiceNumber || "",
    Date: formatDisplayDate(row.InvoiceDate),
    Remarks: row.Remarks || "",
    "PO #": row.PoNumber || "",
    "Invoice Amt": row.InvoiceAmount ?? "",
    Status: row.PayStatusCode || "",
    "DC Name": row.DcNameDisplayable || "",
    "Check #": row.CheckNumber ?? "",
    "Check Date": formatDisplayDate(row.CheckDate),
    "Check Amt": row.CheckAmount ?? "",
    "Special Payee": row.SpecialPayee ?? "",
    ESN: row.EsnAsString || row.Esn || "",
    "Vendor Name": row.VendorName || "",
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(summaryRows);

  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Summary");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const filename = `invoice-summary-${startDate}-to-${endDate}.xlsx`;

  const uploaded = await uploadBufferToSupabase({
    buffer,
    filename,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    startDate,
    endDate,
    category: "Invoice Summary",
    invoice: `invoice-summary-${startDate}-to-${endDate}`,
    pdfDate: formatDisplayDate(endDate),
  });

  return {
    DocumentLink: uploaded.signedUrl || "",
    DocumentType: "Invoice Summary",
    DocumentDisplayName: filename,
    FileSizeInBytes: buffer.length,
    CreatedOn: new Date().toISOString(),
    FileSizeDisplayable: formatFileSize(buffer.length),
    StoragePath: uploaded.storagePath,
    SignedUrl: uploaded.signedUrl,
  };
}

export async function runKsolveAutomation({
  startDate,
  endDate,
  includeInvoiceSummary = true,
  includeInvoiceFiles = true,
}: RunKsolveAutomationInput) {
  console.log("Running K-Solve API automation...");
  console.log(`Selected check date range: ${startDate} to ${endDate}`);

  const selectedStart = parseIsoDate(startDate);
  const selectedEnd = parseIsoDate(endDate);

  const searchStart = subtractDays(selectedStart, 90);
  const searchEnd = selectedEnd;

  const searchEndpoint =
    "https://connect.kehe.com/ksolve/services/api/ksolve/search";

  const searchResponse = await fetchWithRetry(searchEndpoint, {
    method: "POST",
    headers: getKsolveHeaders(),
    body: JSON.stringify({
      EsnAsString: "",
      VendorName: "Wonder Monday",
      StartDate: formatKsolveDate(searchStart),
      EndDate: formatKsolveDate(searchEnd),
      CheckNumber: 0,
      Dc: "",
      InvoiceNumber: "",
      PoNumber: "",
      SpecialPayee: 0,
    }),
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();

    throw new Error(
      `K-Solve search failed (${searchResponse.status}): ${errorText}`
    );
  }

  const searchRows = (await searchResponse.json()) as KsolveSearchRow[];

  const matchingRows = searchRows.filter((row) =>
    isCheckDateInRange(row.CheckDate, startDate, endDate)
  );

  if (includeInvoiceSummary) {
    await upsertInvoiceRows(matchingRows);
  }

  const documents: UploadedKsolveDocument[] = [];
  const deductionTypes = includeInvoiceFiles ? await fetchDeductionTypes() : [];

  if (includeInvoiceFiles) {
    console.log(`Loaded ${deductionTypes.length} deduction type mapping(s).`);
  }

  if (includeInvoiceSummary) {
    const invoiceSummary = await uploadInvoiceSummaryToSupabase({
      rows: matchingRows,
      startDate,
      endDate,
    });

    documents.push(invoiceSummary);
  }

  if (includeInvoiceFiles) {
    for (const row of matchingRows) {
      if (!row.HasDocuments) continue;

      const documentsEndpoint = `https://connect.kehe.com/ksolve/services/api/ksolve/list/documents/${row.Id}`;

      const documentsResponse = await fetchWithRetry(documentsEndpoint, {
        method: "GET",
        headers: getKsolveHeaders(),
      });

      if (!documentsResponse.ok) {
        console.warn(
          `K-Solve document lookup failed for row ${row.Id}: ${documentsResponse.status}`
        );
        continue;
      }

      const rowDocuments = (await documentsResponse.json()) as KsolveDocument[];

      const filteredDocuments = rowDocuments.filter(
        (document) => !isSupportingDocument(document)
      );

      for (const document of filteredDocuments) {
        try {
          const uploadedDocument = await uploadDocumentToSupabase({
            document,
            row,
            startDate,
            endDate,
            deductionTypes,
          });

          documents.push(uploadedDocument);
        } catch (error) {
          console.error(
            `Failed uploading ${document.DocumentDisplayName}:`,
            error
          );
        }
      }
    }
  }

  return {
    startDate,
    endDate,
    searchedInvoiceDateFrom: formatKsolveDate(searchStart),
    searchedInvoiceDateTo: formatKsolveDate(searchEnd),
    matchedRowCount: matchingRows.length,
    documentCount: documents.length,
    documents,
    searchRows: matchingRows,
  };
}
