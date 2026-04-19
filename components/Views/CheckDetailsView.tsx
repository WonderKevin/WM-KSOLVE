"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type InvoiceRecord = {
  id: number;
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  check_amt: number | null;
  invoice_number: string | null;
  invoice_amt: number | null;
  dc_name: string | null;
  status: string | null;
  type: string | null;
};

type CheckGroup = {
  month: string;
  check_date: string;
  check_number: string;
  check_amt: number | null;
  rows: InvoiceRecord[];
};

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function groupByCheck(rows: InvoiceRecord[]): CheckGroup[] {
  const map = new Map<string, CheckGroup>();

  for (const row of rows) {
    const month = row.month || "";
    const check_date = row.check_date || "";
    const check_number = row.check_number || "";
    const key = `${month}__${check_date}__${check_number}`;

    if (!map.has(key)) {
      map.set(key, {
        month,
        check_date,
        check_number,
        check_amt: row.check_amt ?? null,
        rows: [],
      });
    }

    map.get(key)!.rows.push(row);
  }

  return Array.from(map.values());
}

export default function CheckDetailsView() {
  const [rows, setRows] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from("invoices")
          .select(
            "id, month, check_date, check_number, check_amt, invoice_number, invoice_amt, dc_name, status, type"
          )
          .order("check_date", { ascending: false })
          .order("check_number", { ascending: false });

        if (error) throw error;
        setRows(data || []);
      } catch (error) {
        console.error("Check details load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return rows;

    return rows.filter((row) => {
      return (
        (row.month || "").toLowerCase().includes(search) ||
        (row.check_date || "").toLowerCase().includes(search) ||
        (row.check_number || "").toLowerCase().includes(search) ||
        String(row.check_amt ?? "").toLowerCase().includes(search) ||
        (row.invoice_number || "").toLowerCase().includes(search) ||
        (row.dc_name || "").toLowerCase().includes(search) ||
        (row.status || "").toLowerCase().includes(search) ||
        (row.type || "").toLowerCase().includes(search)
      );
    });
  }, [rows, searchTerm]);

  const checkGroups = useMemo(() => groupByCheck(filteredRows), [filteredRows]);

  const toggleCheck = (key: string) => {
    setOpenChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleType = (key: string) => {
    setOpenTypes((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-[116px] z-20 space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
          <div className="text-xl font-semibold text-slate-900">
            Check Details
          </div>
        </div>

        <Card className="rounded-3xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
          <CardContent className="pt-6">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search month, check, invoice, DC, type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="rounded-xl border-slate-200 pl-9"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-5 pt-6">
          {loading ? (
            <p className="text-sm text-slate-500">Loading check details...</p>
          ) : checkGroups.length === 0 ? (
            <p className="text-sm text-slate-500">No check details found.</p>
          ) : (
            <div className="space-y-4">
              {checkGroups.map((group) => {
                const checkKey = `${group.month}__${group.check_date}__${group.check_number}`;
                const isCheckOpen = !!openChecks[checkKey];

                const typeMap = new Map<string, InvoiceRecord[]>();
                for (const row of group.rows) {
                  const typeName = row.type?.trim() || "Unknown";
                  if (!typeMap.has(typeName)) {
                    typeMap.set(typeName, []);
                  }
                  typeMap.get(typeName)!.push(row);
                }

                const typeEntries = Array.from(typeMap.entries()).map(
                  ([typeName, typeRows]) => ({
                    typeName,
                    totalAmount: typeRows.reduce(
                      (sum, item) => sum + (Number(item.invoice_amt) || 0),
                      0
                    ),
                    rows: typeRows,
                  })
                );

                return (
                  <div
                    key={checkKey}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCheck(checkKey)}
                      className={`grid w-full grid-cols-[48px_1.2fr_1fr_1fr_1fr] items-center px-4 py-4 text-left transition ${
                        isCheckOpen ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        {isCheckOpen ? (
                          <ChevronDown className="h-4 w-4 text-slate-600" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-600" />
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Month
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {group.month}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Check Date
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {group.check_date}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Check #
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {group.check_number}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Check Amt
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {formatCurrency(group.check_amt)}
                        </div>
                      </div>
                    </button>

                    {isCheckOpen && (
                      <div className="border-t border-slate-200 bg-slate-50 p-4">
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                          <div className="grid grid-cols-[48px_1fr_220px] bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
                            <div></div>
                            <div>Type</div>
                            <div>Total Amount</div>
                          </div>

                          {typeEntries.map((entry) => {
                            const typeKey = `${checkKey}__${entry.typeName}`;
                            const isTypeOpen = !!openTypes[typeKey];

                            return (
                              <div
                                key={typeKey}
                                className="border-t border-slate-200 first:border-t-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleType(typeKey)}
                                  className={`grid w-full grid-cols-[48px_1fr_220px] items-center px-4 py-4 text-left transition ${
                                    isTypeOpen
                                      ? "bg-slate-100"
                                      : "bg-white hover:bg-slate-50"
                                  }`}
                                >
                                  <div>
                                    {isTypeOpen ? (
                                      <ChevronDown className="h-4 w-4 text-slate-600" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-slate-600" />
                                    )}
                                  </div>
                                  <div className="font-medium text-slate-900">
                                    {entry.typeName}
                                  </div>
                                  <div className="font-medium text-slate-900">
                                    {formatCurrency(entry.totalAmount)}
                                  </div>
                                </button>

                                {isTypeOpen && (
                                  <div className="border-t border-slate-200 bg-slate-50 p-4">
                                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                      <div className="grid grid-cols-[1.4fr_180px_1.2fr_140px] bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
                                        <div>Invoice #</div>
                                        <div>Invoice Amt</div>
                                        <div>DC Name</div>
                                        <div>Status</div>
                                      </div>

                                      {entry.rows.map((item) => (
                                        <div
                                          key={item.id}
                                          className="grid grid-cols-[1.4fr_180px_1.2fr_140px] border-t border-slate-200 px-4 py-3 text-sm text-slate-700"
                                        >
                                          <div>{item.invoice_number || ""}</div>
                                          <div className="font-medium text-slate-900">
                                            {formatCurrency(item.invoice_amt)}
                                          </div>
                                          <div>{item.dc_name || ""}</div>
                                          <div>{item.status || ""}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}