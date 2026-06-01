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

  return parsedDate.toLocaleString("en-US", {
    month: "long",
    year: "2-digit",
  });
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

function normalizeForMatch(raw: string | null | undefined) {
  return normalizeType(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getInvoiceType(row: KsolveSearchRow) {
  if (row.ChargeTypeCode === "PV") return "WM Invoice";
  if (row.DocumentUrl) return "WM Invoice";

  if (row.InvoiceNumber?.toUpperCase().startsWith("CN")) {
    return "Customer Spoils Allowance";
  }

  if (row.InvoiceNumber?.toUpperCase().startsWith("CS")) {
    return "Customer Spoils Allowance";
  }

  if (row.InvoiceNumber?.toUpperCase().startsWith("IAA")) {
    return "Pass Thru Deduction";
  }

  return "Customer Spoils Allowance";
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

function resolveAutomatedDeductionType({
  document,
  row,
  deductionTypes,
}: {
  document: KsolveDocument;
  row: KsolveSearchRow;
  deductionTypes: DeductionTypeRecord[];
}) {
  const candidates = [
    document.DocumentType,
    document.DocumentDisplayName,
    getInvoiceType(row),
    row.ChargeTypeCode || "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

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

  const category = resolveAutomatedDeductionType({
    document,
    row,
    deductionTypes,
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
