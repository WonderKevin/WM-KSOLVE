"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Search, X, Plus } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProductRow = {
  upc: string;
  item_description: string;
};

type LocationRow = {
  customer?: unknown;
  retailer_name?: unknown;
  location_name?: unknown;
  retailer_area?: unknown;
  area?: unknown;
  region?: unknown;
  retailer?: unknown;
  chain?: unknown;
  banner?: unknown;
  parent?: unknown;
  account_name?: unknown;
};

type WorksheetRow = unknown[];

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
  fill_rate?: number | string | null;
  source_file_name?: string;
  period_type?: "monthly" | "weekly" | string | null;
  period_start_date?: string | null;
  period_end_date?: string | null;
};

type MissingLocationEntry = {
  retailer_area: string;
  customer: string;
  retailer: string;
  isAddingRetailer?: boolean;
  newRetailer?: string;
};

const SHIP_DIVISOR = 36.03;
const DEFAULT_RETAILER_OPTIONS = ["INFRA & Others", "Kroger", "Fresh Thyme", "HEB"];
const ADD_NEW_RETAILER_VALUE = "__ADD_NEW_RETAILER__";

function formatMonthLabel(monthNumber: number, year: number) {
  const date = new Date(year, monthNumber - 1, 1);
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(year).slice(-2)}`;
}

function formatDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function parseDateInputValue(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMostRecentSundayInputValue() {
  const today = new Date();
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  return formatDateInputValue(sunday);
}

function getDefaultWeeklyRangeInputValue() {
  const end = parseDateInputValue(getMostRecentSundayInputValue()) ?? new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);

  return {
    start: formatDateInputValue(start),
    end: formatDateInputValue(end),
  };
}

function formatDisplayDate(value: string | null | undefined) {
  const parsed = parseDateInputValue(String(value || ""));
  if (!parsed) return "";
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(
    2,
    "0"
  )}/${parsed.getFullYear()}`;
}

function buildUploadPeriodMetadata({
  periodType,
  monthInput,
  yearInput,
  weekStartDate,
  weekEndDate,
}: {
  periodType: "monthly" | "weekly";
  monthInput: string;
  yearInput: string;
  weekStartDate: string;
  weekEndDate: string;
}) {
  if (periodType === "weekly") {
    const startDate = parseDateInputValue(weekStartDate);
    const endDate = parseDateInputValue(weekEndDate);
    if (!startDate || !endDate) {
      throw new Error("Please choose a valid weekly date range.");
    }
    if (startDate > endDate) {
      throw new Error("Weekly From date must be on or before the To date.");
    }

    return {
      monthLabel: formatMonthLabel(endDate.getMonth() + 1, endDate.getFullYear()),
      period_type: "weekly" as const,
      period_start_date: formatDateInputValue(startDate),
      period_end_date: formatDateInputValue(endDate),
    };
  }

  const monthNumber = Number(monthInput);
  const yearNumber = Number(yearInput);
  if (!monthNumber || !yearNumber) {
    throw new Error("Please choose a valid month and year.");
  }
  const startDate = new Date(yearNumber, monthNumber - 1, 1);
  const endDate = new Date(yearNumber, monthNumber, 0);

  return {
    monthLabel: formatMonthLabel(monthNumber, yearNumber),
    period_type: "monthly" as const,
    period_start_date: formatDateInputValue(startDate),
    period_end_date: formatDateInputValue(endDate),
  };
}

function formatPeriodLabel(row: VelocityRow) {
  const type = String(row.period_type || "monthly").toLowerCase();
  if (type === "weekly") {
    const start = formatDisplayDate(row.period_start_date);
    const end = formatDisplayDate(row.period_end_date);
    return start && end ? `Weekly ${start} - ${end}` : "Weekly";
  }
  return "Monthly";
}

function isMissingPeriodColumnError(error: unknown) {
  const message = getErrorMessage(error, "").toLowerCase();
  return (
    message.includes("period_type") ||
    message.includes("period_start_date") ||
    message.includes("period_end_date")
  );
}

function stripPeriodColumns(row: VelocityRow) {
  const { period_type, period_start_date, period_end_date, ...rest } = row;
  void period_type;
  void period_start_date;
  void period_end_date;
  return rest;
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

function normalizeMonthLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getMonthSortValue(value: string) {
  const normalized = normalizeMonthLabel(value);
  const match = normalized.match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!match) return -Infinity;

  const monthName = match[1];
  const year2 = Number(match[2]);
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return -Infinity;

  const fullYear = 2000 + year2;
  return fullYear * 100 + (monthIndex + 1);
}

function compareMonthLabelsDesc(a: string, b: string) {
  return getMonthSortValue(b) - getMonthSortValue(a);
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

function parseCurrencyNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const num = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
}

function hasPercentMarker(value: unknown) {
  return String(value ?? "").includes("%");
}

function parsePercentNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) <= 1 ? value * 100 : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const hasPercentSign = raw.includes("%");
  const num = Number(raw.replace(/[%,$,]/g, "").trim());
  if (Number.isNaN(num)) return null;

  return !hasPercentSign && Math.abs(num) <= 1 ? num * 100 : num;
}

function formatFillRate(value: VelocityRow["fill_rate"]) {
  const parsed = parsePercentNumber(value);
  if (parsed === null) return "";
  return `${parsed.toFixed(2)}%`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
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

function getRetailerOptionsFromLocations(locations: LocationRow[]) {
  const values = new Set<string>();

  for (const option of DEFAULT_RETAILER_OPTIONS) {
    if (option.trim()) values.add(option.trim());
  }

  for (const row of locations) {
    const retailer = String(
      row.retailer ||
        row.chain ||
        row.banner ||
        row.parent ||
        row.account_name ||
        ""
    )
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (retailer) values.add(retailer);
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

async function fetchAllVelocityRows(): Promise<VelocityRow[]> {
  const pageSize = 1000;
  let from = 0;
  let allRows: VelocityRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("kehe_velocity")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const batch = (data ?? []) as VelocityRow[];
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

function isLikelyRetailerAreaRow(row: WorksheetRow) {
  const colC = String(row[2] || "").trim();
  const colD = String(row[3] || "").trim();
  const colE = String(row[4] || "").trim();
  const colG = String(row[6] || "").trim();

  return !!colC && !colD && !colE && !colG;
}

function isLikelyRetailerNameRow(row: WorksheetRow) {
  const colE = String(row[4] || "").trim();
  const colG = String(row[6] || "").trim();

  return !!colE && !colG;
}

function isLikelyItemRow(row: WorksheetRow) {
  const colG = String(row[6] || "").trim();
  return /\(\d{10,14}\)/.test(colG);
}

function findHeaderColumnIndex(rows: WorksheetRow[], headerText: string, allowPartial = true) {
  const target = normalizeText(headerText);

  for (const row of rows.slice(0, 75)) {
    for (let index = 0; index < row.length; index++) {
      const normalizedCell = normalizeText(String(row[index] || ""));
      if (normalizedCell === target) {
        return index;
      }
    }
  }

  if (!allowPartial) return -1;

  for (const row of rows.slice(0, 75)) {
    for (let index = 0; index < row.length; index++) {
      const normalizedCell = normalizeText(String(row[index] || ""));
      if (normalizedCell.includes(target)) {
        return index;
      }
    }
  }

  return -1;
}

function findNearestOrderedValue(row: WorksheetRow, shippedColumnIndex: number) {
  for (let index = shippedColumnIndex - 1; index >= Math.max(0, shippedColumnIndex - 8); index--) {
    const value = row[index];
    const text = String(value ?? "").trim();
    if (!text || hasPercentMarker(value)) continue;

    const parsed = parseCurrencyNumber(value);
    if (parsed > 0) return parsed;
  }

  return 0;
}

function getFillRateFromRow(
  row: WorksheetRow,
  fillRateColumnIndex: number,
  orderedColumnIndex: number,
  shippedColumnIndex: number
) {
  if (fillRateColumnIndex >= 0) {
    const explicitFillRate = parsePercentNumber(row[fillRateColumnIndex]);
    if (explicitFillRate !== null) return explicitFillRate;
  }

  const ordered =
    orderedColumnIndex >= 0
      ? parseCurrencyNumber(row[orderedColumnIndex])
      : findNearestOrderedValue(row, shippedColumnIndex);
  const shipped = parseCurrencyNumber(row[shippedColumnIndex]);

  if (ordered <= 0) return null;
  return (shipped / ordered) * 100;
}

function parseKeheWorksheet(
  rows: WorksheetRow[],
  monthLabel: string,
  sourceFileName: string,
  productMap: Map<string, string>,
  locations: LocationRow[]
): VelocityRow[] {
  const output: VelocityRow[] = [];
  const fillRateColumnIndex = findHeaderColumnIndex(rows, "FILL RATE");
  const orderedColumnIndex = findHeaderColumnIndex(rows, "ORDERED", false);
  const shippedColumnIndex = findHeaderColumnIndex(rows, "SHIPPED", false);
  const resolvedShippedColumnIndex = shippedColumnIndex >= 0 ? shippedColumnIndex : 15;

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

    const shipped = parseCurrencyNumber(row[resolvedShippedColumnIndex]);
    const cases = roundCases(shipped);
    const eaches = cases * 12;
    const fillRate = getFillRateFromRow(
      row,
      fillRateColumnIndex,
      orderedColumnIndex,
      resolvedShippedColumnIndex
    );

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
      fill_rate: fillRate,
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
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("monthly");
  const defaultWeeklyRange = useMemo(() => getDefaultWeeklyRangeInputValue(), []);
  const [weekStartDate, setWeekStartDate] = useState(defaultWeeklyRange.start);
  const [weekEndDate, setWeekEndDate] = useState(defaultWeeklyRange.end);
  const [showUploadBox, setShowUploadBox] = useState(false);

  const [search, setSearch] = useState("");
  const [retailerFilter, setRetailerFilter] = useState("All Retailers");
  const [monthFilter, setMonthFilter] = useState("All Months");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [missingLocations, setMissingLocations] = useState<MissingLocationEntry[]>([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingRows, setPendingRows] = useState<VelocityRow[]>([]);
  const [retailerOptionsForModal, setRetailerOptionsForModal] = useState<string[]>(DEFAULT_RETAILER_OPTIONS);

  const loadRows = async () => {
    try {
      setLoading(true);

      const data = await fetchAllVelocityRows();

      const sortedData = [...(data || [])].sort((a, b) => {
        const monthCompare = compareMonthLabelsDesc(a.month, b.month);
        if (monthCompare !== 0) return monthCompare;

        const endCompare = String(b.period_end_date || "").localeCompare(
          String(a.period_end_date || "")
        );
        if (endCompare !== 0) return endCompare;

        const startCompare = String(b.period_start_date || "").localeCompare(
          String(a.period_start_date || "")
        );
        if (startCompare !== 0) return startCompare;

        return String(a.customer || "").localeCompare(String(b.customer || ""));
      });

      setRows(sortedData);
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

  useEffect(() => {
    fetchAllLocations()
      .then((locations) => setRetailerOptionsForModal(getRetailerOptionsFromLocations(locations)))
      .catch((error) => console.error("Failed to load retailer options:", error));
  }, []);

  const retailerOptions = useMemo(() => {
    return [
      "All Retailers",
      ...Array.from(
        new Set(
          rows
            .map((r) => String(r.retailer || "").replace(/\u00a0/g, " ").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [rows]);

  const monthOptions = useMemo(() => {
    return [
      "All Months",
      ...Array.from(
        new Set(
          rows
            .map((r) => normalizeMonthLabel(r.month))
            .filter(Boolean)
        )
      ).sort(compareMonthLabelsDesc),
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedMonthNorm = normalizeMonthLabel(monthFilter);
    const selectedRetailerNorm = String(retailerFilter || "")
      .replace(/\u00a0/g, " ")
      .trim();

    return rows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const rowRetailer = String(row.retailer || "")
        .replace(/\u00a0/g, " ")
        .trim();

      const matchesSearch =
        !q ||
        [
          rowMonth,
          row.retailer_area,
          row.customer,
          row.upc,
          row.description,
          rowRetailer,
          formatFillRate(row.fill_rate),
          formatPeriodLabel(row),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesRetailer =
        selectedRetailerNorm === "All Retailers" || rowRetailer === selectedRetailerNorm;

      const matchesMonth =
        selectedMonthNorm === "All Months" || rowMonth === selectedMonthNorm;

      return matchesSearch && matchesRetailer && matchesMonth;
    });
  }, [rows, search, retailerFilter, monthFilter]);

  const handleExportToExcel = () => {
    if (!filteredRows.length) {
      alert("No rows to export.");
      return;
    }

    const exportRows = filteredRows.map((row) => ({
      Month: normalizeMonthLabel(row.month),
      "Retailer Area": row.retailer_area,
      Customer: row.customer,
      UPC: row.upc,
      Description: row.description,
      Cases: row.cases,
      Eaches: row.eaches,
      Retailer: row.retailer || "",
      "Fill Rate": formatFillRate(row.fill_rate),
      Period: formatPeriodLabel(row),
      "Period Start Date": row.period_start_date || "",
      "Period End Date": row.period_end_date || "",
      "Source File Name": row.source_file_name || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KeHe Velocity");

    const fileNameParts = ["kehe_velocity"];

    if (retailerFilter !== "All Retailers") {
      fileNameParts.push(retailerFilter.replace(/\s+/g, "_"));
    }

    if (monthFilter !== "All Months") {
      fileNameParts.push(normalizeMonthLabel(monthFilter).replace(/\s+/g, "_").replace(/'/g, ""));
    }

    XLSX.writeFile(workbook, `${fileNameParts.join("_")}.xlsx`);
  };

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

    if (insertError) {
      if (isMissingPeriodColumnError(insertError)) {
        const includesWeeklyRows = finalRows.some(
          (row) => String(row.period_type || "").toLowerCase() === "weekly"
        );
        if (includesWeeklyRows) {
          throw new Error(
            "Weekly KeHE uploads need the new period columns in Supabase. Run supabase/kehe_velocity_periods.sql, then upload again."
          );
        }

        const retryRows = finalRows.map(stripPeriodColumns);
        const { error: retryError } = await supabase.from("kehe_velocity").insert(retryRows);
        if (retryError) throw retryError;
      } else {
        throw insertError;
      }
    }

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

      setRetailerOptionsForModal(getRetailerOptionsFromLocations(locations));

      const productMap = new Map<string, string>();
      ((productRes.data || []) as ProductRow[]).forEach((row) => {
        productMap.set(String(row.upc), row.item_description || "");
      });

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawRows = XLSX.utils.sheet_to_json<WorksheetRow>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const uploadPeriod = buildUploadPeriodMetadata({
        periodType,
        monthInput,
        yearInput,
        weekStartDate,
        weekEndDate,
      });
      const parsedRows = parseKeheWorksheet(
        rawRows,
        uploadPeriod.monthLabel,
        file.name,
        productMap,
        locations
      ).map((row) => ({
        ...row,
        period_type: uploadPeriod.period_type,
        period_start_date: uploadPeriod.period_start_date,
        period_end_date: uploadPeriod.period_end_date,
      }));

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
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Upload failed."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleSaveMissingLocations = async () => {
    try {
      const normalizedMissingLocations = missingLocations.map((item) => ({
        ...item,
        retailer: item.isAddingRetailer
          ? String(item.newRetailer || "").replace(/ /g, " ").replace(/\s+/g, " ").trim()
          : String(item.retailer || "").replace(/ /g, " ").replace(/\s+/g, " ").trim(),
      }));

      for (const item of normalizedMissingLocations) {
        if (!item.retailer) {
          alert("Please choose or enter a retailer for every new location.");
          return;
        }
      }

      const rowsToInsert = normalizedMissingLocations.map((item) => ({
        retailer_area: item.retailer_area,
        customer: item.customer,
        retailer: item.retailer,
      }));

      const { error } = await supabase.from("locations").insert(rowsToInsert);
      if (error) throw error;

      const refreshedLocations = await fetchAllLocations();
      setRetailerOptionsForModal(getRetailerOptionsFromLocations(refreshedLocations));
      await finishInsert(pendingRows, refreshedLocations);

      setShowLocationModal(false);
      setMissingLocations([]);
      setPendingRows([]);
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Failed to save locations."));
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
                variant="outline"
                className="rounded-2xl"
                onClick={handleExportToExcel}
                disabled={!filteredRows.length}
              >
                Export to Excel
              </Button>

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
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Upload Period
                  </label>
                  <select
                    value={periodType}
                    onChange={(e) => setPeriodType(e.target.value as "monthly" | "weekly")}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>

                {periodType === "monthly" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        From
                      </label>
                      <Input
                        type="date"
                        value={weekStartDate}
                        onChange={(e) => setWeekStartDate(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        To
                      </label>
                      <Input
                        type="date"
                        value={weekEndDate}
                        onChange={(e) => setWeekEndDate(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                  </>
                )}

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
                Weekly uploads use the selected From and To dates for the period label and month assignment.
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
              Choose an existing retailer or add a new one, then save them before continuing.
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
                    <div className="space-y-2">
                      <select
                        value={item.isAddingRetailer ? ADD_NEW_RETAILER_VALUE : item.retailer}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMissingLocations((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? value === ADD_NEW_RETAILER_VALUE
                                  ? { ...row, retailer: "", isAddingRetailer: true, newRetailer: row.newRetailer || "" }
                                  : { ...row, retailer: value, isAddingRetailer: false, newRetailer: "" }
                                : row
                            )
                          );
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">Select retailer</option>
                        {retailerOptionsForModal.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_NEW_RETAILER_VALUE}>+ Add new retailer</option>
                      </select>

                      {item.isAddingRetailer && (
                        <div className="relative">
                          <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            value={item.newRetailer || ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setMissingLocations((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, newRetailer: value } : row
                                )
                              );
                            }}
                            placeholder="Enter new retailer"
                            className="rounded-xl pl-10"
                          />
                        </div>
                      )}
                    </div>
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Fill Rate</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Period</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr key={row.id || `${row.upc}-${index}`} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{normalizeMonthLabel(row.month)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer_area}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.upc}</td>
                      <td className="px-4 py-3 text-slate-700">{row.description}</td>
                      <td className="px-4 py-3 text-slate-700">{row.cases}</td>
                      <td className="px-4 py-3 text-slate-700">{row.eaches}</td>
                      <td className="px-4 py-3 text-slate-700">{row.retailer}</td>
                      <td className="px-4 py-3 text-slate-700">{formatFillRate(row.fill_rate)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatPeriodLabel(row)}</td>
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
