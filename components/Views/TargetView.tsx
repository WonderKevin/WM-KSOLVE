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

function excelDateToIso(value: any) {
  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    const yyyy = parsed.y;
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
  }

  const date = new Date(value);
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

function toNumber(value: any) {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value).replace(/[$,]/g, "").trim();
  const number = Number(cleaned);

  return Number.isNaN(number) ? null : number;
}

function getType(docHeaderText: string | null, reasonCodeDescription: string | null) {
  const doc = String(docHeaderText || "").trim();
  const reason = String(reasonCodeDescription || "").trim();

  if (/^\d{4}$/.test(doc)) return "WM Invoice";
  if (/^TRT-TR/i.test(reason)) return "Lumper Charges";
  if (/^TRT-TR/i.test(doc)) return "Lumper Charges";

  return "Unknown";
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
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
        .order("check_date", { ascending: false })
        .order("check_number", { ascending: false });

      if (error) throw error;

      setRows((data || []) as TargetInvoiceRow[]);
    } catch (error) {
      console.error("Target invoices load error:", error);
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
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      const checkNumber = String(rawRows[6]?.[1] || "").trim();
      const checkDate = excelDateToIso(rawRows[7]?.[1]);
      const month = monthFromDate(checkDate);

      const headerRowIndex = rawRows.findIndex((row) =>
        row.some((cell) => String(cell).trim() === "Doc.Header Text")
      );

      if (headerRowIndex === -1) {
        throw new Error("Could not find Target invoice header row.");
      }

      const dataRows = rawRows.slice(headerRowIndex + 1);

      const parsedRows: TargetInvoiceRow[] = dataRows
        .filter((row) => row.some((cell) => String(cell).trim() !== ""))
        .map((row) => {
          const docHeaderText = String(row[0] || "").trim() || null;
          const reasonCodeDescription = String(row[2] || "").trim() || null;

          return {
            month,
            check_date: checkDate,
            check_number: checkNumber,
            doc_header_text: docHeaderText,
            reason_code_description: reasonCodeDescription,
            sap_doc_number: String(row[4] || "").trim() || null,
            doc_date: excelDateToIso(row[5]),
            gross_amount: toNumber(row[6]),
            cash_discount: toNumber(row[7]),
            withholding_tax_amount: toNumber(row[8]),
            net_amount: toNumber(row[9]),
            type: getType(docHeaderText, reasonCodeDescription),
            retailer: "target",
          };
        });

      if (parsedRows.length === 0) {
        throw new Error("No invoice rows found in uploaded file.");
      }

      const { error } = await supabase.from("target_invoices").insert(parsedRows);

      if (error) throw error;

      await loadRows();
    } catch (error) {
      console.error("Target upload error:", error);
      alert(error instanceof Error ? error.message : "Upload failed.");
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
  }, [rows]);

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Target Invoices</h2>
            <p className="text-sm text-slate-500">
              Upload Target remittance files and save them to Supabase.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />

            <Button
              type="button"
              className="rounded-2xl bg-slate-900 hover:bg-slate-800"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload Target File"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-5 pt-6">
          {loading ? (
            <p className="text-sm text-slate-500">Loading Target invoices...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No Target invoices found.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Check Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Check Number</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Doc.Header Text</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Reason Code Description</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">SAP Doc #</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Doc Date</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Gross Amount</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Cash Discount</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Withholding Tax Amount</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Net Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="px-4 py-3">{row.month}</td>
                      <td className="px-4 py-3">{row.check_date}</td>
                      <td className="px-4 py-3">{row.check_number}</td>
                      <td className="px-4 py-3">{row.doc_header_text}</td>
                      <td className="px-4 py-3">{row.reason_code_description}</td>
                      <td className="px-4 py-3">{row.sap_doc_number}</td>
                      <td className="px-4 py-3">{row.doc_date}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(row.gross_amount)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(row.cash_discount)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(row.withholding_tax_amount)}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrency(row.net_amount)}</td>
                      <td className="px-4 py-3">{row.type}</td>
                    </tr>
                  ))}

                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-4 py-3" colSpan={7}>
                      Total
                    </td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.gross)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.cashDiscount)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.withholding)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(totals.net)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}