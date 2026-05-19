type KsolveSearchRow = {
  Id?: number;
  KsolveId?: number;
  DocumentId?: number;
  CheckId?: number;
  DeductionId?: number;
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

function getSearchRowId(row: KsolveSearchRow) {
  return (
    row.Id ??
    row.KsolveId ??
    row.DocumentId ??
    row.CheckId ??
    row.DeductionId ??
    null
  );
}

export async function runKsolveAutomation({
  startDate,
  endDate,
}: RunKsolveAutomationInput) {
  console.log("Running K-Solve API automation...");
  console.log(`Date range: ${startDate} to ${endDate}`);

  const searchEndpoint =
    "https://connect.kehe.com/ksolve/services/api/ksolve/search";

  const searchResponse = await fetch(searchEndpoint, {
    method: "POST",
    headers: getKsolveHeaders(),
    body: JSON.stringify({
      EsnAsString: "",
      VendorName: "Wonder Monday",
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

  console.log("K-Solve search rows received:");
  console.log(JSON.stringify(searchRows, null, 2));

  const rowIds = Array.from(
    new Set(
      searchRows
        .map((row) => getSearchRowId(row))
        .filter((id): id is number => typeof id === "number")
    )
  );

  console.log("K-Solve row IDs:");
  console.log(JSON.stringify(rowIds, null, 2));

  const documents: KsolveDocument[] = [];

  for (const rowId of rowIds) {
    const documentsEndpoint = `https://connect.kehe.com/ksolve/services/api/ksolve/list/documents/${rowId}`;

    const documentsResponse = await fetch(documentsEndpoint, {
      method: "GET",
      headers: getKsolveHeaders(),
    });

    if (!documentsResponse.ok) {
      const errorText = await documentsResponse.text();

      console.warn(
        `K-Solve document lookup failed for ${rowId} (${documentsResponse.status}): ${errorText}`
      );

      continue;
    }

    const rowDocuments = (await documentsResponse.json()) as KsolveDocument[];

    console.log(`K-Solve documents for row ${rowId}:`);
    console.log(JSON.stringify(rowDocuments, null, 2));

    documents.push(...rowDocuments);
  }

  return {
    startDate,
    endDate,
    searchRows,
    documents,
  };
}