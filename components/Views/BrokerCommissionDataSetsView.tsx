
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Filter,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

type Row = {
  id: string;
  month: string;
  checkDate: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  custName: string;
  retailer: string;
  amt: number;
};

type InvoiceRow = { invoice_number: string };
type UploadRow = { invoice: string | null };
type LocationRow = { customer: string; retailer: string };
type RetailerOverrideRow = { dataset_id: string; retailer: string };

const EDITABLE_RETAILERS = [
  "Fresh Thyme",
  "Kroger",
  "INFRA & Others",
  "HEB",
  "Add new retailer...",
] as const;

function formatMonthShort(value: string): string {
  if (!value) return value;
  if (/^[A-Za-z]+ '\d{2}$/.test(value.trim())) return value.trim();
  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) return `${m[1]} '${m[2].slice(-2)}`;
  return value;
}

function formatMonthFromDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatCheckDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function normalizeInvoice(value: string) {
  return String(value || "").replace(/\s+/g, "").replace(/[.]+$/g, "").trim().toUpperCase();
}

function normalizeText(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\*/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFirstTwoWords(value: string) {
  return normalizeText(value).split(" ").filter(Boolean).slice(0, 2).join(" ");
}

function directRetailerFromCustomer(custName: string) {
  const customer = normalizeText(custName);
  if (!customer) return "";
  if (customer.startsWith("KROGER ") || customer.startsWith("KRO ") || customer.includes(" KROGER ") || customer.includes(" KRO ")) return "Kroger";
  if (customer.includes("FRESH THYME") || customer.includes("FRSH THYME") || customer.includes("FRMR MKT")) return "Fresh Thyme";
  if (customer === "HEB" || customer.startsWith("HEB ")) return "HEB";
  return "";
}

function categorizeRetailerName(rawRetailer: string) {
  const retailer = normalizeText(rawRetailer);
  if (!retailer) return "";
  if (retailer.includes("KROGER") || retailer === "KRO") return "Kroger";
  if (retailer.includes("FRESH THYME")) return "Fresh Thyme";
  if (retailer === "HEB" || retailer.includes(" HEB ")) return "HEB";
  return "INFRA & Others";
}

function findRetailer(custName: string, itemName: string, locations: LocationRow[]) {
  const trimmedCustomer = custName.trim();
  const normalizedCustomer = normalizeText(trimmedCustomer);
  const normalizedItem = normalizeText(itemName);

  if (normalizedCustomer === "DC16") {
    if (normalizedItem.startsWith("NSA")) return "Fresh Thyme";
    if (normalizedItem.startsWith("HP")) return "Kroger";
  }

  const directRetailer = directRetailerFromCustomer(custName);
  if (directRetailer) return directRetailer;

  const firstTwoCustomer = getFirstTwoWords(trimmedCustomer);
  if (!firstTwoCustomer) return "";
  if (/^DC\s*\d+$/i.test(trimmedCustomer)) return "";

  const match = locations.find((loc) => getFirstTwoWords(loc.customer) === firstTwoCustomer);
  if (!match) return "";
  return categorizeRetailerName(match.retailer);
}

function isWmInvoiceType(type: string) {
  const t = normalizeText(type);
  return t === "WMINVOICE" || t === "WM INVOICE";
}

export default function BrokerCommissionDataSetsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [selectedType, setSelectedType] = useState("All Types");
  const [selectedRetailer, setSelectedRetailer] = useState("All Retailers");
  const [selectedMonth, setSelectedMonth] = useState("All Months");

  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [retailerFilterOpen, setRetailerFilterOpen] = useState(false);
  const [monthFilterOpen, setMonthFilterOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [missingInvoices, setMissingInvoices] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editRetailerChoice, setEditRetailerChoice] = useState("");
  const [customRetailer, setCustomRetailer] = useState("");

  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkRetailerChoice, setBulkRetailerChoice] = useState("Fresh Thyme");
  const [bulkCustomRetailer, setBulkCustomRetailer] = useState("");

  const notifRef = useRef<HTMLDivElement | null>(null);
  const typeFilterRef = useRef<HTMLDivElement | null>(null);
  const retailerFilterRef = useRef<HTMLDivElement | null>(null);
  const monthFilterRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadData = async () => {
    setLoading(true);

    const [
      { data: datasetData, error: datasetError },
      { data: invoiceData, error: invoiceError },
      { data: uploadData, error: uploadError },
      { data: locationsData, error: locationsError },
      { data: overrideData, error: overrideError },
    ] = await Promise.all([
      supabase.from("broker_commission_datasets").select("id, month, check_date, invoice, type, upc, item, cust_name, amt").order("check_date", { ascending: false, nullsFirst: false }).order("invoice", { ascending: false }),
      supabase.from("invoices").select("invoice_number"),
      supabase.from("uploads").select("invoice"),
      supabase.from("locations").select("customer, retailer"),
      supabase.from("retailer_overrides").select("dataset_id, retailer"),
    ]);

    const locations: LocationRow[] = (locationsData ?? []).map((row: any) => ({
      customer: row.customer ?? "",
      retailer: row.retailer ?? "",
    }));

    const overrideMap = new Map(((overrideData ?? []) as RetailerOverrideRow[]).map((row) => [row.dataset_id, row.retailer]));

    if (datasetError) {
      console.error("Failed to load datasets:", datasetError);
      setRows([]);
    } else {
      setRows((datasetData ?? []).map((row: any) => {
        const inferredRetailer = findRetailer(row.cust_name ?? "", row.item ?? "", locations);
        const overrideRetailer = overrideMap.get(row.id) ?? "";
        const derivedMonth = formatMonthFromDate(row.check_date ?? "") || (row.month ?? "");

        return {
          id: row.id,
          month: derivedMonth,
          checkDate: row.check_date ?? "",
          invoice: normalizeInvoice(row.invoice ?? ""),
          type: row.type ?? "",
          upc: row.upc ?? "",
          item: row.item ?? "",
          custName: row.cust_name ?? "",
          retailer: overrideRetailer || inferredRetailer || "",
          amt: Math.abs(Number(row.amt ?? 0)),
        };
      }));
    }

    if (locationsError) console.error("Failed to load locations:", locationsError);
    if (overrideError) console.error("Failed to load retailer overrides:", overrideError);

    if (invoiceError) {
      console.error("Failed to load invoices:", invoiceError);
      setMissingInvoices([]);
    } else {
      const datasetInvoiceSet = new Set((datasetData ?? []).map((row: any) => normalizeInvoice(row.invoice)).filter(Boolean));
      const uploadedInvoiceSet = new Set((uploadData ?? []).map((row: UploadRow) => normalizeInvoice(row.invoice || "")).filter(Boolean));
      const invoiceList = Array.from(new Set((invoiceData ?? []).map((row: InvoiceRow) => normalizeInvoice(row.invoice_number)).filter(Boolean)));
      const missing = invoiceList.filter((invoice) => uploadedInvoiceSet.has(invoice) && !datasetInvoiceSet.has(invoice));
      setMissingInvoices(missing.sort((a, b) => a.localeCompare(b)));
    }

    if (uploadError) console.error("Failed to load uploads:", uploadError);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (typeFilterRef.current && !typeFilterRef.current.contains(target)) setTypeFilterOpen(false);
      if (retailerFilterRef.current && !retailerFilterRef.current.contains(target)) setRetailerFilterOpen(false);
      if (monthFilterRef.current && !monthFilterRef.current.contains(target)) setMonthFilterOpen(false);

      if (menuRowId) {
        const menuRef = actionMenuRefs.current[menuRowId];
        if (menuRef && !menuRef.contains(target)) setMenuRowId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuRowId]);

  const types = useMemo(() => ["All Types", ...Array.from(new Set(rows.map((r) => r.type).filter(Boolean)))], [rows]);
  const months = useMemo(() => ["All Months", ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean)))], [rows]);

  const retailerOptions = useMemo(() => {
    const options = ["All Retailers"];
    const hasFreshThyme = rows.some((r) => r.retailer === "Fresh Thyme");
    const hasKroger = rows.some((r) => r.retailer === "Kroger");
    const hasInfra = rows.some((r) => r.retailer === "INFRA & Others");
    const hasHeb = rows.some((r) => r.retailer === "HEB");
    const hasBlank = rows.some((r) => !r.retailer);

    if (hasFreshThyme) options.push("Fresh Thyme");
    if (hasKroger) options.push("Kroger");
    if (hasInfra) options.push("INFRA & Others");
    if (hasHeb) options.push("HEB");
    if (hasBlank) options.push("Blank");

    return options;
  }, [rows]);

  useEffect(() => {
    if (!retailerOptions.includes(selectedRetailer)) setSelectedRetailer("All Retailers");
  }, [retailerOptions, selectedRetailer]);

  const data = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesType = selectedType === "All Types" || row.type === selectedType;
      const matchesRetailer = selectedRetailer === "All Retailers" || (selectedRetailer === "Blank" && !row.retailer) || row.retailer === selectedRetailer;
      const matchesMonth = selectedMonth === "All Months" || row.month === selectedMonth;
      const matchesSearch = !keyword ||
        row.type.toLowerCase().includes(keyword) ||
        formatMonthShort(row.month).toLowerCase().includes(keyword) ||
        formatCheckDate(row.checkDate).toLowerCase().includes(keyword) ||
        row.invoice.toLowerCase().includes(keyword) ||
        row.upc.toLowerCase().includes(keyword) ||
        row.item.toLowerCase().includes(keyword) ||
        row.custName.toLowerCase().includes(keyword) ||
        row.retailer.toLowerCase().includes(keyword) ||
        row.amt.toFixed(2).includes(keyword);

      return matchesType && matchesRetailer && matchesMonth && matchesSearch;
    });
  }, [rows, selectedType, selectedRetailer, selectedMonth, search]);

  const visibleRowIds = useMemo(() => data.map((row) => row.id), [data]);
  const allVisibleSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedRowIds.includes(id));
  const someVisibleSelected = visibleRowIds.some((id) => selectedRowIds.includes(id)) && !allVisibleSelected;

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds((prev) => prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]);
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedRowIds((prev) => prev.filter((id) => !visibleRowIds.includes(id)));
      return;
    }
    setSelectedRowIds((prev) => Array.from(new Set([...prev, ...visibleRowIds])));
  };

  const startEditing = (row: Row) => {
    setMenuRowId(null);
    const shouldEditSelected = selectedRowIds.length > 1 && selectedRowIds.includes(row.id);

    if (shouldEditSelected) {
      const selectedRows = rows.filter((r) => selectedRowIds.includes(r.id));
      const firstRetailer = selectedRows[0]?.retailer ?? "";

      if (EDITABLE_RETAILERS.includes(firstRetailer as any)) {
        setBulkRetailerChoice(firstRetailer);
        setBulkCustomRetailer("");
      } else if (firstRetailer) {
        setBulkRetailerChoice("Add new retailer...");
        setBulkCustomRetailer(firstRetailer);
      } else {
        setBulkRetailerChoice("Fresh Thyme");
        setBulkCustomRetailer("");
      }

      setBulkEditOpen(true);
      return;
    }

    setEditingRowId(row.id);
    if (EDITABLE_RETAILERS.includes(row.retailer as any)) {
      setEditRetailerChoice(row.retailer);
      setCustomRetailer("");
    } else if (row.retailer) {
      setEditRetailerChoice("Add new retailer...");
      setCustomRetailer(row.retailer);
    } else {
      setEditRetailerChoice("Fresh Thyme");
      setCustomRetailer("");
    }
  };

  const cancelEditing = () => {
    setEditingRowId(null);
    setEditRetailerChoice("");
    setCustomRetailer("");
  };

  const saveRetailerEdit = async (rowId: string) => {
    const finalRetailer = editRetailerChoice === "Add new retailer..." ? customRetailer.trim() : editRetailerChoice.trim();
    if (!finalRetailer) return;

    setSavingRowId(rowId);
    const { error } = await supabase.from("retailer_overrides").upsert({
      dataset_id: rowId,
      retailer: finalRetailer,
      updated_at: new Date().toISOString(),
    }, { onConflict: "dataset_id" });

    if (error) {
      console.error("Failed to save retailer override:", error);
      setSavingRowId(null);
      return;
    }

    setRows((prev) => prev.map((row) => row.id === rowId ? { ...row, retailer: finalRetailer } : row));
    setSavingRowId(null);
    cancelEditing();
  };

  const openBulkEdit = () => {
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
    setBulkEditOpen(true);
  };

  const cancelBulkEdit = () => {
    setBulkEditOpen(false);
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
  };

  const saveBulkRetailerEdit = async () => {
    const finalRetailer = bulkRetailerChoice === "Add new retailer..." ? bulkCustomRetailer.trim() : bulkRetailerChoice.trim();
    if (!finalRetailer || selectedRowIds.length === 0) return;

    setBulkSaving(true);
    const payload = selectedRowIds.map((rowId) => ({
      dataset_id: rowId,
      retailer: finalRetailer,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from("retailer_overrides").upsert(payload, { onConflict: "dataset_id" });
    if (error) {
      console.error("Failed to save bulk retailer overrides:", error);
      setBulkSaving(false);
      return;
    }

    setRows((prev) => prev.map((row) => selectedRowIds.includes(row.id) ? { ...row, retailer: finalRetailer } : row));
    setBulkSaving(false);
    setBulkEditOpen(false);
    setSelectedRowIds([]);
    setBulkRetailerChoice("Fresh Thyme");
    setBulkCustomRetailer("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Data Sets</h2>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search type, invoice, UPC, item, customer, retailer..."
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-slate-300"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="relative" ref={typeFilterRef}>
            <Button type="button" onClick={() => { setTypeFilterOpen((prev) => !prev); setRetailerFilterOpen(false); setMonthFilterOpen(false); }} variant="outline" className="rounded-2xl">
              <Filter className="mr-2 h-4 w-4" />
              {selectedType}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {typeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {types.map((type) => (
                  <button key={type} type="button" onClick={() => { setSelectedType(type); setTypeFilterOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={retailerFilterRef}>
            <Button type="button" onClick={() => { setRetailerFilterOpen((prev) => !prev); setTypeFilterOpen(false); setMonthFilterOpen(false); }} variant="outline" className="rounded-2xl">
              {selectedRetailer}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {retailerFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {retailerOptions.map((retailer) => (
                  <button key={retailer} type="button" onClick={() => { setSelectedRetailer(retailer); setRetailerFilterOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
                    {retailer}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={monthFilterRef}>
            <Button type="button" onClick={() => { setMonthFilterOpen((prev) => !prev); setTypeFilterOpen(false); setRetailerFilterOpen(false); }} variant="outline" className="rounded-2xl">
              {selectedMonth === "All Months" ? selectedMonth : formatMonthShort(selectedMonth)}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {monthFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {months.map((month) => (
                  <button key={month} type="button" onClick={() => { setSelectedMonth(month); setMonthFilterOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
                    {month === "All Months" ? month : formatMonthShort(month)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={notifRef}>
            <Button type="button" variant="outline" size="icon" className="relative rounded-2xl" onClick={() => setNotifOpen((prev) => !prev)} title="Missing invoices from Data Sets">
              <Bell className="h-4 w-4" />
              {missingInvoices.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                  {missingInvoices.length > 99 ? "99+" : missingInvoices.length}
                </span>
              )}
            </Button>

            {notifOpen && (
              <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Missing in Data Sets</p>
                    <p className="text-xs text-slate-500">In invoices/uploads but not in Data Sets</p>
                  </div>
                  {missingInvoices.length > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">{missingInvoices.length}</span>
                  )}
                </div>

                <div className="max-h-72 overflow-auto">
                  {missingInvoices.length === 0 ? (
                    <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">All invoices are already in Data Sets.</div>
                  ) : (
                    <div className="space-y-1">
                      {missingInvoices.map((invoice) => (
                        <div key={invoice} className="rounded-xl border border-slate-100 px-3 py-2 text-sm text-slate-700">{invoice}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRowIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-slate-700">{selectedRowIds.length} row{selectedRowIds.length > 1 ? "s" : ""} selected</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-2xl" onClick={openBulkEdit}>Edit selected</Button>
            <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setSelectedRowIds([])}>Clear selection</Button>
          </div>
        </div>
      )}

      {bulkEditOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Edit retailer for {selectedRowIds.length} selected row{selectedRowIds.length > 1 ? "s" : ""}</h3>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <select value={bulkRetailerChoice} onChange={(e) => setBulkRetailerChoice(e.target.value)} className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
              {EDITABLE_RETAILERS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>

            {bulkRetailerChoice === "Add new retailer..." && (
              <input type="text" value={bulkCustomRetailer} onChange={(e) => setBulkCustomRetailer(e.target.value)} placeholder="Enter retailer" className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none" />
            )}

            <div className="flex items-center gap-2">
              <Button type="button" className="rounded-2xl" onClick={saveBulkRetailerEdit} disabled={bulkSaving || !(bulkRetailerChoice && (bulkRetailerChoice !== "Add new retailer..." || bulkCustomRetailer.trim()))}>Save selected</Button>
              <Button type="button" variant="outline" className="rounded-2xl" onClick={cancelBulkEdit} disabled={bulkSaving}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-auto rounded-2xl border bg-white" style={{ maxHeight: "70vh" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
            <tr>
              <th className="w-[52px] p-3 text-left">
                <input type="checkbox" checked={allVisibleSelected} ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-slate-300" />
              </th>
              <th className="p-3 text-left font-semibold">Type</th>
              <th className="p-3 text-left font-semibold">Month</th>
              <th className="p-3 text-left font-semibold">Invoice</th>
              <th className="p-3 text-left font-semibold">UPC</th>
              <th className="p-3 text-left font-semibold">Item</th>
              <th className="p-3 text-left font-semibold">Customer</th>
              <th className="p-3 text-left font-semibold">Retailer</th>
              <th className="p-3 text-left font-semibold">Amount</th>
              <th className="w-[56px] p-3 text-left font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-6 text-center text-gray-500">Loading data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="p-6 text-center text-gray-500">No data found.</td></tr>
            ) : (
              data.map((row) => {
                const isEditing = editingRowId === row.id;
                const isSaving = savingRowId === row.id;
                const isSelected = selectedRowIds.includes(row.id);

                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelection(row.id)} className="h-4 w-4 rounded border-slate-300" />
                    </td>
                    <td className="p-3">{row.type}</td>
                    <td className="p-3">{row.checkDate ? formatCheckDate(row.checkDate) : formatMonthShort(row.month)}</td>
                    <td className="p-3 font-medium">{row.invoice}</td>
                    <td className="p-3">{row.upc}</td>
                    <td className="p-3">{row.item}</td>
                    <td className="p-3">{row.custName}</td>
                    <td className="p-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <select value={editRetailerChoice} onChange={(e) => setEditRetailerChoice(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
                            {EDITABLE_RETAILERS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          {editRetailerChoice === "Add new retailer..." && (
                            <input type="text" value={customRetailer} onChange={(e) => setCustomRetailer(e.target.value)} placeholder="Enter retailer" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none" />
                          )}
                        </div>
                      ) : (
                        row.retailer || "-"
                      )}
                    </td>
                    <td className="p-3">${Math.abs(row.amt).toFixed(2)}</td>
                    <td className="p-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={isSaving || !(editRetailerChoice && (editRetailerChoice !== "Add new retailer..." || customRetailer.trim()))} onClick={() => saveRetailerEdit(row.id)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" disabled={isSaving} onClick={cancelEditing} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative" ref={(el) => { actionMenuRefs.current[row.id] = el; }}>
                          <button type="button" onClick={() => setMenuRowId((prev) => prev === row.id ? null : row.id)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuRowId === row.id && (
                            <div className="absolute right-0 z-20 mt-2 w-32 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                              <button type="button" onClick={() => startEditing(row)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">Edit</button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
