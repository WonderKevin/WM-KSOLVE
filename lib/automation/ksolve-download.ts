import fs from "fs";
import path from "path";

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

async function downloadFile(
  url: string,
  filename: string
) {
  const downloadsDir =
    "C:\\Users\\admin\\Desktop\\wm-ksolve-app\\downloads";

  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const safeFilename = filename.replace(/[<>:"/\\|?*]/g, "_");

  const filePath = path.join(downloadsDir, safeFilename);

  const response = await fetch(url, {
    method: "GET",
    headers: getKsolveHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed downloading file (${response.status})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  fs.writeFileSync(filePath, buffer);

  console.log(`Downloaded file: ${filePath}`);

  return filePath;
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

  console.log("K-Solve matching rows by CheckDate:");
  console.log(JSON.stringify(matchingRows, null, 2));

  const documents: KsolveDocument[] = [];
  const downloadedFiles: string[] = [];

  for (const row of matchingRows) {
    if (!row.HasDocuments) continue;

    const documentsEndpoint = `https://connect.kehe.com/ksolve/services/api/ksolve/list/documents/${row.Id}`;

    const documentsResponse = await fetch(documentsEndpoint, {
      method: "GET",
      headers: getKsolveHeaders(),
    });

    if (!documentsResponse.ok) {
      const errorText = await documentsResponse.text();

      console.warn(
        `K-Solve document lookup failed for row ${row.Id} (${documentsResponse.status}): ${errorText}`
      );

      continue;
    }

    const rowDocuments =
      (await documentsResponse.json()) as KsolveDocument[];

    const filteredDocuments = rowDocuments.filter(
      (document) =>
        document.DocumentType?.toLowerCase().trim() !==
        "supporting document"
    );

    documents.push(...filteredDocuments);

    for (const document of filteredDocuments) {
      try {
        const downloadedPath = await downloadFile(
          document.DocumentLink,
          document.DocumentDisplayName
        );

        downloadedFiles.push(downloadedPath);
      } catch (error) {
        console.error(
          `Failed downloading ${document.DocumentDisplayName}:`,
          error
        );
      }
    }
  }

  console.log("K-Solve documents found:");
  console.log(JSON.stringify(documents, null, 2));

  console.log("Downloaded files:");
  console.log(JSON.stringify(downloadedFiles, null, 2));

  return {
    startDate,
    endDate,
    searchedInvoiceDateFrom: formatKsolveDate(searchStart),
    searchedInvoiceDateTo: formatKsolveDate(searchEnd),
    matchedRowCount: matchingRows.length,
    documentCount: documents.length,
    searchRows: matchingRows,
    documents,
    downloadedFiles,
  };
}