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
  type: string | null;
  retailer: "target";
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();
}

function normalizeHeader(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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

  if (!text) return null;

  const mmddyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (mmddyyyy) {
    const [, mm, dd, yyyy] = mmddyyyy;

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

function toNumber(value: unknown) {
  const original = clean(value);

  const text = original
    .replace(/[$,]/g, "")
    .replace(/[()]/g, "")
    .trim();

  if (!text) return null;

  const number = Number(text);

  if (Number.isNaN(number)) return null;

  return original.includes("(") && original.includes(")")
    ? -number
    : number;
}

function getType(
  docHeaderText: string | null,
  reasonCodeDescription: string | null
) {
  const doc = clean(docHeaderText);
  const reason = clean(reasonCodeDescription);

  if (/^\d{4}$/.test(doc) || /^\d{4}$/.test(reason)) {
    return "WM Invoice";
  }

  if (/^TRT-TR/i.test(doc) || /^TRT-TR/i.test(reason)) {
    return "Lumper Charges";
  }

  return "Unknown";
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
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

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    return rows;
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

    if (index !== -1) {
      return row[index + 1] ?? "";
    }
  }

  return "";
}

export default function TargetView() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<TargetInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

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

  const handleUpload = async (file: File) => {
    setUploading(true);

    try {
      const rawRows = await parseTargetWorkbook(file);

      const checkNumber = clean(
        findMetadataValue(rawRows, "Check Number")
      );

      const checkDate = parseDate(
        findMetadataValue(rawRows, "Check Date")
      );

      const month = monthFromDate(checkDate);

      const headerRowIndex = rawRows.findIndex((row) =>
        row.some(
          (cell) =>
            normalizeHeader(cell) === "docheadertext"
        )
      );

      if (headerRowIndex === -1) {
        throw new Error(
          "Could not find Target invoice header row."
        );
      }

      const headers = rawRows[headerRowIndex];

      const docHeaderIndex = getHeaderIndex(headers, [
        "Doc.Header Text",
      ]);

      const reasonIndex = getHeaderIndex(headers, [
        "Reason Code Description",
      ]);

      const sapDocIndex = getHeaderIndex(headers, [
        "SAP Doc #",
      ]);

      const docDateIndex = getHeaderIndex(headers, [
        "Doc Date",
      ]);

      const grossIndex = getHeaderIndex(headers, [
        "Gross Amount",
      ]);

      const cashDiscountIndex = getHeaderIndex(headers, [
        "Cash Discount",
      ]);

      const withholdingIndex = getHeaderIndex(headers, [
        "Withholding Tax Amount",
      ]);

      const netIndex = getHeaderIndex(headers, [
        "Net Amount",
      ]);

      const parsedRows: TargetInvoiceRow[] = rawRows
        .slice(headerRowIndex + 1)
        .filter((row) =>
          row.some((cell) => clean(cell) !== "")
        )
        .map((row): TargetInvoiceRow => {
          const docHeaderText =
            clean(getValue(row, docHeaderIndex)) ||
            null;

          const reasonCodeDescription =
            clean(getValue(row, reasonIndex)) ||
            null;

          return {
            month,
            check_date: checkDate,
            check_number: checkNumber || null,
            doc_header_text: docHeaderText,
            reason_code_description:
              reasonCodeDescription,
            sap_doc_number:
              clean(getValue(row, sapDocIndex)) ||
              null,
            doc_date: parseDate(
              getValue(row, docDateIndex)
            ),
            gross_amount: toNumber(
              getValue(row, grossIndex)
            ),
            cash_discount: toNumber(
              getValue(row, cashDiscountIndex)
            ),
            withholding_tax_amount: toNumber(
              getValue(row, withholdingIndex)
            ),
            net_amount: toNumber(
              getValue(row, netIndex)
            ),
            type: getType(
              docHeaderText,
              reasonCodeDescription
            ),
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

      if (parsedRows.length === 0) {
        throw new Error(
          "No Target invoice rows found."
        );
      }

      const { error } = await supabase
        .from("target_invoices")
        .insert(parsedRows);

      if (error) throw error;

      await loadRows();

      alert(
        `Uploaded ${parsedRows.length} Target invoice rows successfully.`
      );
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Upload failed."
      );
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.gross += Number(row.gross_amount || 0);

        acc.cashDiscount += Number(
          row.cash_discount || 0
        );

        acc.withholding += Number(
          row.withholding_tax_amount || 0
        );

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
  }, [rows]);

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Target Invoices
            </h2>

            <p className="text-sm text-slate-500">
              Upload Target remittance files and save
              them to Supabase.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file =
                  event.target.files?.[0];

                if (file) {
                  handleUpload(file);
                }
              }}
            />

            <Button
              type="button"
              className="rounded-2xl bg-slate-900 hover:bg-slate-800"
              disabled={uploading}
              onClick={() =>
                fileInputRef.current?.click()
              }
            >
              <Upload className="mr-2 h-4 w-4" />

              {uploading
                ? "Uploading..."
                : "Upload Target File"}
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
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Month
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Check Date
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Check Number
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Doc.Header Text
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Reason Code Description
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      SAP Doc #
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Doc Date
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                      Gross Amount
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                      Cash Discount
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                      Withholding Tax Amount
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                      Net Amount
                    </th>

                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">
                      Type
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={12}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No Target invoices found.
                      </td>
                    </tr>
                  )}

                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-slate-200"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.month}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.check_date}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.check_number}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.doc_header_text}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {
                          row.reason_code_description
                        }
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.sap_doc_number}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.doc_date}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          row.gross_amount
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          row.cash_discount
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          row.withholding_tax_amount
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(
                          row.net_amount
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {row.type}
                      </td>
                    </tr>
                  ))}

                  {rows.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td
                        className="px-4 py-3"
                        colSpan={7}
                      >
                        Total
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          totals.gross
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          totals.cashDiscount
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          totals.withholding
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {formatCurrency(
                          totals.net
                        )}
                      </td>

                      <td className="px-4 py-3" />
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