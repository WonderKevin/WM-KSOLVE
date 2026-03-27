"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Filter } from "lucide-react";

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

const mockData: Row[] = [
  {
    id: "1",
    month: "Jan 2026",
    invoice: "CS003588375",
    type: "Customer Spoils Allowance",
    upc: "850067781080",
    item: "CHEESECAKE CLASSIC PLAIN",
    custName: "KRO COL 388, LONDON",
    amt: 0.77,
  },
  {
    id: "2",
    month: "Jan 2026",
    invoice: "CS003588375",
    type: "Customer Spoils Allowance",
    upc: "850067781066",
    item: "CHEESECAKE KEY LIME PIE",
    custName: "KRO COL 511, TOLEDO",
    amt: 0.77,
  },
];

const types = ["All Types", "Customer Spoils Allowance"];

export default function BrokerCommissionDataSetsView() {
  const [selectedType, setSelectedType] = useState("All Types");
  const [open, setOpen] = useState(false);

  const data = useMemo(() => {
    if (selectedType === "All Types") return mockData;
    return mockData.filter((d) => d.type === selectedType);
  }, [selectedType]);

  return (
    <div className="space-y-6">

      {/* Header + Filter */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Data Sets</h2>

        <div className="relative">
          <Button onClick={() => setOpen(!open)} variant="outline">
            <Filter className="mr-2 h-4 w-4" />
            {selectedType}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>

          {open && (
            <div className="absolute right-0 mt-2 bg-white border rounded-xl shadow p-2 w-56">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setSelectedType(t);
                    setOpen(false);
                  }}
                  className="block w-full text-left px-3 py-2 hover:bg-gray-100 rounded-lg"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border rounded-2xl overflow-hidden">
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
            {data.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">{row.month}</td>
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