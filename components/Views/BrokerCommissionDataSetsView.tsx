"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Filter } from "lucide-react";
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

// "March '26" format
function formatMonthShort(value: string): string {
  if (!value) return value;
  // Already in "Month 'YY" format
  if (/^[A-Za-z]+ '\d{2}$/.test(value.trim())) return value.trim();
  // Try "Month YYYY" format (old data)
  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) return `${m[1]} '${m[2].slice(-2)}`;
  return value;
}

export default function BrokerCommissionDataSetsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState("All Types");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("broker_commission_datasets")
        .select("id, month, invoice, type, upc, item, cust_name, amt")
        .order("invoice", { ascending: false });
      if (error) { console.error("Failed to load datasets:", error); setRows([]); setLoading(false); return; }
      setRows((data ?? []).map((row: any) => ({
        id: row.id, month: row.month ?? "", invoice: row.invoice ?? "",
        type: row.type ?? "", upc: row.upc ?? "", item: row.item ?? "",
        custName: row.cust_name ?? "", amt: Number(row.amt ?? 0),
      })));
      setLoading(false);
    };
    loadData();
  }, []);

  const types = useMemo(() => ["All Types", ...Array.from(new Set(rows.map(r => r.type).filter(Boolean)))], [rows]);
  const data = useMemo(() => selectedType === "All Types" ? rows : rows.filter(d => d.type === selectedType), [rows, selectedType]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Data Sets</h2>
        <div className="relative">
          <Button type="button" onClick={() => setOpen(!open)} variant="outline">
            <Filter className="mr-2 h-4 w-4"/>{selectedType}<ChevronDown className="ml-2 h-4 w-4"/>
          </Button>
          {open && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border bg-white p-2 shadow">
              {types.map(t => (
                <button key={t} type="button" onClick={() => { setSelectedType(t); setOpen(false); }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100">{t}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="overflow-auto rounded-2xl border bg-white" style={{ maxHeight: "70vh" }}>
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
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">Loading data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">No data found.</td></tr>
            ) : data.map(row => (
              <tr key={row.id} className="border-t">
                <td className="p-3">{row.type}</td>
                <td className="p-3">{formatMonthShort(row.month)}</td>
                <td className="p-3 font-medium">{row.invoice}</td>
                <td className="p-3">{row.upc}</td>
                <td className="p-3">{row.item}</td>
                <td className="p-3">{row.custName}</td>
                <td className="p-3">${row.amt.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}