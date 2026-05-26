"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

type Retailer = "all" | "kehe" | "target" | "unfi";

type InvoiceRecord = {
  id: string;
  month: string | null;
  check_date: string | null;
  check_number: string | null;
  check_amt: number | null;
  invoice_number: string | null;
  invoice_amt: number | null;
  dc_name: string | null;
  status: string | null;
  type: string | null;
  retailer: Retailer;
};

type TargetInvoiceRow = {
  id: number;
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
};

type CheckGroup = {
  retailer: Retailer;
  month: string;
  check_date: string;
  check_number: string;
  check_amt: number | null;
  rows: InvoiceRecord[];
};

const retailerOptions: Array<{ value: Retailer; label: string }> = [
  { value: "all", label: "All" },
  { value: "kehe", label: "KeHE" },
  { value: "target", label: "Target" },
  { value: "unfi", label: "UNFI" },
];

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function retailerLabel(value: Retailer) {
  if (value === "kehe") return "KeHE";
  if (value === "target") return "Target";
  if (value === "unfi") return "UNFI";
  return "All";
}

function groupByCheck(rows: InvoiceRecord[]): CheckGroup[] {
  const map = new Map<string, CheckGroup>();

  for (const row of rows) {
    const retailer = row.retailer;
    const month = row.month || "";
    const check_date = row.check_date || "";
    const check_number = row.check_number || "";
    const key = `${retailer}__${month}__${check_date}__${check_number}`;

    if (!map.has(key)) {
      map.set(key, {
        retailer,
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

function getTargetCheckAmounts(rows: TargetInvoiceRow[]) {
  const map = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.check_date || ""}__${row.check_number || ""}`;
    map.set(key, (map.get(key) || 0) + Number(row.net_amount || 0));
  }

  return map;
}

export default function CheckDetailsView() {
  const [rows, setRows] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [retailer, setRetailer] = useState<Retailer>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const [keheRes, targetRes] = await Promise.all([
          supabase
            .from("invoices")
            .select(
              "id, month, check_date, check_number, check_amt, invoice_number, invoice_amt, dc_name, status, type"
            )
            .order("check_date", { ascending: false })
            .order("check_number", { ascending: false }),

          supabase
            .from("target_invoices")
            .select(
              "id, month, check_date, check_number, doc_header_text, reason_code_description, sap_doc_number, doc_date, gross_amount, cash_discount, withholding_tax_amount, net_amount"
            )
            .order("check_date", { ascending: false })
            .order("check_number", { ascending: false }),
        ]);

        if (keheRes.error) throw keheRes.error;
        if (targetRes.error) throw targetRes.error;

        const keheRows: InvoiceRecord[] = ((keheRes.data || []) as any[]).map(
          (row) => ({
            id: `kehe-${row.id}`,
            month: row.month,
            check_date: row.check_date,
            check_number: row.check_number,
            check_amt: row.check_amt,
            invoice_number: row.invoice_number,
            invoice_amt: row.invoice_amt,
            dc_name: row.dc_name,
            status: row.status,
            type: row.type,
            retailer: "kehe",
          })
        );

        const rawTargetRows = (targetRes.data || []) as TargetInvoiceRow[];
        const targetCheckAmounts = getTargetCheckAmounts(rawTargetRows);

        const targetRows: InvoiceRecord[] = rawTargetRows.map((row) => {
          const checkKey = `${row.check_date || ""}__${row.check_number || ""}`;

          return {
            id: `target-${row.id}`,
            month: row.month,
            check_date: row.check_date,
            check_number: row.check_number,
            check_amt: targetCheckAmounts.get(checkKey) || 0,
            invoice_number: row.sap_doc_number || row.doc_header_text,
            invoice_amt: row.net_amount,
            dc_name: row.doc_header_text,
            status: row.doc_date,
            type: row.reason_code_description || "Unknown",
            retailer: "target",
          };
        });

        setRows([...keheRows, ...targetRows]);
      } catch (error) {
        console.error("Check details load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const retailerFilteredRows = useMemo(() => {
    if (retailer === "all") return rows;

    return rows.filter((row) => row.retailer === retailer);
  }, [rows, retailer]);

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) return retailerFilteredRows;

    return retailerFilteredRows.filter((row) => {
      return (
        retailerLabel(row.retailer).toLowerCase().includes(search) ||
        (row.month || "").toLowerCase().includes(search) ||
        (row.check_date || "").toLowerCase().includes(search) ||
        (row.check_number || "").toLowerCase().includes(search) ||
        String(row.check_amt ?? "").toLowerCase().includes(search) ||
        formatCurrency(row.check_amt).toLowerCase().includes(search) ||
        (row.invoice_number || "").toLowerCase().includes(search) ||
        String(row.invoice_amt ?? "").toLowerCase().includes(search) ||
        formatCurrency(row.invoice_amt).toLowerCase().includes(search) ||
        (row.dc_name || "").toLowerCase().includes(search) ||
        (row.status || "").toLowerCase().includes(search) ||
        (row.type || "").toLowerCase().includes(search)
      );
    });
  }, [retailerFilteredRows, searchTerm]);

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
        <Card className="rounded-3xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Retailer
                </label>

                <select
                  value={retailer}
                  onChange={(e) => setRetailer(e.target.value as Retailer)}
                  className="min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {retailerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <Input
                  placeholder="Search retailer, month, check, invoice, DC, type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="rounded-xl border-slate-200 pl-9"
                />
              </div>
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
                const checkKey = `${group.retailer}__${group.month}__${group.check_date}__${group.check_number}`;
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
                      className={`grid w-full grid-cols-[48px_0.8fr_1.2fr_1fr_1fr_1fr] items-center px-4 py-4 text-left transition ${
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
                          Retailer
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {retailerLabel(group.retailer)}
                        </div>
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
                            <div />
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
                                        <div>DC / Reference</div>
                                        <div>Status / Doc Date</div>
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