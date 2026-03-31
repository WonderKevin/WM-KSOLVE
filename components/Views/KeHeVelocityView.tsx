"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Search, X } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProductRow = {
  upc: string;
  item_description: string;
};

type LocationRow = Record<string, any>;

type VelocityRow = {
  id?: string;
  month: string;
  retailer_area: string;
  customer: string;
  upc: string;
  description: string;
  cases: number;
  eaches: number;
  retailer: string;
  source_file_name?: string;
};

type MissingLocationEntry = {
  retailer_area: string;
  customer: string;
  retailer: string;
};

const SHIP_DIVISOR = 36.03;
const RETAILER_OPTIONS = ["INFRA", "KROGER", "FRESH"];

function formatMonthLabel(monthNumber: number, year: number) {
  const date = new Date(year, monthNumber - 1, 1);
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(year).slice(-2)}`;
}

function normalizeText(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[#]/g, "")
    .replace(/[-_/(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function textLooksLikeMatch(a: string, b: string) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  const ca = compactText(a);
  const cb = compactText(b);

  if (!na || !nb) return false;

  return (
    na === nb ||
    ca === cb ||
    na.includes(nb) ||
    nb.includes(na) ||
    ca.includes(cb) ||
    cb.includes(ca)
  );
}

function extractUpcFromDescription(value: string) {
  const match = String(value || "").match(/\((\d{10,14})\)/);
  return match?.[1] || "";
}

function parseCurrencyNumber(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const num = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
}

function roundCases(shipped: number) {
  return Math.round(shipped / SHIP_DIVISOR);
}

async function fetchAllLocations(): Promise<LocationRow[]> {
  const pageSize = 1000;
  let from = 0;
  let allRows: LocationRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const batch = data ?? [];
    allRows = [...allRows, ...batch];

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function findRetailerFromLocations(
  customer: string,
  retailerArea: string,
  locations: LocationRow[]
) {
  for (const row of locations) {
    const rowCustomer =
      row.customer || row.retailer_name || row.location_name || "";
    const rowArea =
      row.retailer_area || row.area || row.region || "";

    const customerMatch = textLooksLikeMatch(customer, String(rowCustomer));
    const areaMatch = textLooksLikeMatch(retailerArea, String(rowArea));

    if (customerMatch && areaMatch) {
      return String(
        row.retailer ||
          row.chain ||
          row.banner ||
          row.parent ||
          row.account_name ||
          ""
      );
    }
  }

  for (const row of locations) {
    const rowCustomer =
      row.customer || row.retailer_name || row.location_name || "";
    const rowArea =
      row.retailer_area || row.area || row.region || "";

    if (
      textLooksLikeMatch(customer, String(rowCustomer)) ||
      textLooksLikeMatch(retailerArea, String(rowArea))
    ) {
      return String(
        row.retailer ||
          row.chain ||
          row.banner ||
          row.parent ||
          row.account_name ||
          ""
      );
    }
  }

  return "";
}

function hasLocationMatch(
  customer: string,
  retailerArea: string,
  locations: LocationRow[]
) {
  return locations.some((row) => {
    const rowCustomer =
      row.customer || row.retailer_name || row.location_name || "";
    const rowArea =
      row.retailer_area || row.area || row.region || "";

    return (
      textLooksLikeMatch(customer, String(rowCustomer)) &&
      textLooksLikeMatch(retailerArea, String(rowArea))
    );
  });
}

function isLikelyRetailerAreaRow(row: any[]) {
  const colC = String(row[2] || "").trim();
  const colD = String(row[3] || "").trim();
  const colE = String(row[4] || "").trim();
  const colG = String(row[6] || "").trim();

  return !!colC && !colD && !colE && !colG;
}

function isLikelyRetailerNameRow(row: any[]) {
  const colE = String(row[4] || "").trim();
  const colG = String(row[6] || "").trim();

  return !!colE && !colG;
}

function isLikelyItemRow(row: any[]) {
  const colG = String(row[6] || "").trim();
  return /\(\d{10,14}\)/.test(colG);
}

function parseKeheWorksheet(
  rows: any[][],
  monthLabel: string,
  sourceFileName: string,
  productMap: Map<string, string>,
  locations: LocationRow[]
): VelocityRow[] {
  const output: VelocityRow[] = [];

  let currentRetailerArea = "";
  let currentCustomer = "";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];

    if (isLikelyRetailerAreaRow(row)) {
      currentRetailerArea = String(row[2] || "").trim();
      continue;
    }

    if (isLikelyRetailerNameRow(row)) {
      currentCustomer = String(row[4] || "").trim();
      continue;
    }

    if (!isLikelyItemRow(row)) continue;

    const rawItemDescription = String(row[6] || "").trim();
    const upc = extractUpcFromDescription(rawItemDescription);
    if (!upc) continue;

    const shipped = parseCurrencyNumber(row[15]);
    const cases = roundCases(shipped);
    const eaches = cases * 12;

    const description = productMap.get(upc) || rawItemDescription;
    const retailer =
      findRetailerFromLocations(currentCustomer, currentRetailerArea, locations) ||
      "";

    output.push({
      month: monthLabel,
      retailer_area: currentRetailerArea,
      customer: currentCustomer,
      upc,
      description,
      cases,
      eaches,
      retailer,
      source_file_name: sourceFileName,
    });
  }

  return output;
}

function getMissingLocations(
  parsedRows: VelocityRow[],
  locations: LocationRow[]
): MissingLocationEntry[] {
  const uniqueMap = new Map<string, MissingLocationEntry>();

  for (const row of parsedRows) {
    if (!row.customer || !row.retailer_area) continue;

    const exists = hasLocationMatch(row.customer, row.retailer_area, locations);
    if (exists) continue;

    const key = `${compactText(row.retailer_area)}__${compactText(row.customer)}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        retailer_area: row.retailer_area,
        customer: row.customer,
        retailer: "",
      });
    }
  }

  return Array.from(uniqueMap.values());
}

export default function KeHeVelocityView() {
  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [monthInput, setMonthInput] = useState("2");
  const [yearInput, setYearInput] = useState("2026");
  const [showUploadBox, setShowUploadBox] = useState(false);

  const [search, setSearch] = useState("");
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");
  const [monthFilter, setMonthFilter] = useState("All Months");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [missingLocations, setMissingLocations] = useState<MissingLocationEntry[]>([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingRows, setPendingRows] = useState<VelocityRow[]>([]);

  const loadRows = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("kehe_velocity")
        .select("*")
        .order("month", { ascending: false });

      if (error) throw error;

      setRows(data || []);
    } catch (error) {
      console.error("Failed to load kehe_velocity:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const retailerOptions = useMemo(() => {
    return [
      "All Retailers",
      ...Array.from(new Set(rows.map((r) => r.retailer).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    ];
  }, [rows]);

  const monthOptions = useMemo(() => {
    return [
      "All Months",
      ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !q ||
        [
          row.month,
          row.retailer_area,
          row.customer,
          row.upc,
          row.description,
          row.retailer,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesRetailer =
        retailerFilter === "All Retailers" || row.retailer === retailerFilter;

      const matchesMonth =
        monthFilter === "All Months" || row.month === monthFilter;

      return matchesSearch && matchesRetailer && matchesMonth;
    });
  }, [rows, search, retailerFilter, monthFilter]);

  const finishInsert = async (parsedRows: VelocityRow[], locations: LocationRow[]) => {
    const finalRows = parsedRows.map((row) => ({
      ...row,
      retailer:
        row.retailer ||
        findRetailerFromLocations(row.customer, row.retailer_area, locations) ||
        row.retailer_area ||
        row.customer,
    }));

    const { error: insertError } = await supabase
      .from("kehe_velocity")
      .insert(finalRows);

    if (insertError) throw insertError;

    setShowUploadBox(false);
    await loadRows();
    alert(`${finalRows.length} KeHe Velocity rows uploaded successfully.`);
  };

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);

      const [productRes, locations] = await Promise.all([
        supabase.from("product_list").select("upc, item_description"),
        fetchAllLocations(),
      ]);

      if (productRes.error) throw productRes.error;

      const productMap = new Map<string, string>();
      ((productRes.data || []) as ProductRow[]).forEach((row) => {
        productMap.set(String(row.upc), row.item_description || "");
      });

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const monthLabel = formatMonthLabel(Number(monthInput), Number(yearInput));
      const parsedRows = parseKeheWorksheet(
        rawRows,
        monthLabel,
        file.name,
        productMap,
        locations
      );

      if (!parsedRows.length) {
        alert("No KeHe Velocity rows were parsed from the file.");
        return;
      }

      const missing = getMissingLocations(parsedRows, locations);

      if (missing.length > 0) {
        setPendingRows(parsedRows);
        setMissingLocations(missing);
        setShowLocationModal(true);
        return;
      }

      await finishInsert(parsedRows, locations);
    } catch (error: any) {
      alert(error.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleSaveMissingLocations = async () => {
    try {
      for (const item of missingLocations) {
        if (!item.retailer) {
          alert("Please choose a retailer for every new location.");
          return;
        }
      }

      const rowsToInsert = missingLocations.map((item) => ({
        retailer_area: item.retailer_area,
        customer: item.customer,
        retailer: item.retailer,
      }));

      const { error } = await supabase.from("locations").insert(rowsToInsert);
      if (error) throw error;

      const refreshedLocations = await fetchAllLocations();
      await finishInsert(pendingRows, refreshedLocations);

      setShowLocationModal(false);
      setMissingLocations([]);
      setPendingRows([]);
    } catch (error: any) {
      alert(error.message || "Failed to save locations.");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleUpload(file);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">KeHe Velocity</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload KeHE velocity files and transform them into flat rows.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search month, customer, UPC"
                  className="rounded-2xl pl-10 pr-10"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <select
                value={retailerFilter}
                onChange={(e) => setRetailerFilter(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {retailerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={() => setShowUploadBox((prev) => !prev)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload File
              </Button>
            </div>
          </div>

          {showUploadBox && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Month
                  </label>
                  <select
                    value={monthInput}
                    onChange={(e) => setMonthInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={String(m)}>
                        {new Date(2026, m - 1, 1).toLocaleString("en-US", {
                          month: "long",
                        })}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Year
                  </label>
                  <Input
                    value={yearInput}
                    onChange={(e) => setYearInput(e.target.value)}
                    placeholder="2026"
                    className="rounded-xl"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    KeHE Velocity File
                  </label>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Cases = Shipped ÷ 36.03, rounded. Eaches = Cases × 12.
              </p>
            </div>
          )}
        </div>
      </div>

      {showLocationModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">
              New Location Found
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              These Retailer Area / Customer combinations are not in the Locations database yet.
              Choose a retailer, then save them before continuing.
            </p>

            <div className="mt-5 max-h-[420px] space-y-3 overflow-auto">
              {missingLocations.map((item, index) => (
                <div
                  key={`${item.retailer_area}-${item.customer}-${index}`}
                  className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-3"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Retailer Area
                    </label>
                    <Input value={item.retailer_area} readOnly className="rounded-xl" />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Customer
                    </label>
                    <Input value={item.customer} readOnly className="rounded-xl" />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Retailer
                    </label>
                    <select
                      value={item.retailer}
                      onChange={(e) => {
                        const value = e.target.value;
                        setMissingLocations((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, retailer: value } : row
                          )
                        );
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select retailer</option>
                      {RETAILER_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => {
                  setShowLocationModal(false);
                  setMissingLocations([]);
                  setPendingRows([]);
                }}
              >
                Cancel
              </Button>

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={handleSaveMissingLocations}
              >
                Save to Locations
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading KeHe Velocity...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No KeHe Velocity rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Retailer Area</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">UPC</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Description</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Cases</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Eaches</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Retailer</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr key={row.id || `${row.upc}-${index}`} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{row.month}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.upc}</td>
                      <td className="px-4 py-3 text-slate-700">{row.description}</td>
                      <td className="px-4 py-3 text-slate-700">{row.cases}</td>
                      <td className="px-4 py-3 text-slate-700">{row.eaches}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}