"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type WorksheetRow = unknown[];

type WegmansInvoiceRow = {
  id?: number;
  vendor: string;
  month: string;
  run_date: string | null;
  invoice: string;
  description: string;
  inv_number: string;
  chargeback: number | null;
  type: string;
  source_file_name: string;
  line_number: number;
  created_at?: string;
};

const VENDOR = "Wegman";
const CHARGEBACK_TYPE = "Wegman's Chargeback";
const PAGE_SIZE = 1000;

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeMonthLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2019\u2018`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getHeaderIndex(headers: WorksheetRow, names: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const name of names) {
    const index = normalizedHeaders.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }

  return -1;
}

function getValue(row: WorksheetRow, index: number) {
  if (index < 0) return "";
  return row[index];
}

function parseNumber(value: unknown) {
  const original = clean(value);
  const text = original.replace(/[$,%]/g, "").replace(/,/g, "").replace(/[()]/g, "").trim();

  if (!text) return null;

  const number = Number(text);
  if (Number.isNaN(number)) return null;

  return original.includes("(") && original.includes(")") ? -number : number;
}

function parseDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = clean(value);
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const rawYear = Number(slashMatch[3]);
    const year = slashMatch[3].length === 2 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;

    return `${year}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function monthFromDate(value: string | null) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function monthSortValue(month: string | null | undefined) {
  if (!month) return 0;

  const date = new Date(`1 ${normalizeMonthLabel(month)}`);
  if (Number.isNaN(date.getTime())) return 0;

  return date.getFullYear() * 100 + date.getMonth() + 1;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;

  return value;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
}

function parseWegmansWorksheet(rawRows: WorksheetRow[], fileName: string) {
  const headerRowIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "rundate")
  );

  if (headerRowIndex === -1) {
    throw new Error(`Could not find the Wegmans chargeback header row in ${fileName}.`);
  }

  const headers = rawRows[headerRowIndex];
  const runDateIndex = getHeaderIndex(headers, ["Run Date"]);
  const invoiceIndex = getHeaderIndex(headers, ["Invoice"]);
  const descriptionIndex = getHeaderIndex(headers, ["Description"]);
  const invNumberIndex = getHeaderIndex(headers, ["Inv#", "Inv Number", "Invoice Number"]);
  const chargebackIndex = getHeaderIndex(headers, ["Chargeback", "ChgBckAmt", "Chg Bck Amt"]);

  const requiredIndexes = [
    ["Run Date", runDateIndex],
    ["Invoice", invoiceIndex],
    ["Description", descriptionIndex],
    ["Inv#", invNumberIndex],
    ["Chargeback", chargebackIndex],
  ] as const;

  const missingHeader = requiredIndexes.find(([, index]) => index === -1);
  if (missingHeader) {
    throw new Error(`Missing "${missingHeader[0]}" column in ${fileName}.`);
  }

  const parsedRows: WegmansInvoiceRow[] = [];

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => clean(cell))) return;

    const runDate = parseDate(getValue(row, runDateIndex));
    const month = monthFromDate(runDate);
    const invoice = clean(getValue(row, invoiceIndex));
    const description = clean(getValue(row, descriptionIndex));
    const invNumber = clean(getValue(row, invNumberIndex)).replace(/\.0$/, "");
    const chargeback = parseNumber(getValue(row, chargebackIndex));

    if (!runDate && !invoice && !description && !invNumber && chargeback == null) return;

    parsedRows.push({
      vendor: VENDOR,
      month,
      run_date: runDate,
      invoice,
      description,
      inv_number: invNumber,
      chargeback,
      type: CHARGEBACK_TYPE,
      source_file_name: fileName,
      line_number: index + 1,
    });
  });

  return parsedRows;
}

async function fetchAllWegmansRows() {
  let from = 0;
  let allRows: WegmansInvoiceRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("wegmans_invoices")
      .select("*")
      .order("run_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as WegmansInvoiceRow[];
    allRows = [...allRows, ...batch];

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export default function WegmansView() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<WegmansInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("All Months");

  const loadRows = async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await fetchAllWegmansRows();
      setRows(data);
    } catch (error: unknown) {
      console.error("Failed to load wegmans_invoices:", error);
      const message = getErrorMessage(error, "Failed to load Wegmans invoices.");
      setLoadError(
        message.includes("Could not find the table")
          ? "Supabase table public.wegmans_invoices is not available yet."
          : message
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const dateCompare = clean(b.run_date).localeCompare(clean(a.run_date));
      if (dateCompare !== 0) return dateCompare;

      const invoiceCompare = clean(b.invoice).localeCompare(clean(a.invoice));
      if (invoiceCompare !== 0) return invoiceCompare;

      return Number(a.line_number || 0) - Number(b.line_number || 0);
    });
  }, [rows]);

  const monthOptions = useMemo(
    () => [
      "All Months",
      ...Array.from(new Set(rows.map((row) => normalizeMonthLabel(row.month)).filter(Boolean))).sort(
        (a, b) => monthSortValue(b) - monthSortValue(a)
      ),
    ],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedMonth = normalizeMonthLabel(monthFilter);

    return sortedRows.filter((row) => {
      const rowMonth = normalizeMonthLabel(row.month);
      const matchesMonth = selectedMonth === "All Months" || rowMonth === selectedMonth;
      const matchesSearch =
        !q ||
        [
          row.vendor,
          rowMonth,
          row.run_date,
          row.invoice,
          row.description,
          row.inv_number,
          row.chargeback,
          row.type,
          row.source_file_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      return matchesMonth && matchesSearch;
    });
  }, [sortedRows, search, monthFilter]);

  const totalChargeback = useMemo(
    () => filteredRows.reduce((sum, row) => sum + Number(row.chargeback || 0), 0),
    [filteredRows]
  );

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: "array",
        cellDates: false,
        raw: false,
      });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<WorksheetRow>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const parsedRows = parseWegmansWorksheet(rawRows, file.name);

      if (!parsedRows.length) {
        alert("No Wegmans chargeback rows were parsed from the file.");
        return;
      }

      const existingForFile = rows.some((row) => clean(row.source_file_name) === file.name);

      if (existingForFile) {
        const shouldReplace = window.confirm(
          `Wegmans chargeback data already exists from ${file.name}.\n\nDo you want to replace it?`
        );

        if (!shouldReplace) return;

        const { error: deleteError } = await supabase
          .from("wegmans_invoices")
          .delete()
          .eq("source_file_name", file.name);

        if (deleteError) throw deleteError;
      }

      for (let index = 0; index < parsedRows.length; index += PAGE_SIZE) {
        const chunk = parsedRows.slice(index, index + PAGE_SIZE);
        const { error: insertError } = await supabase.from("wegmans_invoices").insert(chunk);
        if (insertError) throw insertError;
      }

      await loadRows();
      alert(`${parsedRows.length} Wegmans chargeback rows uploaded successfully.`);
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Wegmans chargeback upload failed."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleUpload(file);
  };

  const handleExportToExcel = () => {
    if (!filteredRows.length) {
      alert("No rows to export.");
      return;
    }

    const exportRows = filteredRows.map((row) => ({
      Vendor: row.vendor,
      Month: normalizeMonthLabel(row.month),
      "Run Date": formatDisplayDate(row.run_date),
      Invoice: row.invoice,
      Description: row.description,
      "Inv#": row.inv_number,
      Chargeback: row.chargeback,
      Type: row.type,
      "Source File Name": row.source_file_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Wegmans");

    const fileNameParts = ["wegmans_chargebacks"];
    if (monthFilter !== "All Months") {
      fileNameParts.push(normalizeMonthLabel(monthFilter).replace(/\s+/g, "_").replace(/'/g, ""));
    }

    XLSX.writeFile(workbook, `${fileNameParts.join("_")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Wegmans</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload Wegmans chargeback CSV files and review the accounting rows.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search invoice, description, Inv#"
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
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
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

              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? "Uploading..." : "Upload Data"}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rows</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{filteredRows.length.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Chargeback</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(totalChargeback)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Type</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{CHARGEBACK_TYPE}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading Wegmans rows...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            {loadError}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No Wegmans rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Vendor</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Run Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Inv#</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Chargeback</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr
                      key={row.id || `${row.source_file_name}-${row.line_number}-${index}`}
                      className="border-t border-slate-200 bg-white"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.vendor}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{normalizeMonthLabel(row.month)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.run_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.invoice}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.inv_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(row.chargeback)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.type}</td>
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
