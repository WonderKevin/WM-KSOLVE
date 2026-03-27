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

      if (error) {
        console.error("Failed to load broker commission datasets:", error);
        setRows([]);
        setLoading(false);
        return;
      }

      const mapped: Row[] = (data ?? []).map((row: any) => ({
        id: row.id,
        month: row.month ?? "",
        invoice: row.invoice ?? "",
        type: row.type ?? "",
        upc: row.upc ?? "",
        item: row.item ?? "",
        custName: row.cust_name ?? "",
        amt: Number(row.amt ?? 0),
      }));

      setRows(mapped);
      setLoading(false);
    };

    loadData();
  }, []);

  const types = useMemo(() => {
    const uniqueTypes = Array.from(
      new Set(rows.map((row) => row.type).filter(Boolean))
    );
    return ["All Types", ...uniqueTypes];
  }, [rows]);

  const data = useMemo(() => {
    if (selectedType === "All Types") return rows;
    return rows.filter((d) => d.type === selectedType);
  }, [rows, selectedType]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Data Sets</h2>

        <div className="relative">
          <Button type="button" onClick={() => setOpen(!open)} variant="outline">
            <Filter className="mr-2 h-4 w-4" />
            {selectedType}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>

          {open && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border bg-white p-2 shadow">
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setSelectedType(t);
                    setOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left">Month</th>
              <th className="p-3 text-left">Invoice</th>
              <th className="p-3 text-left">UPC</th>
              <th className="p-3 text-left">Item</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3 text-left">Amount</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  Loading data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No data found.
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{row.month}</td>
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