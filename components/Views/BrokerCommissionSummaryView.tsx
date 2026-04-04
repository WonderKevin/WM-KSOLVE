"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type RetailerName =
  | "Fresh Thyme"
  | "Kroger"
  | "INFRA & Others"
  | "HEB"
  | "";

type DatasetRow = {
  id: string;
  month: string;
  check_date: string;
  invoice: string;
  type: string;
  upc: string;
  item: string;
  cust_name: string;
  amt: number;
  retailer?: RetailerName;
};

type RetailerOverrideRow = {
  dataset_id: string;
  retailer: string;
};

type LocationRow = {
  customer: string;
  retailer: string;
};

type DetailLine = {
  label: string;
  amount: number;
  kind: "invoice-summary" | "invoice-detail" | "deduction";
  children?: DetailLine[];
};

type RetailerBlock = {
  retailer: RetailerName;
  wmInvoiceTotal: number;
  deductionsTotal: number;
  total: number;
  brokerFee: number;
  details: DetailLine[];
};

type MonthSummary = {
  month: string;
  retailers: RetailerBlock[];
  grandWmInvoiceTotal: number;
  grandDeductionsTotal: number;
  grandNetTotal: number;
  grandBrokerFeeTotal: number;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

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

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function parseMonthOrder(value: string) {
  const monthMap: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return -1;

  const monthName = match[1].toLowerCase();
  const yearRaw = match[2];
  const monthIndex = monthMap[monthName];

  if (monthIndex === undefined) return -1;

  const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);
  return year * 100 + monthIndex;
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

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
}

function getFirstTwoWords(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function directRetailerFromCustomer(custName: string): RetailerName {
  const customer = normalizeText(custName);

  if (!customer) return "";

  if (
    customer.startsWith("KROGER ") ||
    customer.startsWith("KRO ") ||
    customer.includes(" KROGER ") ||
    customer.includes(" KRO ")
  ) {
    return "Kroger";
  }

  if (
    customer.includes("FRESH THYME") ||
    customer.includes("FRSH THYME") ||
    customer.includes("FRMR MKT")
  ) {
    return "Fresh Thyme";
  }

  if (customer === "HEB" || customer.startsWith("HEB ")) {
    return "HEB";
  }

  return "";
}

function categorizeRetailerName(rawRetailer: string): RetailerName {
  const retailer = normalizeText(rawRetailer);

  if (!retailer) return "";
  if (retailer.includes("KROGER") || retailer === "KRO") return "Kroger";
  if (retailer.includes("FRESH THYME")) return "Fresh Thyme";
  if (retailer === "HEB" || retailer.includes(" HEB ")) return "HEB";

  return "INFRA & Others";
}

function inferRetailer(
  custName: string,
  itemName: string,
  upc: string,
  locations: LocationRow[]
): RetailerName {
  const trimmedCustomer = custName.trim();
  const normalizedItem = normalizeText(itemName);
  const normalizedUpc = normalizeText(upc);
  const skuSource = normalizedUpc || normalizedItem;

  if (
    /KEHE DISTRIBUTORS DC/i.test(trimmedCustomer) ||
    /\bDC\s*\d+\b/i.test(trimmedCustomer)
  ) {
    if (skuSource.startsWith("HP")) return "Kroger";
    if (skuSource.startsWith("CK") || skuSource.startsWith("NSA")) {
      return "Fresh Thyme";
    }
  }

  const directRetailer = directRetailerFromCustomer(custName);
  if (directRetailer) return directRetailer;

  const firstTwoCustomer = getFirstTwoWords(trimmedCustomer);
  if (!firstTwoCustomer) return "";
  if (/^DC\s*\d+$/i.test(trimmedCustomer)) return "";

  const match = locations.find((loc) => {
    const firstTwoLocation = getFirstTwoWords(loc.customer);
    return firstTwoCustomer === firstTwoLocation;
  });

  if (!match) return "";

  return categorizeRetailerName(match.retailer);
}

function isWmInvoiceType(type: string) {
  const t = normalizeText(type);
  return t === "WMINVOICE" || t === "WM INVOICE";
}

function getTypeLabel(type: string) {
  return String(type || "").trim() || "Deduction";
}

function isHebPullout(type: string, retailer: RetailerName) {
  const t = normalizeText(type);
  return retailer === "HEB" && t.includes("PULL OUT");
}

function retailerSortValue(retailer: RetailerName) {
  if (retailer === "Kroger") return 0;
  if (retailer === "Fresh Thyme") return 1;
  if (retailer === "INFRA & Others") return 2;
  if (retailer === "HEB") return 3;
  return 9;
}

function mergeByLabel(lines: DetailLine[]) {
  const map = new Map<string, DetailLine>();

  for (const line of lines) {
    const existing = map.get(line.label);
    if (existing) {
      existing.amount += line.amount;
    } else {
      map.set(line.label, { ...line });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export default function BrokerCommissionSummaryView() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("All Months");
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );
  const [expandedInvoiceRows, setExpandedInvoiceRows] = useState<
    Record<string, boolean>
  >({});

  const load = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const [
      { data: datasetData, error: datasetError },
      { data: overrideData, error: overrideError },
      { data: locationData, error: locationError },
    ] = await Promise.all([
      supabase
        .from("broker_commission_datasets")
        .select("id, month, check_date, invoice, type, upc, item, cust_name, amt")
        .order("check_date", { ascending: false, nullsFirst: false })
        .order("invoice", { ascending: false }),
      supabase.from("retailer_overrides").select("dataset_id, retailer"),
      supabase.from("locations").select("customer, retailer"),
    ]);

    if (datasetError) console.error("Failed to load datasets:", datasetError);
    if (overrideError) console.error("Failed to load overrides:", overrideError);
    if (locationError) console.error("Failed to load locations:", locationError);

    const overrides = new Map<string, string>(
      ((overrideData ?? []) as RetailerOverrideRow[]).map((r) => [
        r.dataset_id,
        r.retailer,
      ])
    );

    const locations: LocationRow[] = (locationData ?? []).map((r: any) => ({
      customer: r.customer ?? "",
      retailer: r.retailer ?? "",
    }));

    const hydratedRows: DatasetRow[] = (datasetData ?? []).map((r: any) => {
      const inferred = inferRetailer(
        r.cust_name ?? "",
        r.item ?? "",
        r.upc ?? "",
        locations
      );
      const override = overrides.get(r.id) ?? "";
      const derivedMonth =
        formatMonthFromDate(r.check_date ?? "") || (r.month ?? "");

      return {
        id: r.id,
        month: derivedMonth,
        check_date: r.check_date ?? "",
        invoice: normalizeInvoice(r.invoice ?? ""),
        type: r.type ?? "",
        upc: r.upc ?? "",
        item: r.item ?? "",
        cust_name: r.cust_name ?? "",
        amt: Number(r.amt ?? 0),
        retailer: (override || inferred || "") as RetailerName,
      };
    });

    setRows(hydratedRows);

    const months = Array.from(
      new Set(hydratedRows.map((r) => r.month).filter(Boolean))
    ).sort((a, b) => parseMonthOrder(b) - parseMonthOrder(a));

    setExpandedMonths((prev) => {
      const next = { ...prev };
      months.forEach((m) => {
        if (!(m in next)) next[m] = true;
      });
      return next;
    });

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const monthOptions = useMemo(() => {
    return [
      "All Months",
      ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean))).sort(
        (a, b) => parseMonthOrder(b) - parseMonthOrder(a)
      ),
    ];
  }, [rows]);

  const summary = useMemo(() => {
    const datasetRows =
      selectedMonth === "All Months"
        ? rows
        : rows.filter((r) => r.month === selectedMonth);

    const monthMap = new Map<string, MonthSummary>();

    const ensureMonth = (month: string) => {
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          retailers: [],
          grandWmInvoiceTotal: 0,
          grandDeductionsTotal: 0,
          grandNetTotal: 0,
          grandBrokerFeeTotal: 0,
        });
      }
      return monthMap.get(month)!;
    };

    const ensureRetailerBlock = (
      monthSummary: MonthSummary,
      retailer: RetailerName
    ) => {
      let block = monthSummary.retailers.find((r) => r.retailer === retailer);
      if (!block) {
        block = {
          retailer,
          wmInvoiceTotal: 0,
          deductionsTotal: 0,
          total: 0,
          brokerFee: 0,
          details: [],
        };
        monthSummary.retailers.push(block);
      }
      return block;
    };

    const wmInvoiceTotalsByMonthInvoiceRetailer = new Map<string, number>();
    const wmInvoiceTotalsByMonthInvoice = new Map<string, number>();

    for (const row of datasetRows) {
      const retailer = (row.retailer ?? "") as RetailerName;
      if (!retailer) continue;

      if (isWmInvoiceType(row.type)) {
        const byRetailerKey = `${row.month}__${row.invoice}__${retailer}`;
        wmInvoiceTotalsByMonthInvoiceRetailer.set(
          byRetailerKey,
          (wmInvoiceTotalsByMonthInvoiceRetailer.get(byRetailerKey) ?? 0) +
            Math.abs(row.amt)
        );

        const byInvoiceKey = `${row.month}__${row.invoice}`;
        wmInvoiceTotalsByMonthInvoice.set(
          byInvoiceKey,
          (wmInvoiceTotalsByMonthInvoice.get(byInvoiceKey) ?? 0) +
            Math.abs(row.amt)
        );
      }
    }

    for (const [key, amount] of wmInvoiceTotalsByMonthInvoiceRetailer.entries()) {
      const [month, invoice, retailer] = key.split("__") as [
        string,
        string,
        RetailerName
      ];

      const monthSummary = ensureMonth(month);
      const block = ensureRetailerBlock(monthSummary, retailer);

      block.wmInvoiceTotal += amount;
      block.details.push({
        label: "WM Invoice",
        amount,
        kind: "invoice-summary",
        children: [
          {
            label: `WM Invoice ${invoice}`,
            amount,
            kind: "invoice-detail",
          },
        ],
      });
    }

    const dc19ByMonth = new Map<string, boolean>();
    for (const row of datasetRows) {
      if (normalizeText(row.cust_name) === "DC19") {
        dc19ByMonth.set(row.month, true);
      }
    }

    for (const row of datasetRows) {
      const retailer = (row.retailer ?? "") as RetailerName;
      if (!retailer) continue;
      if (isWmInvoiceType(row.type)) continue;

      const monthSummary = ensureMonth(row.month);
      const block = ensureRetailerBlock(monthSummary, retailer);

      let typeLabel = getTypeLabel(row.type);

      if (isHebPullout(row.type, retailer)) {
        const hasDc19 = dc19ByMonth.get(row.month) ?? false;
        if (!hasDc19) {
          const firstInvoice = Array.from(wmInvoiceTotalsByMonthInvoice.keys())
            .filter((key) => key.startsWith(`${row.month}__`))
            .map((key) => key.split("__")[1])
            .sort()[0];

          if (firstInvoice) {
            typeLabel = `${typeLabel} (allocated to WM Invoice ${firstInvoice})`;
          }
        } else {
          typeLabel = `${typeLabel} (DC19)`;
        }
      }

      const deductionAmount = -Math.abs(row.amt);
      block.deductionsTotal += deductionAmount;
      block.details.push({
        label: typeLabel,
        amount: deductionAmount,
        kind: "deduction",
      });
    }

    for (const monthSummary of monthMap.values()) {
      for (const block of monthSummary.retailers) {
        const invoiceSummaryLines = block.details.filter(
          (d) => d.kind === "invoice-summary"
        );

        const mergedInvoiceSummaries = invoiceSummaryLines.reduce<DetailLine[]>(
          (acc, line) => {
            const existing = acc.find((a) => a.label === line.label);
            if (existing) {
              existing.amount += line.amount;
              existing.children = [
                ...(existing.children ?? []),
                ...(line.children ?? []),
              ];
            } else {
              acc.push({
                ...line,
                children: [...(line.children ?? [])],
              });
            }
            return acc;
          },
          []
        );

        for (const line of mergedInvoiceSummaries) {
          line.children = (line.children ?? []).sort((a, b) =>
            a.label.localeCompare(b.label)
          );
        }

        const deductionLines = mergeByLabel(
          block.details.filter((d) => d.kind === "deduction")
        );

        block.details = [...mergedInvoiceSummaries, ...deductionLines];
        block.total = block.wmInvoiceTotal + block.deductionsTotal;
        block.brokerFee = block.retailer === "Kroger" ? block.total * 0.04 : 0;
      }

      monthSummary.retailers.sort((a, b) => {
        const diff = retailerSortValue(a.retailer) - retailerSortValue(b.retailer);
        if (diff !== 0) return diff;
        return a.retailer.localeCompare(b.retailer);
      });

      monthSummary.grandWmInvoiceTotal = monthSummary.retailers.reduce(
        (sum, r) => sum + r.wmInvoiceTotal,
        0
      );
      monthSummary.grandDeductionsTotal = monthSummary.retailers.reduce(
        (sum, r) => sum + r.deductionsTotal,
        0
      );
      monthSummary.grandNetTotal = monthSummary.retailers.reduce(
        (sum, r) => sum + r.total,
        0
      );
      monthSummary.grandBrokerFeeTotal = monthSummary.retailers.reduce(
        (sum, r) => sum + r.brokerFee,
        0
      );
    }

    return Array.from(monthMap.values()).sort(
      (a, b) => parseMonthOrder(b.month) - parseMonthOrder(a.month)
    );
  }, [rows, selectedMonth]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Broker Commission Summary
          </h2>
          <p className="text-sm text-slate-500">
            Data Sets drives retailer totals. WM Invoice rows are positive and all
            non-WM rows are deductions. Month grouping uses check date.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">Month</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month === "All Months" ? month : formatMonthShort(month)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">
          Loading broker commission summary...
        </div>
      ) : summary.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">
          No broker commission data found.
        </div>
      ) : (
        summary.map((monthSummary) => {
          const isExpanded = expandedMonths[monthSummary.month] ?? true;

          return (
            <div key={monthSummary.month} className="rounded-2xl border bg-white">
              <button
                type="button"
                onClick={() =>
                  setExpandedMonths((prev) => ({
                    ...prev,
                    [monthSummary.month]: !isExpanded,
                  }))
                }
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  )}
                  <div>
                    <div className="text-base font-semibold text-slate-900">
                      {formatMonthShort(monthSummary.month)}
                    </div>
                    <div className="text-sm text-slate-500">
                      {monthSummary.retailers.length} retailer bucket
                      {monthSummary.retailers.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-right md:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">WM Invoice</div>
                    <div className="font-semibold text-slate-900">
                      {formatMoney(monthSummary.grandWmInvoiceTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Deductions</div>
                    <div className="font-semibold text-red-600">
                      {formatMoney(monthSummary.grandDeductionsTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Net</div>
                    <div className="font-semibold text-slate-900">
                      {formatMoney(monthSummary.grandNetTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">4% Fee</div>
                    <div className="font-semibold text-emerald-700">
                      {formatMoney(monthSummary.grandBrokerFeeTotal)}
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t px-5 py-5">
                  {monthSummary.retailers.map((block) => (
                    <div
                      key={`${monthSummary.month}-${block.retailer}`}
                      className="rounded-2xl border border-slate-200"
                    >
                      <div className="grid grid-cols-1 gap-4 border-b px-4 py-4 md:grid-cols-5">
                        <div>
                          <div className="text-xs text-slate-500">Retailer</div>
                          <div className="font-semibold text-slate-900">
                            {block.retailer}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">WM Invoice Total</div>
                          <div className="font-semibold text-slate-900">
                            {formatMoney(block.wmInvoiceTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Deductions</div>
                          <div className="font-semibold text-red-600">
                            {formatMoney(block.deductionsTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Net Total</div>
                          <div className="font-semibold text-slate-900">
                            {formatMoney(block.total)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">4% Broker Fee</div>
                          <div className="font-semibold text-emerald-700">
                            {formatMoney(block.brokerFee)}
                          </div>
                        </div>
                      </div>

                      <div className="overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">
                                Line Item
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                Amount
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {block.details.map((detail, idx) => {
                              if (detail.kind === "invoice-summary") {
                                const key = `${monthSummary.month}-${block.retailer}-wm-${idx}`;
                                const rowExpanded = expandedInvoiceRows[key] ?? false;

                                return (
                                  <React.Fragment key={key}>
                                    <tr className="border-t">
                                      <td className="px-4 py-3">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedInvoiceRows((prev) => ({
                                              ...prev,
                                              [key]: !rowExpanded,
                                            }))
                                          }
                                          className="flex items-center gap-2 font-medium text-slate-900"
                                        >
                                          {rowExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-slate-500" />
                                          ) : (
                                            <ChevronRight className="h-4 w-4 text-slate-500" />
                                          )}
                                          {detail.label}
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                                        {formatMoney(detail.amount)}
                                      </td>
                                    </tr>

                                    {detail.children?.map((child, childIdx) =>
                                      rowExpanded ? (
                                        <tr
                                          key={`${key}-child-${childIdx}`}
                                          className="border-t bg-slate-50/50"
                                        >
                                          <td className="px-4 py-3 pl-10 text-slate-700">
                                            {child.label}
                                          </td>
                                          <td className="px-4 py-3 text-right font-medium text-slate-700">
                                            {formatMoney(child.amount)}
                                          </td>
                                        </tr>
                                      ) : null
                                    )}
                                  </React.Fragment>
                                );
                              }

                              return (
                                <tr key={`${detail.label}-${idx}`} className="border-t">
                                  <td className="px-4 py-3">{detail.label}</td>
                                  <td className="px-4 py-3 text-right font-medium text-red-600">
                                    {formatMoney(detail.amount)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}