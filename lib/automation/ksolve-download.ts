type RunKsolveAutomationInput = {
  startDate: string;
  endDate: string;
};

export async function runKsolveAutomation({
  startDate,
  endDate,
}: RunKsolveAutomationInput) {
  console.log("Running K-Solve API automation...");
  console.log(`Date range: ${startDate} to ${endDate}`);

  const endpoint =
    "https://connect.kehe.com/ksolve/services/api/ksolve/list/documents/27804599";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `bearer ${process.env.KSOLVE_BEARER_TOKEN}`,
      cookie: process.env.KSOLVE_COOKIE || "",
      referer: "https://connect.kehe.com/ksolve/",
      origin: "https://connect.kehe.com",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `K-Solve request failed (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  console.log("K-Solve response received:");
  console.log(JSON.stringify(data, null, 2));

  return data;
}