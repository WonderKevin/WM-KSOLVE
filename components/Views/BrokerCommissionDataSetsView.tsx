"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Filter } from "lucide-react";

type DataSetRow = {
  id: string;
  month: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  custName: string;
  amt: number;
};

const mockRows: DataSetRow[] = [
  {
    id: "1",
    month: "January 2026",
    invoice: "CS003588375",
    type: "Customer Spoils Allowance",
    upc: "850067781080",
    item: "CHEESECAKE CLASSIC PLAIN",
    custName: "KRO COL 388, LONDON",
    amt: 0.77,
  },
  {
    id: "2",
    month: "January 2026",
    invoice: "CS003588375",
    type: "Customer Spoils Allowance",
    upc: "850067781066",
    item: "CHEESECAKE KEY LIME PIE",
    custName: "KRO COL 511, TOLEDO",
    amt: 0.77,
  },
];

const allTypes = [
  "All Types",
  "Customer Spoils Allowance",
];

export default function BrokerCommissionDataSetsView() {
  const [selectedType, setSelectedType] = useState("All Types");
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const filteredRows = useMemo(() => {
    if (selectedType === "All Types") return mockRows;
    return mockRows.filter((row) => row.type === selectedType);
  }, [selectedType]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Broker Commission Data Sets</h2>
            <p className="mt-1 text-sm text-slate-500">
              Extracted rows from invoice PDFs
            </p>
          </div>

          <div className="relative">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl border-slate-200"
              onClick={() => setShowTypeMenu((prev) => !prev)}
            >
              <Filter className="mr-2 h-4 w-4" />
              {selectedType}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>

            {showTypeMenu && (
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                {allTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedType(type);
                      setShowTypeMenu(false);
                    }}
                    className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      selectedType === type
                        ? "bg-slate-100 font-medium text-slate-900"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-3 font-semibold">Month</th>
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">UPC</th>
                <th className="px-4 py-3 font-semibold">ITEM</th>
                <th className="px-4 py-3 font-semibold">Cust Name</th>
                <th className="px-4 py-3 font-semibold">Amt</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-700">{row.month}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.invoice}</td>
                  <td className="px-4 py-3 text-slate-700">{row.upc}</td>
                  <td className="px-4 py-3 text-slate-700">{row.item}</td>
                  <td className="px-4 py-3 text-slate-700">{row.custName}</td>
                  <td className="px-4 py-3 text-slate-900">
                    ${row.amt.toFixed(2)}
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No data found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}