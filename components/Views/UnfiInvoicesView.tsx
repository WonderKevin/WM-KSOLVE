"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type WorksheetRow = unknown[];

type UnfiInvoiceRow = {
  id?: number;
  month: string;
  description: string;
  upc: string;
  sales_period_fob: number | null;
  deal_oi_percent: number | null;
  promo_cases_to_cover: number | null;
  promo_dollars_to_cover: number | null;
  total: number | null;
  po_number: string;
  po_received_date: string | null;
  invoice_number: string;
  source_file_name: string;
  line_number: number;
  created_at?: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeMonthLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[â€™`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMonthLabel(monthNumber: number, year: number) {
  const date = new Date(year, monthNumber - 1, 1);
  return `${date.toLocaleString("en-US", { month: "long" })} '${String(year).slice(-2)}`;
}

function getMonthSortValue(value: string) {
  const normalized = normalizeMonthLabel(value);
  const match = normalized.match(/^([A-Za-z]+)\s+'(\d{2})$/);
  if (!match) return -Infinity;

  const monthIndex = new Date(`${match[1]} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return -Infinity;

  return (2000 + Number(match[2])) * 100 + monthIndex + 1;
}

function compareMonthLabelsDesc(a: string, b: string) {
  return getMonthSortValue(b) - getMonthSortValue(a);
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

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "";

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function formatOptionalInteger(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function normalizeUpc(value: unknown) {
  const text = clean(value).replace(/\.0$/, "");
  const trimmed = text.replace(/^0+/, "");
  return trimmed || text;
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

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;

  return value;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
}

function parseUnfiWorksheet(rawRows: WorksheetRow[], month: string, fileName: string) {
  const headerRowIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "description")
  );

  if (headerRowIndex === -1) {
    throw new Error(`Could not find the UNFI invoice header row in ${fileName}.`);
  }

  const headers = rawRows[headerRowIndex];
  const remitNameIndex = getHeaderIndex(headers, ["Remit Name"]);
  const invoiceNumberIndex = getHeaderIndex(headers, ["Invoice Number"]);
  const descriptionIndex = getHeaderIndex(headers, ["Description"]);
  const upcIndex = getHeaderIndex(headers, ["UPC"]);
  const salesPeriodFobIndex = getHeaderIndex(headers, ["Sales Period FOB"]);
  const dealOiPercentIndex = getHeaderIndex(headers, ["Deal OI Percent"]);
  const promoCasesIndex = getHeaderIndex(headers, ["Promo Cases to Cover"]);
  const promoDollarsIndex = getHeaderIndex(headers, ["Promo $ to Cover", "Promo Dollars to Cover"]);
  const poNumberIndex = getHeaderIndex(headers, ["PO Number"]);
  const poReceivedDateIndex = getHeaderIndex(headers, ["PO Received Date"]);
  const amountDueIndex = getHeaderIndex(headers, ["Amount Due"]);

  const requiredIndexes = [
    ["Description", descriptionIndex],
    ["UPC", upcIndex],
    ["Promo $ to Cover", promoDollarsIndex],
  ] as const;

  const missingHeader = requiredIndexes.find(([, index]) => index === -1);
  if (missingHeader) {
    throw new Error(`Missing "${missingHeader[0]}" column in ${fileName}.`);
  }

  const parsedRows: UnfiInvoiceRow[] = [];
  let currentDescription = "";
  let currentUpc = "";
  let currentInvoiceNumber = "";

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => clean(cell))) return;

    const remitName = normalizeHeader(getValue(row, remitNameIndex));
    const isProductTotal = remitName === "producttotal";
    const isWarehouseOrInvoiceTotal =
      remitName === "warehousetotal" || remitName === "invoicetotal";

    if (isWarehouseOrInvoiceTotal) return;

    const description = clean(getValue(row, descriptionIndex));
    const upc = normalizeUpc(getValue(row, upcIndex));
    const invoiceNumber = clean(getValue(row, invoiceNumberIndex));

    if (description) currentDescription = description;
    if (upc) currentUpc = upc;
    if (invoiceNumber) currentInvoiceNumber = invoiceNumber;

    if (isProductTotal) {
      const total =
        parseNumber(getValue(row, amountDueIndex)) ??
        parseNumber(getValue(row, promoDollarsIndex));

      parsedRows.push({
        month,
        description: currentDescription,
        upc: currentUpc,
        sales_period_fob: null,
        deal_oi_percent: null,
        promo_cases_to_cover: null,
        promo_dollars_to_cover: null,
        total,
        po_number: "",
        po_received_date: null,
        invoice_number: currentInvoiceNumber,
        source_file_name: fileName,
        line_number: index + 1,
      });

      return;
    }

    if (!description && !upc) return;

    parsedRows.push({
      month,
      description,
      upc,
      sales_period_fob: parseNumber(getValue(row, salesPeriodFobIndex)),
      deal_oi_percent: parseNumber(getValue(row, dealOiPercentIndex)),
      promo_cases_to_cover: parseNumber(getValue(row, promoCasesIndex)),
      promo_dollars_to_cover: parseNumber(getValue(row, promoDollarsIndex)),
      total: null,
      po_number: clean(getValue(row, poNumberIndex)),
      po_received_date: parseDate(getValue(row, poReceivedDateIndex)),
      invoice_number: invoiceNumber || currentInvoiceNumber,
      source_file_name: fileName,
      line_number: index + 1,
    });
  });

  return parsedRows;
}

async function fetchAllUnfiRows() {
  const pageSize = 1000;
  let from = 0;
  let allRows: UnfiInvoiceRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("unfi_invoices")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const batch = (data ?? []) as UnfiInvoiceRow[];
    allRows = [...allRows, ...batch];

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export default function UnfiInvoicesView() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<UnfiInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUploadBox, setShowUploadBox] = useState(false);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("All Months");
  const [monthInput, setMonthInput] = useState(String(currentMonth));
  const [yearInput, setYearInput] = useState(String(currentYear));

  const loadRows = async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await fetchAllUnfiRows();
      setRows(data);
    } catch (error: unknown) {
      console.error("Failed to load unfi_invoices:", error);
      const message = getErrorMessage(error, "Failed to load UNFI invoices.");
      setLoadError(
        message.includes("Could not find the table")
          ? "Supabase table public.unfi_invoices is not available yet."
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
      const monthCompare = compareMonthLabelsDesc(a.month, b.month);
      if (monthCompare !== 0) return monthCompare;

      const invoiceCompare = clean(b.invoice_number).localeCompare(clean(a.invoice_number));
      if (invoiceCompare !== 0) return invoiceCompare;

      return Number(a.line_number || 0) - Number(b.line_number || 0);
    });
  }, [rows]);

  const monthOptions = useMemo(
    () => [
      "All Months",
      ...Array.from(new Set(rows.map((row) => normalizeMonthLabel(row.month)).filter(Boolean))).sort(
        compareMonthLabelsDesc
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
          rowMonth,
          row.description,
          row.upc,
          row.sales_period_fob,
          row.deal_oi_percent,
          row.promo_cases_to_cover,
          row.promo_dollars_to_cover,
          row.total,
          row.po_number,
          row.po_received_date,
          row.invoice_number,
          row.source_file_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      return matchesMonth && matchesSearch;
    });
  }, [sortedRows, search, monthFilter]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.promoDollars += Number(row.promo_dollars_to_cover || 0);
          acc.total += Number(row.total || 0);
          return acc;
        },
        { promoDollars: 0, total: 0 }
      ),
    [filteredRows]
  );

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);

      const monthLabel = formatMonthLabel(Number(monthInput), Number(yearInput));
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
      const parsedRows = parseUnfiWorksheet(rawRows, monthLabel, file.name);

      if (!parsedRows.length) {
        alert("No UNFI invoice rows were parsed from the file.");
        return;
      }

      const existingForFile = rows.some(
        (row) =>
          normalizeMonthLabel(row.month) === normalizeMonthLabel(monthLabel) &&
          clean(row.source_file_name) === file.name
      );

      if (existingForFile) {
        const shouldReplace = window.confirm(
          `UNFI invoice data already exists for ${monthLabel} from ${file.name}.\n\nDo you want to replace it?`
        );

        if (!shouldReplace) return;

        const { error: deleteError } = await supabase
          .from("unfi_invoices")
          .delete()
          .eq("month", monthLabel)
          .eq("source_file_name", file.name);

        if (deleteError) throw deleteError;
      }

      for (let index = 0; index < parsedRows.length; index += 1000) {
        const chunk = parsedRows.slice(index, index + 1000);
        const { error: insertError } = await supabase.from("unfi_invoices").insert(chunk);
        if (insertError) throw insertError;
      }

      await loadRows();
      setShowUploadBox(false);
      alert(`${parsedRows.length} UNFI invoice rows uploaded successfully.`);
    } catch (error: unknown) {
      alert(getErrorMessage(error, "UNFI invoice upload failed."));
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
      Month: normalizeMonthLabel(row.month),
      Description: row.description,
      UPC: row.upc,
      "Sales Period FOB": row.sales_period_fob,
      "Deal OI Percent": row.deal_oi_percent,
      "Promo Cases to Cover": row.promo_cases_to_cover,
      "Promo $ to Cover": row.promo_dollars_to_cover,
      Total: row.total,
      "PO Number": row.po_number,
      "PO Received Date": formatDisplayDate(row.po_received_date),
      "Invoice Number": row.invoice_number,
      "Source File Name": row.source_file_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "UNFI Invoices");

    const fileNameParts = ["unfi_invoices"];
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
              <h2 className="text-xl font-bold text-slate-900">UNFI Invoices</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload UNFI invoice files and keep product totals beside the flavor rows.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search description, UPC, PO"
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

              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={() => setShowUploadBox((prev) => !prev)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Data
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
                    onChange={(event) => setMonthInput(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                      <option key={month} value={String(month)}>
                        {new Date(2026, month - 1, 1).toLocaleString("en-US", {
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
                    onChange={(event) => setYearInput(event.target.value)}
                    placeholder="2026"
                    className="rounded-xl"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    UNFI Invoice File
                  </label>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rows</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{filteredRows.length.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Promo $ to Cover</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatNumber(totals.promoDollars)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatNumber(totals.total)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading UNFI invoices...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            {loadError}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No UNFI invoice rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">UPC</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Sales Period FOB</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Deal OI Percent</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Promo Cases to Cover</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Promo $ to Cover</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Total</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">PO Number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">PO Received Date</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row, index) => {
                    const isTotalRow = row.total !== null && row.total !== undefined;

                    return (
                      <tr
                        key={row.id || `${row.source_file_name}-${row.line_number}-${index}`}
                        className={`border-t border-slate-200 ${isTotalRow ? "bg-amber-50/70" : "bg-white"}`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{normalizeMonthLabel(row.month)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.description}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.upc}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatNumber(row.sales_period_fob)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatNumber(row.deal_oi_percent, 0)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatOptionalInteger(row.promo_cases_to_cover)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">{formatNumber(row.promo_dollars_to_cover)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{formatNumber(row.total)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.po_number}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.po_received_date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
