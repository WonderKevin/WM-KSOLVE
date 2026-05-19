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

function formatKsolveDate(date: string) {
  const [year, month, day] = date.split("-");

  if (!year || !month || !day) {
    return date;
  }

  return `${Number(month)}/${Number(day)}/${year}`;
}

function dateOnly(date: string) {
  return new Date(`${date}T00:00:00`);
}

function isCheckDateInRange(checkDate: string | null, startDate: string, endDate: string) {
  if (!checkDate) return false;

  const check = new Date(checkDate);
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);

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

export async function runKsolveAutomation({
  startDate,
  endDate,
}: RunKsolveAutomationInput) {
  console.log("Running K-Solve API automation...");
  console.log(`Selected check date range: ${startDate} to ${endDate}`);

  const searchEndpoint =
    "https://connect.kehe.com/ksolve/services/api/ksolve/search";

  const searchResponse = await fetch(searchEndpoint, {
    method: "POST",
    headers: getKsolveHeaders(),
    body: JSON.stringify({
      EsnAsString: "",
      VendorName: "Wonder Monday",

      // K-Solve only searches by invoice/date column here.
      // We search broadly, then filter by CheckDate below.
      StartDate: formatKsolveDate(startDate),
      EndDate: formatKsolveDate(endDate),

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

    const rowDocuments = (await documentsResponse.json()) as KsolveDocument[];

    documents.push(...rowDocuments);
  }

  console.log("K-Solve documents found:");
  console.log(JSON.stringify(documents, null, 2));

  return {
    startDate,
    endDate,
    matchedRowCount: matchingRows.length,
    documentCount: documents.length,
    searchRows: matchingRows,
    documents,
  };
}