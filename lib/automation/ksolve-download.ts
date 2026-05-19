import { createClient } from "@supabase/supabase-js";

type KsolveSearchRow = {
  Id: number;
  InvoiceNumber: string;
  CheckNumber: number | null;
  CheckDate: string | null;
  HasDocuments: boolean;
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

type RunKsolveAutomationInput = {
  startDate: string;
  endDate: string;
};

function parseIsoDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function formatKsolveDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
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

function isSupportingDocument(document: KsolveDocument) {
  return document.DocumentType?.toLowerCase().trim() === "supporting document";
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
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "ksolve-documents";
  const supabase = getSupabaseClient();

  const downloadResponse = await fetch(document.DocumentLink, {
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
    downloadResponse.headers.get("content-type") ||
    "application/octet-stream";

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filename = safeFilename(document.DocumentDisplayName);
  const storagePath = `ksolve/${startDate}_to_${endDate}/${Date.now()}-${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Supabase upload failed for ${document.DocumentDisplayName}: ${uploadError.message}`
    );
  }

  const { data: signedUrlData, error: signedUrlError } =
    await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signedUrlError) {
    console.warn(
      `Failed creating signed URL for ${document.DocumentDisplayName}:`,
      signedUrlError.message
    );
  }

  return {
    ...document,
    StoragePath: storagePath,
    SignedUrl: signedUrlData?.signedUrl || null,
  };
}

export async function runKsolveAutomation({
  startDate,
  endDate,
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

  const documents: KsolveDocument[] = [];
  const uploadedDocuments: UploadedKsolveDocument[] = [];

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

    documents.push(...filteredDocuments);

    for (const document of filteredDocuments) {
      const uploadedDocument = await uploadDocumentToSupabase({
        document,
        startDate,
        endDate,
      });

      uploadedDocuments.push(uploadedDocument);
    }
  }

  return {
    startDate,
    endDate,
    searchedInvoiceDateFrom: formatKsolveDate(searchStart),
    searchedInvoiceDateTo: formatKsolveDate(searchEnd),
    matchedRowCount: matchingRows.length,
    documentCount: documents.length,
    uploadedDocumentCount: uploadedDocuments.length,
    searchRows: matchingRows,
    documents: uploadedDocuments,
  };
}