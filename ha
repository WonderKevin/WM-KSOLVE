[1mdiff --git a/components/Views/BrokerCommissionDataSetsView.tsx b/components/Views/BrokerCommissionDataSetsView.tsx[m
[1mindex d287b33..a7460ab 100644[m
[1m--- a/components/Views/BrokerCommissionDataSetsView.tsx[m
[1m+++ b/components/Views/BrokerCommissionDataSetsView.tsx[m
[36m@@ -139,16 +139,16 @@[m [mfunction isWmInvoiceType(value: string) {[m
 }[m
 [m
 function getFirstTwoWords(value: string) {[m
[31m-  return normalizeText(value)[m
[32m+[m[32m  return value[m
     .split(" ")[m
     .filter(Boolean)[m
     .slice(0, 2)[m
     .join(" ");[m
 }[m
 [m
[32m+[m[32m// Must be called on the RAW string BEFORE normalizeText,[m
[32m+[m[32m// because normalizeText turns " - " into a space and destroys the suffix marker.[m
 function stripLocationSuffix(rawCustomer: string): string {[m
[31m-  // Location names follow pattern "STORE NAME - CITY, STATE"[m
[31m-  // Strip from " - " onward to get just the store identifier[m
   const dashIndex = rawCustomer.indexOf(" - ");[m
   return dashIndex !== -1 ? rawCustomer.slice(0, dashIndex) : rawCustomer;[m
 }[m
[36m@@ -164,28 +164,26 @@[m [mfunction categorizeRetailerName(rawRetailer: string) {[m
   return "INFRA & Others";[m
 }[m
 [m
[31m-function directRetailerFromCustomer(custName: string, locations: LocationRow[]) {[m
[31m-  const normalized = normalizeText(custName);[m
[31m-  if (!normalized) return "";[m
[31m-[m
[31m-  const firstTwo = getFirstTwoWords(normalized);[m
[31m-  if (!firstTwo) return "";[m
[31m-[m
[31m-  const match = locations.find((loc) => {[m
[31m-    const locFirstTwo = getFirstTwoWords(normalizeText(stripLocationSuffix(loc.customer)));[m
[31m-    return firstTwo === locFirstTwo;[m
[31m-  });[m
[31m-[m
[31m-  if (!match) return "";[m
[31m-[m
[31m-  return categorizeRetailerName(match.retailer);[m
[32m+[m[32m// Build a lookup map keyed by normalized first-two-words of each location.[m
[32m+[m[32m// stripLocationSuffix is called on the RAW string before normalizeText[m
[32m+[m[32m// so that " - " is still detectable as a suffix separator.[m
[32m+[m[32mfunction buildLocationFirstTwoMap(locations: LocationRow[]): Map<string, LocationRow> {[m
[32m+[m[32m  const map = new Map<string, LocationRow>();[m
[32m+[m[32m  for (const loc of locations) {[m
[32m+[m[32m    const stripped = stripLocationSuffix(loc.customer); // strip BEFORE normalizing[m
[32m+[m[32m    const firstTwo = getFirstTwoWords(normalizeText(stripped));[m
[32m+[m[32m    if (firstTwo && !map.has(firstTwo)) {[m
[32m+[m[32m      map.set(firstTwo, loc);[m
[32m+[m[32m    }[m
[32m+[m[32m  }[m
[32m+[m[32m  return map;[m
 }[m
 [m
 function findRetailer([m
   custName: string,[m
   itemName: string,[m
   upc: string,[m
[31m-  locations: LocationRow[][m
[32m+[m[32m  locationFirstTwoMap: Map<string, LocationRow>[m
 ) {[m
   const trimmedCustomer = custName.trim();[m
   const normalizedItem = normalizeText(itemName);[m
[36m@@ -204,7 +202,16 @@[m [mfunction findRetailer([m
 [m
   if (/^DC\s*\d+$/i.test(trimmedCustomer)) return "";[m
 [m
[31m-  return directRetailerFromCustomer(custName, locations);[m
[32m+[m[32m  const normalizedCustomer = normalizeText(trimmedCustomer);[m
[32m+[m[32m  if (!normalizedCustomer) return "";[m
[32m+[m
[32m+[m[32m  const firstTwo = getFirstTwoWords(normalizedCustomer);[m
[32m+[m[32m  if (!firstTwo) return "";[m
[32m+[m
[32m+[m[32m  const match = locationFirstTwoMap.get(firstTwo);[m
[32m+[m[32m  if (!match) return "";[m
[32m+[m
[32m+[m[32m  return categorizeRetailerName(match.retailer);[m
 }[m
 [m
 function applyAmountBasedDiscrepancy([m
[36m@@ -380,6 +387,9 @@[m [mexport default function BrokerCommissionDataSetsView() {[m
       retailer: row.retailer ?? "",[m
     }));[m
 [m
[32m+[m[32m    // Build the map once, reuse for every dataset row[m
[32m+[m[32m    const locationFirstTwoMap = buildLocationFirstTwoMap(locations);[m
[32m+[m
     const overrideMap = new Map([m
       ((overrideData ?? []) as RetailerOverrideRow[]).map((row) => [[m
         row.dataset_id,[m
[36m@@ -422,7 +432,7 @@[m [mexport default function BrokerCommissionDataSetsView() {[m
         row.cust_name ?? "",[m
         row.item ?? "",[m
         row.upc ?? "",[m
[31m-        locations[m
[32m+[m[32m        locationFirstTwoMap[m
       );[m
       const overrideRetailer = overrideMap.get(row.id) ?? "";[m
       const derivedMonth =[m
