"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

type Row = {
  id: string;
  month: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  custName: string;
  amt: number;
};

type InvoiceRow = {
  invoice_number: string;
};

// "March '26" format
function formatMonthShort(value: string): string {
  if (!value) return value;
  if (/^[A-Za-z]+ '\d{2}$/.test(value.trim())) return value.trim();
  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) return `${m[1]} '${m[2].slice(-2)}`;
  return value;
}

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

export default function BrokerCommissionDataSetsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedType, setSelectedType] = useState("All Types");
  const [filterOpen, setFilterOpen] = useState(false);

  const [search, setSearch] = useState("");

  const [missingInvoices, setMissingInvoices] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      const [
        { data: datasetData, error: datasetError },
        { data: invoiceData, error: invoiceError },
      ] = await Promise.all([
        supabase
          .from("broker_commission_datasets")
          .select("id, month, invoice, type, upc, item, cust_name, amt")
          .order("invoice", { ascending: false }),
        supabase.from("invoices").select("invoice_number"),
      ]);

      if (datasetError) {
        console.error("Failed to load datasets:", datasetError);
        setRows([]);
      } else {
        setRows(
          (datasetData ?? []).map((row: any) => ({
            id: row.id,
            month: row.month ?? "",
            invoice: row.invoice ?? "",
            type: row.type ?? "",
            upc: row.upc ?? "",
            item: row.item ?? "",
            custName: row.cust_name ?? "",
            amt: Number(row.amt ?? 0),
          }))
        );
      }

      if (invoiceError) {
        console.error("Failed to load invoices:", invoiceError);
        setMissingInvoices([]);
      } else {
        const datasetInvoiceSet = new Set(
          (datasetData ?? [])
            .map((row: any) => normalizeInvoice(row.invoice))
            .filter(Boolean)
        );

        const invoiceList = Array.from(
          new Set(
            (invoiceData ?? [])
              .map((row: InvoiceRow) => normalizeInvoice(row.invoice_number))
              .filter(Boolean)
          )
        );

        const missing = invoiceList.filter((invoice) => !datasetInvoiceSet.has(invoice));
        setMissingInvoices(missing.sort((a, b) => a.localeCompare(b)));
      }

      setLoading(false);
    };

    loadData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }

      if (filterRef.current && !filterRef.current.contains(target)) {
        setFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const types = useMemo(
    () => ["All Types", ...Array.from(new Set(rows.map((r) => r.type).filter(Boolean)))],
    [rows]
  );

  const data = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesType =
        selectedType === "All Types" || row.type === selectedType;

      const matchesSearch =
        !keyword ||
        row.type.toLowerCase().includes(keyword) ||
        formatMonthShort(row.month).toLowerCase().includes(keyword) ||
        row.invoice.toLowerCase().includes(keyword) ||
        row.upc.toLowerCase().includes(keyword) ||
        row.item.toLowerCase().includes(keyword) ||
        row.custName.toLowerCase().includes(keyword) ||
        row.amt.toFixed(2).includes(keyword);

      return matchesType && matchesSearch;
    });
  }, [rows, selectedType, search]);

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
              placeholder="Search type, invoice, UPC, item, customer..."
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-slate-300"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="relative" ref={filterRef}>
            <Button
              type="button"
              onClick={() => setFilterOpen((prev) => !prev)}
              variant="outline"
              className="rounded-2xl"
            >
              <Filter className="mr-2 h-4 w-4" />
              {selectedType}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>

            {filterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setSelectedType(t);
                      setFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={notifRef}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative rounded-2xl"
              onClick={() => setNotifOpen((prev) => !prev)}
              title="Missing invoices from Data Sets"
            >
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
                    <p className="text-sm font-semibold text-slate-900">
                      Missing in Data Sets
                    </p>
                    <p className="text-xs text-slate-500">
                      In Ksolve Invoices but not in Data Sets
                    </p>
                  </div>
                  {missingInvoices.length > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                      {missingInvoices.length}
                    </span>
                  )}
                </div>

                <div className="max-h-72 overflow-auto">
                  {missingInvoices.length === 0 ? (
                    <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      All Ksolve invoices are already in Data Sets.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {missingInvoices.map((invoice) => (
                        <div
                          key={invoice}
                          className="rounded-xl border border-slate-100 px-3 py-2 text-sm text-slate-700"
                        >
                          {invoice}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="overflow-auto rounded-2xl border bg-white"
        style={{ maxHeight: "70vh" }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
            <tr>
              <th className="p-3 text-left font-semibold">Type</th>
              <th className="p-3 text-left font-semibold">Month</th>
              <th className="p-3 text-left font-semibold">Invoice</th>
              <th className="p-3 text-left font-semibold">UPC</th>
              <th className="p-3 text-left font-semibold">Item</th>
              <th className="p-3 text-left font-semibold">Customer</th>
              <th className="p-3 text-left font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-500">
                  Loading data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-500">
                  No data found.
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{row.type}</td>
                  <td className="p-3">{formatMonthShort(row.month)}</td>
                  <td className="p-3 font-medium">{row.invoice}</td>
                  <td className="p-3">{row.upc}</td>
                  <td className="p-3">{row.item}</td>
                  <td className="p-3">{row.custName}</td>
                  <td className="p-3">${row.amt.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}