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
  HasDispute?: boolean;
  Dispute?: unknown;
  HasNotes?: boolean;
  Notes?: unknown[];
  HasDocuments: boolean;
  Documents?: unknown[];
  CurrencyCode?: string | null;
  [key: string]: unknown;
};

type KsolveDocument = {
  DocumentLink: string;
  DocumentType: string;
  DocumentDisplayName: string;
  FileSizeInBytes: number;
  CreatedOn: string;
  FileSizeDisplayable: string;
};

type UploadedKsolveDocument = KsolveDocument & {
  StoragePath: string;
  SignedUrl: string | null;
};

type InvoiceSummaryUpload = {
  DocumentLink: string;
  DocumentType: "Invoice Summary";
  DocumentDisplayName: string;
  FileSizeInBytes: number;
  CreatedOn: string;
  FileSizeDisplayable: string;
  StoragePath: string;
  SignedUrl: string | null;
};

type RunKsolveAutomationInput = {
  startDate: string;
  endDate: string;
  includeInvoiceSummary?: boolean;
  includeInvoiceFiles?: boolean;
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

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return `${parsedDate.getMonth() + 1}/${parsedDate.getDate()}/${String(
    parsedDate.getFullYear()
  ).slice(-2)}`;
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function isSupportingDocument(document: KsolveDocument) {
  return document.DocumentType?.toLowerCase().trim() === "supporting document";
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
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

      return response;
    } catch (error) {
      clearTimeout(timeout);

      lastError = error;

      console.warn(`Fetch attempt ${attempt} failed for ${url}`);
      console.warn(error);

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      }
    }
  }

  throw lastError;
}

async function uploadBufferToSupabase({
  buffer,
  filename,
  contentType,
  startDate,
  endDate,
}: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  startDate: string;
  endDate: string;
}) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "ksolve-documents";
  const supabase = getSupabaseClient();

  const storagePath = `ksolve/${startDate}_to_${endDate}/${Date.now()}-${safeFilename(
    filename
  )}`;

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
  startDate,
  endDate,
}: {
  document: KsolveDocument;
  startDate: string;
  endDate: string;
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

  const uploaded = await uploadBufferToSupabase({
    buffer,
    filename: document.DocumentDisplayName,
    contentType,
    startDate,
    endDate,
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
}): Promise<InvoiceSummaryUpload> {
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

  const searchResponse = await fetch(searchEndpoint, {
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

  const documents: Array<InvoiceSummaryUpload | UploadedKsolveDocument> = [];

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

      const documentsResponse = await fetch(documentsEndpoint, {
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
            startDate,
            endDate,
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