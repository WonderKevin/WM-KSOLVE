"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

type TargetInvoiceRow = {
  id?: number;
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  doc_header_text: string | null;
  reason_code_description: string | null;
  sap_doc_number: string | null;
  doc_date: string | null;
  gross_amount: number | null;
  cash_discount: number | null;
  withholding_tax_amount: number | null;
  net_amount: number | null;
  retailer: "target";
};

type ParsedTargetFile = {
  fileName: string;
  checkDate: string | null;
  checkNumber: string | null;
  rows: TargetInvoiceRow[];
};

const REASON_PREFIXES = [
  { prefix: "TRT-TR02", description: "Unauthorized Carrier" },
  { prefix: "TRT-TR08", description: "Multiple Shipments" },
  { prefix: "TRT-TR09", description: "Assessorial Charges" },
  { prefix: "TRT-TR10", description: "Truck Ordered Not Used (TONU)" },
  { prefix: "TRT-TR11", description: "Expedited Freight" },
  { prefix: "TRT-TR14", description: "Freight on Returns" },
  { prefix: "TRT-TR15", description: "Domestic Sort and Seg." },
  { prefix: "VCNA", description: "Vendor Income Funding" },
  { prefix: "VCPN", description: "V192-Promotional" },
  { prefix: "VIAP", description: "Vendor Income Funding" },
  { prefix: "VONL", description: "Vendor Income Funding" },
  { prefix: "VSUP", description: "Vendor Income Funding" },
  { prefix: "RTVS8", description: "Return to Vendor" },
  { prefix: "RTVS2", description: "Return To Vendor" },
  { prefix: "VC", description: "P.O. SHIPPED EARLY/LATE" },
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDate(value: unknown) {
  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(
      parsed.d
    ).padStart(2, "0")}`;
  }

  const text = clean(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, mm, dd, yyyy] = match;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function monthFromDate(value: string | null) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function monthSortValue(month: string | null) {
  if (!month) return 0;

  const date = new Date(`1 ${month}`);
  if (Number.isNaN(date.getTime())) return 0;

  return date.getFullYear() * 100 + date.getMonth() + 1;
}

function toNumber(value: unknown) {
  const original = clean(value);
  const text = original.replace(/[$,]/g, "").replace(/[()]/g, "").trim();

  if (!text) return null;

  const number = Number(text);
  if (Number.isNaN(number)) return null;

  return original.includes("(") && original.includes(")") ? -number : number;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function resolveReasonDescription(docHeaderText: string | null) {
  const doc = clean(docHeaderText).toUpperCase();

  if (/^\d{4}$/.test(doc)) return "WM Invoice";

  const match = REASON_PREFIXES
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((item) => doc.startsWith(item.prefix.toUpperCase()));

  return match?.description || "";
}

function parseDelimitedTargetFile(text: string) {
  return text
    .replace(/\u0000/g, "")
    .split(/\r?\n|\r/)
    .map((line) => line.split("\t").map(clean))
    .filter((row) => row.some(Boolean));
}

async function parseTargetWorkbook(file: File) {
  const buffer = await file.arrayBuffer();

  try {
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: false,
      raw: false,
    });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
  } catch {
    const utf16 = new TextDecoder("utf-16le").decode(buffer);
    return parseDelimitedTargetFile(utf16);
  }
}

function getHeaderIndex(headers: unknown[], names: string[]) {
  const normalized = headers.map(normalizeHeader);

  for (const name of names) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }

  return -1;
}

function getValue(row: unknown[], index: number) {
  if (index < 0) return "";
  return row[index];
}

function findMetadataValue(rows: unknown[][], label: string) {
  const normalizedLabel = normalizeHeader(label);

  for (const row of rows) {
    const index = row.findIndex(
      (cell) => normalizeHeader(cell) === normalizedLabel
    );

    if (index !== -1) return row[index + 1] ?? "";
  }

  return "";
}

async function parseTargetFile(file: File): Promise<ParsedTargetFile> {
  const rawRows = await parseTargetWorkbook(file);

  const checkNumber = clean(findMetadataValue(rawRows, "Check Number")) || null;
  const checkDate = parseDate(findMetadataValue(rawRows, "Check Date"));
  const month = monthFromDate(checkDate);

  const headerRowIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "docheadertext")
  );

  if (headerRowIndex === -1) {
    throw new Error(`Could not find Target invoice header row in ${file.name}.`);
  }

  const headers = rawRows[headerRowIndex];

  const docHeaderIndex = getHeaderIndex(headers, ["Doc.Header Text"]);
  const sapDocIndex = getHeaderIndex(headers, ["SAP Doc #"]);
  const docDateIndex = getHeaderIndex(headers, ["Doc Date"]);
  const grossIndex = getHeaderIndex(headers, ["Gross Amount"]);
  const cashDiscountIndex = getHeaderIndex(headers, ["Cash Discount"]);
  const withholdingIndex = getHeaderIndex(headers, ["Withholding Tax Amount"]);
  const netIndex = getHeaderIndex(headers, ["Net Amount"]);

  const rows: TargetInvoiceRow[] = rawRows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => clean(cell) !== ""))
    .map((row): TargetInvoiceRow => {
      const docHeaderText = clean(getValue(row, docHeaderIndex)) || null;

      return {
        month,
        check_date: checkDate,
        check_number: checkNumber,
        doc_header_text: docHeaderText,
        reason_code_description: resolveReasonDescription(docHeaderText),
        sap_doc_number: clean(getValue(row, sapDocIndex)) || null,
        doc_date: parseDate(getValue(row, docDateIndex)),
        gross_amount: toNumber(getValue(row, grossIndex)),
        cash_discount: toNumber(getValue(row, cashDiscountIndex)),
        withholding_tax_amount: toNumber(getValue(row, withholdingIndex)),
        net_amount: toNumber(getValue(row, netIndex)),
        retailer: "target",
      };
    })
    .filter(
      (row) =>
        row.doc_header_text ||
        row.sap_doc_number ||
        row.gross_amount !== null ||
        row.net_amount !== null
    );

  if (rows.length === 0) {
    throw new Error(`No Target invoice rows found in ${file.name}.`);
  }

  return {
    fileName: file.name,
    checkDate,
    checkNumber,
    rows,
  };
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return JSON.stringify(error);
}

export default function TargetView() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [selectedReason, setSelectedReason] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("all");

  const loadRows = async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("target_invoices")
        .select("*")
        .order("check_date", { ascending: false });

      if (error) throw error;

      setRows((data || []) as TargetInvoiceRow[]);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const existingCheckKeys = useMemo(() => {
    return new Set(
      rows
        .filter((row) => row.check_date && row.check_number)
        .map((row) => `${row.check_date}__${row.check_number}`)
    );
  }, [rows]);

  const monthOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.month).filter(Boolean)))
      .sort((a, b) => monthSortValue(b) - monthSortValue(a)) as string[];
  }, [rows]);

  const reasonOptions = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map(
            (row) =>
              row.reason_code_description ||
              resolveReasonDescription(row.doc_header_text) ||
              "Unknown"
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const reason =
        row.reason_code_description ||
        resolveReasonDescription(row.doc_header_text) ||
        "Unknown";

      const matchesReason =
        selectedReason === "all" || reason === selectedReason;

      const matchesMonth =
        selectedMonth === "all" || row.month === selectedMonth;

      return matchesReason && matchesMonth;
    });
  }, [rows, selectedReason, selectedMonth]);

  const handleUpload = async (files: FileList) => {
    setUploading(true);

    try {
      const parsedFiles: ParsedTargetFile[] = [];

      for (const file of Array.from(files)) {
        parsedFiles.push(await parseTargetFile(file));
      }

      let uploadedCount = 0;
      let skippedCount = 0;
      let replacedCount = 0;

      for (const parsedFile of parsedFiles) {
        const checkKey =
          parsedFile.checkDate && parsedFile.checkNumber
            ? `${parsedFile.checkDate}__${parsedFile.checkNumber}`
            : "";

        const exists = checkKey ? existingCheckKeys.has(checkKey) : false;

        if (exists) {
          const shouldReplace = window.confirm(
            `A Target invoice already exists for Check # ${parsedFile.checkNumber} dated ${parsedFile.checkDate}.\n\nFile: ${parsedFile.fileName}\n\nDo you want to replace it?`
          );

          if (!shouldReplace) {
            skippedCount += parsedFile.rows.length;
            continue;
          }

          const { error: deleteError } = await supabase
            .from("target_invoices")
            .delete()
            .eq("check_number", parsedFile.checkNumber)
            .eq("check_date", parsedFile.checkDate);

          if (deleteError) throw deleteError;

          replacedCount += parsedFile.rows.length;
        }

        const { error: insertError } = await supabase
          .from("target_invoices")
          .insert(parsedFile.rows);

        if (insertError) throw insertError;

        uploadedCount += parsedFile.rows.length;
      }

      await loadRows();

      alert(
        `Upload complete.\n\nUploaded rows: ${uploadedCount}\nReplaced rows: ${replacedCount}\nSkipped rows: ${skippedCount}`
      );
    } catch (error) {
      console.error(error);
      alert(getUploadErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.gross += Number(row.gross_amount || 0);
        acc.cashDiscount += Number(row.cash_discount || 0);
        acc.withholding += Number(row.withholding_tax_amount || 0);
        acc.net += Number(row.net_amount || 0);
        return acc;
      },
      {
        gross: 0,
        cashDiscount: 0,
        withholding: 0,
        net: 0,
      }
    );
  }, [filteredRows]);

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Target Invoices
            </h2>
            <p className="text-sm text-slate-500">
              Upload one or multiple Target remittance files and save them to
              Supabase.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">
                Month
              </label>
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">
                Reason Code Description
              </label>
              <select
                value={selectedReason}
                onChange={(event) => setSelectedReason(event.target.value)}
                className="min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                {reasonOptions.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) handleUpload(files);
              }}
            />

            <Button
              type="button"
              className="rounded-2xl bg-slate-900 hover:bg-slate-800"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload Target Files"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-5 pt-6">
          {loading ? (
            <p className="text-sm text-slate-500">
              Loading Target invoices...
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Check Number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Doc.Header Text</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Reason Code Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">SAP Doc #</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Doc Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Gross Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Cash Discount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Withholding Tax Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Net Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No Target invoices found.
                      </td>
                    </tr>
                  )}

                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="whitespace-nowrap px-4 py-3">{row.month}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.check_date}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.check_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.doc_header_text}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.reason_code_description ||
                          resolveReasonDescription(row.doc_header_text)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{row.sap_doc_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.doc_date}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.gross_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.cash_discount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(row.withholding_tax_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(row.net_amount)}
                      </td>
                    </tr>
                  ))}

                  {filteredRows.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-4 py-3" colSpan={7}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.gross)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.cashDiscount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.withholding)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(totals.net)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}