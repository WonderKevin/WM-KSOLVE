"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type WorksheetRow = unknown[];

type TonyInvoiceTypeSplit = {
  id?: number;
  detail_id?: number;
  type: string;
  amount: number | null;
  created_at?: string;
};

type TonyInvoiceDetail = {
  id?: number;
  wire_id?: number;
  invoice_number: string;
  po_number: string;
  invoice_amount: number | null;
  discount_amount: number | null;
  amount_paid: number | null;
  type: string;
  line_number: number;
  type_splits?: TonyInvoiceTypeSplit[];
};

type TonyInvoiceWire = {
  id?: number;
  month: string;
  wired_on: string | null;
  ach_number: string;
  total_wire: number | null;
  source_file_name: string;
  created_at?: string;
  details?: TonyInvoiceDetail[];
};

type ParsedTonyInvoiceFile = {
  wire: Omit<TonyInvoiceWire, "id" | "created_at" | "details">;
  details: TonyInvoiceDetail[];
};

const PAGE_SIZE = 1000;

function clean(value: unknown) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
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

  const date = new Date(`1 ${month}`);
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

function getDetailAllocations(detail: TonyInvoiceDetail) {
  const splits = detail.type_splits || [];

  if (splits.length) {
    return splits.map((split) => ({
      type: clean(split.type) || "Unassigned",
      amount: Number(split.amount || 0),
    }));
  }

  return [
    {
      type: clean(detail.type) || "Unassigned",
      amount: Number(detail.amount_paid || 0),
    },
  ];
}

function getSplitTotal(detail: TonyInvoiceDetail) {
  return (detail.type_splits || []).reduce(
    (sum, split) => sum + Number(split.amount || 0),
    0
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return fallback;
}

function findValueAfterLabel(rawRows: WorksheetRow[], label: string) {
  const normalizedLabel = normalizeHeader(label);

  for (const row of rawRows) {
    const labelIndex = row.findIndex((cell) => normalizeHeader(cell) === normalizedLabel);
    if (labelIndex === -1) continue;

    for (let index = labelIndex + 1; index < row.length; index += 1) {
      const value = clean(row[index]);
      if (value) return row[index];
    }
  }

  return "";
}

function parseTonyInvoiceWorkbook(rawRows: WorksheetRow[], fileName: string): ParsedTonyInvoiceFile {
  const achNumber = clean(findValueAfterLabel(rawRows, "ACH #")).replace(/\.0$/, "");
  const wiredOn = parseDate(findValueAfterLabel(rawRows, "Wired on"));
  const month = monthFromDate(wiredOn);

  if (!achNumber) {
    throw new Error(`Could not find ACH # in ${fileName}.`);
  }

  if (!wiredOn) {
    throw new Error(`Could not find Wired on date in ${fileName}.`);
  }

  const headerRowIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "invoice")
  );

  if (headerRowIndex === -1) {
    throw new Error(`Could not find the invoice detail header row in ${fileName}.`);
  }

  const headers = rawRows[headerRowIndex];
  const invoiceIndex = getHeaderIndex(headers, ["Invoice#"]);
  const poIndex = getHeaderIndex(headers, ["PO#"]);
  const invoiceAmountIndex = getHeaderIndex(headers, ["Invoice Amount"]);
  const discountAmountIndex = getHeaderIndex(headers, ["Discount Amount"]);
  const amountPaidIndex = getHeaderIndex(headers, ["Amount Paid"]);
  const typeIndex = getHeaderIndex(headers, ["Type", "Comment"]);

  const requiredIndexes = [
    ["Invoice#", invoiceIndex],
    ["PO#", poIndex],
    ["Invoice Amount", invoiceAmountIndex],
    ["Discount Amount", discountAmountIndex],
    ["Amount Paid", amountPaidIndex],
  ] as const;

  const missingHeader = requiredIndexes.find(([, index]) => index === -1);
  if (missingHeader) {
    throw new Error(`Missing "${missingHeader[0]}" column in ${fileName}.`);
  }

  let totalWire = parseNumber(findValueAfterLabel(rawRows, "Total Wire"));
  const details: TonyInvoiceDetail[] = [];

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => clean(cell))) return;
    if (row.some((cell) => normalizeHeader(cell) === "totalwire")) return;

    const invoiceNumber = clean(getValue(row, invoiceIndex)).replace(/\.0$/, "");
    const poNumber = clean(getValue(row, poIndex)).replace(/\.0$/, "");
    const invoiceAmount = parseNumber(getValue(row, invoiceAmountIndex));
    const discountAmount = parseNumber(getValue(row, discountAmountIndex));
    const amountPaid = parseNumber(getValue(row, amountPaidIndex));
    const type = clean(getValue(row, typeIndex));

    if (!invoiceNumber && !poNumber && invoiceAmount == null && discountAmount == null && amountPaid == null && !type) {
      return;
    }

    details.push({
      invoice_number: invoiceNumber,
      po_number: poNumber,
      invoice_amount: invoiceAmount,
      discount_amount: discountAmount,
      amount_paid: amountPaid,
      type,
      line_number: index + 1,
    });
  });

  if (!details.length) {
    throw new Error(`No invoice detail rows were found in ${fileName}.`);
  }

  if (totalWire == null) {
    totalWire = details.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
  }

  return {
    wire: {
      month,
      wired_on: wiredOn,
      ach_number: achNumber,
      total_wire: totalWire,
      source_file_name: fileName,
    },
    details,
  };
}

async function fetchAllTonyWires() {
  let from = 0;
  let allRows: TonyInvoiceWire[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("tony_invoice_wires")
      .select(
        "id, month, wired_on, ach_number, total_wire, source_file_name, created_at, details:tony_invoice_details(id, wire_id, invoice_number, po_number, invoice_amount, discount_amount, amount_paid, type, line_number, type_splits:tony_invoice_detail_type_splits(id, detail_id, type, amount, created_at))"
      )
      .order("wired_on", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = ((data ?? []) as TonyInvoiceWire[]).map((row) => ({
      ...row,
      details: [...(row.details || [])].sort(
        (a, b) => Number(a.line_number || 0) - Number(b.line_number || 0)
      ).map((detail) => ({
        ...detail,
        type_splits: [...(detail.type_splits || [])].sort(
          (a, b) => Number(a.id || 0) - Number(b.id || 0)
        ),
      })),
    }));
    allRows = [...allRows, ...batch];

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export default function TonyInvoicesView() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<TonyInvoiceWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingTypeId, setSavingTypeId] = useState<number | null>(null);
  const [savingSplitDetailId, setSavingSplitDetailId] = useState<number | null>(null);
  const [deletingSplitId, setDeletingSplitId] = useState<number | null>(null);
  const [deletingWireId, setDeletingWireId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [openDetailRows, setOpenDetailRows] = useState<Record<string, boolean>>({});
  const [splitDrafts, setSplitDrafts] = useState<
    Record<string, { type: string; amount: string }>
  >({});

  const loadRows = async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await fetchAllTonyWires();
      setRows(data);
    } catch (error: unknown) {
      console.error("Failed to load tony_invoice_wires:", error);
      const message = getErrorMessage(error, "Failed to load Tony's invoices.");
      setLoadError(
        message.includes("Could not find the table")
          ? "Supabase tables public.tony_invoice_wires and public.tony_invoice_details are not available yet."
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
      const dateCompare = clean(b.wired_on).localeCompare(clean(a.wired_on));
      if (dateCompare !== 0) return dateCompare;

      return clean(b.ach_number).localeCompare(clean(a.ach_number));
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRows;

    return sortedRows.filter((row) => {
      const detailText = (row.details || [])
        .map((detail) =>
          [
            detail.invoice_number,
            detail.po_number,
            detail.invoice_amount,
            detail.discount_amount,
            detail.amount_paid,
            detail.type,
          ].join(" ")
        )
        .join(" ");

      return [
        row.month,
        row.wired_on,
        row.ach_number,
        row.total_wire,
        row.source_file_name,
        detailText,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [sortedRows, search]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.wires += 1;
          acc.details += row.details?.length || 0;
          acc.totalWire += Number(row.total_wire || 0);
          return acc;
        },
        { wires: 0, details: 0, totalWire: 0 }
      ),
    [filteredRows]
  );

  const existingKeys = useMemo(() => {
    const map = new Map<string, TonyInvoiceWire>();
    for (const row of rows) {
      map.set(`${row.wired_on || ""}__${row.ach_number || ""}`, row);
    }
    return map;
  }, [rows]);

  const toggleOpen = (key: string) => {
    setOpenRows((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleDetailOpen = (key: string) => {
    setOpenDetailRows((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const updateSplitDraft = (
    key: string,
    field: "type" | "amount",
    value: string
  ) => {
    setSplitDrafts((prev) => ({
      ...prev,
      [key]: {
        type: prev[key]?.type || "",
        amount: prev[key]?.amount || "",
        [field]: value,
      },
    }));
  };

  const updateDetailTypeLocally = (detailId: number, type: string) => {
    setRows((prev) =>
      prev.map((wire) => ({
        ...wire,
        details: (wire.details || []).map((detail) =>
          detail.id === detailId ? { ...detail, type } : detail
        ),
      }))
    );
  };

  const saveDetailType = async (detail: TonyInvoiceDetail, nextType: string) => {
    if (!detail.id) return;

    const currentType = clean(detail.type);
    const normalizedNextType = clean(nextType);
    if (currentType === normalizedNextType) return;

    setSavingTypeId(detail.id);
    updateDetailTypeLocally(detail.id, normalizedNextType);

    const { error } = await supabase
      .from("tony_invoice_details")
      .update({ type: normalizedNextType })
      .eq("id", detail.id);

    setSavingTypeId(null);

    if (error) {
      updateDetailTypeLocally(detail.id, currentType);
      alert(getErrorMessage(error, "Failed to save type."));
    }
  };

  const addTypeSplit = async (detail: TonyInvoiceDetail, draftKey: string) => {
    if (!detail.id) return;

    const draft = splitDrafts[draftKey] || { type: "", amount: "" };
    const splitType = clean(draft.type);
    const splitAmount = parseNumber(draft.amount);

    if (!splitType) {
      alert("Enter a type.");
      return;
    }

    if (splitAmount == null) {
      alert("Enter an amount.");
      return;
    }

    const signedAmount =
      Number(detail.amount_paid || 0) < 0 && splitAmount > 0
        ? -Math.abs(splitAmount)
        : splitAmount;

    setSavingSplitDetailId(detail.id);

    const { error } = await supabase.from("tony_invoice_detail_type_splits").insert({
      detail_id: detail.id,
      type: splitType,
      amount: signedAmount,
    });

    setSavingSplitDetailId(null);

    if (error) {
      alert(getErrorMessage(error, "Failed to add type split."));
      return;
    }

    setSplitDrafts((prev) => ({
      ...prev,
      [draftKey]: { type: "", amount: "" },
    }));
    await loadRows();
  };

  const deleteTypeSplit = async (split: TonyInvoiceTypeSplit) => {
    if (!split.id) return;

    setDeletingSplitId(split.id);

    const { error } = await supabase
      .from("tony_invoice_detail_type_splits")
      .delete()
      .eq("id", split.id);

    setDeletingSplitId(null);

    if (error) {
      alert(getErrorMessage(error, "Failed to delete type split."));
      return;
    }

    await loadRows();
  };

  const deleteWire = async (wire: TonyInvoiceWire) => {
    if (!wire.id) return;

    const shouldDelete = window.confirm(
      `Delete Tony's invoice ACH # ${wire.ach_number} dated ${formatDisplayDate(
        wire.wired_on
      )}?\n\nThis will also delete its invoice details and type allocations.`
    );

    if (!shouldDelete) return;

    setDeletingWireId(wire.id);

    const { error } = await supabase
      .from("tony_invoice_wires")
      .delete()
      .eq("id", wire.id);

    setDeletingWireId(null);

    if (error) {
      alert(getErrorMessage(error, "Failed to delete Tony's invoice."));
      return;
    }

    await loadRows();
  };

  const handleUpload = async (files: FileList) => {
    try {
      setUploading(true);

      let uploadedFiles = 0;
      let uploadedDetails = 0;
      let skippedFiles = 0;
      let replacedFiles = 0;

      for (const file of Array.from(files)) {
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
        const parsedFile = parseTonyInvoiceWorkbook(rawRows, file.name);
        const existingKey = `${parsedFile.wire.wired_on || ""}__${parsedFile.wire.ach_number || ""}`;
        const existing = existingKeys.get(existingKey);

        if (existing?.id) {
          const shouldReplace = window.confirm(
            `Tony's invoice ACH # ${parsedFile.wire.ach_number} dated ${formatDisplayDate(
              parsedFile.wire.wired_on
            )} already exists.\n\nFile: ${file.name}\n\nDo you want to replace it?`
          );

          if (!shouldReplace) {
            skippedFiles += 1;
            continue;
          }

          const { error: deleteError } = await supabase
            .from("tony_invoice_wires")
            .delete()
            .eq("id", existing.id);

          if (deleteError) throw deleteError;
          replacedFiles += 1;
        }

        const { data: wireData, error: wireError } = await supabase
          .from("tony_invoice_wires")
          .insert(parsedFile.wire)
          .select("id")
          .single();

        if (wireError) throw wireError;

        const wireId = Number(wireData?.id);
        const detailRows = parsedFile.details.map((detail) => ({
          ...detail,
          wire_id: wireId,
        }));

        for (let index = 0; index < detailRows.length; index += PAGE_SIZE) {
          const chunk = detailRows.slice(index, index + PAGE_SIZE);
          const { error: detailError } = await supabase.from("tony_invoice_details").insert(chunk);
          if (detailError) throw detailError;
        }

        uploadedFiles += 1;
        uploadedDetails += detailRows.length;
      }

      await loadRows();

      alert(
        `Upload complete.\n\nUploaded files: ${uploadedFiles}\nReplaced files: ${replacedFiles}\nSkipped files: ${skippedFiles}\nInvoice detail rows: ${uploadedDetails}`
      );
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Tony's invoice upload failed."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await handleUpload(files);
  };

  const handleExportToExcel = () => {
    if (!filteredRows.length) {
      alert("No rows to export.");
      return;
    }

    const exportRows = filteredRows.flatMap((wire) =>
      (wire.details || []).flatMap((detail) =>
        getDetailAllocations(detail).map((allocation) => ({
          Retailer: "Tony's",
          Month: wire.month,
          Date: formatDisplayDate(wire.wired_on),
          "ACH#": wire.ach_number,
          "Total Wire": wire.total_wire,
          "Invoice#": detail.invoice_number,
          "PO#": detail.po_number,
          "Invoice Amount": detail.invoice_amount,
          "Discount Amount": detail.discount_amount,
          "Original Amount Paid": detail.amount_paid,
          Type: allocation.type,
          "Type Amount": allocation.amount,
          "Source File Name": wire.source_file_name,
        }))
      )
    );

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tony Invoices");
    XLSX.writeFile(workbook, "tonys_invoices.xlsx");
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 bg-slate-100/95 pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Tony&apos;s Invoices</h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload ACH payment files and review wire totals with invoice-level details.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-[300px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search ACH, invoice, PO, type"
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

              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={handleExportToExcel}
                disabled={!filteredRows.length}
              >
                <Download className="mr-2 h-4 w-4" />
                Export Details
              </Button>

              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
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
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">ACH Wires</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{totals.wires.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoice Rows</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{totals.details.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Wire</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(totals.totalWire)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading Tony&apos;s invoices...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
            {loadError}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No Tony&apos;s invoice rows found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Retailer</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Month</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">ACH#</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Total Wire</th>
                    <th className="w-12 whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700" />
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row, index) => {
                    const rowKey = String(row.id || `${row.ach_number}-${row.wired_on}-${index}`);
                    const isOpen = !!openRows[rowKey];

                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleOpen(rowKey)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleOpen(rowKey);
                            }
                          }}
                          className="cursor-pointer border-t border-slate-200 bg-white transition hover:bg-slate-50"
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                            <span className="inline-flex items-center gap-2">
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <span className="font-medium text-slate-900">Tony&apos;s</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.month}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDisplayDate(row.wired_on)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{row.ach_number}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                            {formatCurrency(row.total_wire)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <button
                              type="button"
                              title="Delete invoice"
                              aria-label={`Delete Tony's invoice ACH # ${row.ach_number}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteWire(row);
                              }}
                              disabled={!row.id || deletingWireId === row.id}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="border-t border-slate-200 bg-slate-50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-100">
                                    <tr>
                                      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Invoice#</th>
                                      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">PO#</th>
                                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Invoice Amount</th>
                                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Discount Amount</th>
                                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">Amount Paid</th>
                                      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(row.details || []).map((detail, detailIndex) => {
                                      const detailKey = String(
                                        detail.id || `${rowKey}-${detail.line_number}-${detailIndex}`
                                      );
                                      const isDetailOpen = !!openDetailRows[detailKey];
                                      const splitTotal = getSplitTotal(detail);
                                      const hasSplits = (detail.type_splits || []).length > 0;
                                      const remaining = Number(detail.amount_paid || 0) - splitTotal;
                                      const draft = splitDrafts[detailKey] || { type: "", amount: "" };

                                      return (
                                        <React.Fragment key={detailKey}>
                                          <tr
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => toggleDetailOpen(detailKey)}
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                toggleDetailOpen(detailKey);
                                              }
                                            }}
                                            className="cursor-pointer border-t border-slate-200 transition hover:bg-slate-50"
                                          >
                                            <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                                              <span className="inline-flex items-center gap-2">
                                                {isDetailOpen ? (
                                                  <ChevronDown className="h-4 w-4 text-slate-500" />
                                                ) : (
                                                  <ChevronRight className="h-4 w-4 text-slate-500" />
                                                )}
                                                {detail.invoice_number}
                                              </span>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-slate-700">{detail.po_number}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                                              {formatCurrency(detail.invoice_amount)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                                              {formatCurrency(detail.discount_amount)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
                                              {formatCurrency(detail.amount_paid)}
                                            </td>
                                            <td className="min-w-[260px] whitespace-nowrap px-4 py-3 text-slate-700">
                                              {hasSplits ? (
                                                <div className="text-sm">
                                                  <div className="font-medium text-slate-900">
                                                    {(detail.type_splits || []).length} split types
                                                  </div>
                                                  <div
                                                    className={`text-xs ${
                                                      Math.abs(remaining) < 0.01
                                                        ? "text-emerald-600"
                                                        : "text-amber-600"
                                                    }`}
                                                  >
                                                    Allocated {formatCurrency(splitTotal)} / Remaining {formatCurrency(remaining)}
                                                  </div>
                                                </div>
                                              ) : (
                                                <Input
                                                  defaultValue={detail.type}
                                                  placeholder="Add type"
                                                  onClick={(event) => event.stopPropagation()}
                                                  onKeyDown={(event) => {
                                                    event.stopPropagation();
                                                    if (event.key === "Enter") {
                                                      event.currentTarget.blur();
                                                    }
                                                  }}
                                                  onBlur={(event) =>
                                                    saveDetailType(detail, event.currentTarget.value)
                                                  }
                                                  disabled={savingTypeId === detail.id}
                                                  className="h-9 min-w-[180px] rounded-xl"
                                                />
                                              )}
                                            </td>
                                          </tr>

                                          {isDetailOpen && (
                                            <tr className="border-t border-slate-200 bg-slate-50">
                                              <td colSpan={6} className="px-6 py-4">
                                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                      <div className="text-sm font-semibold text-slate-900">
                                                        Type allocations
                                                      </div>
                                                      <div className="text-xs text-slate-500">
                                                        Summary uses these split amounts when any allocation exists.
                                                      </div>
                                                    </div>
                                                    <div
                                                      className={`text-sm font-medium ${
                                                        Math.abs(remaining) < 0.01
                                                          ? "text-emerald-600"
                                                          : "text-amber-600"
                                                      }`}
                                                    >
                                                      Remaining {formatCurrency(remaining)}
                                                    </div>
                                                  </div>

                                                  <div className="space-y-2">
                                                    {(detail.type_splits || []).map((split) => (
                                                      <div
                                                        key={split.id || `${detailKey}-${split.type}-${split.amount}`}
                                                        className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:grid-cols-[1fr_160px_44px] sm:items-center"
                                                      >
                                                        <div className="font-medium text-slate-900">{split.type || "Unassigned"}</div>
                                                        <div className="text-right font-semibold text-slate-900">
                                                          {formatCurrency(split.amount)}
                                                        </div>
                                                        <button
                                                          type="button"
                                                          onClick={(event) => {
                                                            event.stopPropagation();
                                                            deleteTypeSplit(split);
                                                          }}
                                                          disabled={deletingSplitId === split.id}
                                                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-50"
                                                        >
                                                          <Trash2 className="h-4 w-4" />
                                                        </button>
                                                      </div>
                                                    ))}

                                                    <div className="grid gap-2 pt-2 sm:grid-cols-[1fr_180px_auto] sm:items-center">
                                                      <Input
                                                        value={draft.type}
                                                        onChange={(event) =>
                                                          updateSplitDraft(detailKey, "type", event.target.value)
                                                        }
                                                        placeholder="Type, e.g. EDLC"
                                                        className="h-10 rounded-xl"
                                                      />
                                                      <Input
                                                        value={draft.amount}
                                                        onChange={(event) =>
                                                          updateSplitDraft(detailKey, "amount", event.target.value)
                                                        }
                                                        placeholder="Amount"
                                                        className="h-10 rounded-xl"
                                                      />
                                                      <Button
                                                        type="button"
                                                        onClick={() => addTypeSplit(detail, detailKey)}
                                                        disabled={savingSplitDetailId === detail.id || !detail.id}
                                                        className="rounded-xl"
                                                      >
                                                        <Plus className="mr-2 h-4 w-4" />
                                                        Add Type
                                                      </Button>
                                                    </div>
                                                  </div>
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
