"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type DatasetRow = {
  id: string;
  month: string;
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

type VelocityRowRaw = Record<string, any>;

type VelocityRow = {
  invoiceNumber: string;
  month: string;
  totalCheckAmount: number;
};

type RetailerName =
  | "Fresh Thyme"
  | "Kroger"
  | "INFRA & Others"
  | "HEB"
  | "";

type DetailLine = {
  label: string;
  amount: number;
  kind: "invoice" | "deduction";
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

  let match = trimmed.match(/^([A-Za-z]+)\s+[' ]?(\d{2}|\d{4})$/);
  if (!match) return -1;

  const monthName = match[1].toLowerCase();
  const yearRaw = match[2];
  const monthIndex = monthMap[monthName];

  if (monthIndex === undefined) return -1;

  const year =
    yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);

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
  locations: LocationRow[]
): RetailerName {
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

  const match = locations.find((loc) => {
    const firstTwoLocation = getFirstTwoWords(loc.customer);
    return firstTwoCustomer === firstTwoLocation;
  });

  if (!match) return "";

  return categorizeRetailerName(match.retailer);
}

function getDeductionBucket(type: string) {
  const t = normalizeText(type);

  if (t.includes("SPOIL")) return "Spoils";
  if (t.includes("PASS THRU")) return "Pass Thru Deduction";
  if (t.includes("PULL OUT")) return "Pull Out";
  if (t.includes("SETUP")) return "Setup Fee";
  if (t.includes("ALLOWANCE")) return "Allowance";

  return type || "Deduction";
}

function isDeductionType(type: string) {
  const t = normalizeText(type);
  return !t.includes("WM INVOICE");
}

function isHebPullout(type: string, retailer: RetailerName) {
  const t = normalizeText(type);
  return retailer === "HEB" && t.includes("PULL OUT");
}

function mapVelocityRow(raw: VelocityRowRaw): VelocityRow | null {
  const invoiceNumber =
    raw.invoice_number ??
    raw.invoice ??
    raw.wm_invoice ??
    raw.wm_invoice_number ??
    raw.invoice_no ??
    raw["Invoice Number"] ??
    raw["Invoice"] ??
    "";

  const month =
    raw.month ??
    raw.invoice_month ??
    raw.statement_month ??
    raw["Month"] ??
    "";

  const totalCheckAmount = Number(
    raw.total_check_amount ??
      raw.check_amount ??
      raw.amount ??
      raw.total ??
      raw["Total Check Amount"] ??
      raw["Check Amount"] ??
      0
  );

  if (!invoiceNumber) return null;

  return {
    invoiceNumber: normalizeInvoice(invoiceNumber),
    month: month ?? "",
    totalCheckAmount,
  };
}

function mergeDetailLines(lines: DetailLine[]) {
  const map = new Map<string, DetailLine>();

  for (const line of lines) {
    const key = `${line.kind}__${line.label}`;
    const existing = map.get(key);

    if (existing) {
      existing.amount += line.amount;
    } else {
      map.set(key, { ...line });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export default function BrokerCommissionSummaryView() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [velocityRows, setVelocityRows] = useState<VelocityRow[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );
  const [selectedMonth, setSelectedMonth] = useState("All Months");

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const [
        { data: datasetData, error: datasetError },
        { data: overrideData, error: overrideError },
        { data: locationData, error: locationError },
        { data: velocityData, error: velocityError },
      ] = await Promise.all([
        supabase
          .from("broker_commission_datasets")
          .select("id, month, invoice, type, upc, item, cust_name, amt"),
        supabase.from("retailer_overrides").select("dataset_id, retailer"),
        supabase.from("locations").select("customer, retailer"),
        supabase.from("kehe_velocity").select("*"),
      ]);

      if (datasetError) console.error("Failed to load datasets:", datasetError);
      if (overrideError) console.error("Failed to load overrides:", overrideError);
      if (locationError) console.error("Failed to load locations:", locationError);
      if (velocityError) console.error("Failed to load kehe_velocity:", velocityError);

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
        const inferred = inferRetailer(r.cust_name ?? "", r.item ?? "", locations);
        const override = overrides.get(r.id) ?? "";

        return {
          id: r.id,
          month: r.month ?? "",
          invoice: r.invoice ?? "",
          type: r.type ?? "",
          upc: r.upc ?? "",
          item: r.item ?? "",
          cust_name: r.cust_name ?? "",
          amt: Number(r.amt ?? 0),
          retailer: (override || inferred || "") as RetailerName,
        };
      });

      const normalizedVelocity = (velocityData ?? [])
        .map(mapVelocityRow)
        .filter(Boolean) as VelocityRow[];

      setRows(hydratedRows);
      setVelocityRows(normalizedVelocity);

      const months = Array.from(
        new Set(hydratedRows.map((r) => r.month).filter(Boolean))
      ).sort((a, b) => parseMonthOrder(b) - parseMonthOrder(a));

      setExpandedMonths(Object.fromEntries(months.map((m) => [m, true])));
      setLoading(false);
    };

    load();
  }, []);

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

    const velocityByInvoice = new Map<string, VelocityRow[]>();
    for (const row of velocityRows) {
      const key = normalizeInvoice(row.invoiceNumber);
      const existing = velocityByInvoice.get(key) ?? [];
      existing.push(row);
      velocityByInvoice.set(key, existing);
    }

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

    const wmInvoiceRetailersByMonth = new Map<
      string,
      Map<string, Set<RetailerName>>
    >();

    for (const row of datasetRows) {
      const retailer = (row.retailer ?? "") as RetailerName;
      if (!retailer) continue;

      const monthKey = row.month;
      const invoiceKey = normalizeInvoice(row.invoice);

      if (!wmInvoiceRetailersByMonth.has(monthKey)) {
        wmInvoiceRetailersByMonth.set(monthKey, new Map());
      }

      const invoiceMap = wmInvoiceRetailersByMonth.get(monthKey)!;
      if (!invoiceMap.has(invoiceKey)) {
        invoiceMap.set(invoiceKey, new Set());
      }

      invoiceMap.get(invoiceKey)!.add(retailer);
    }

    for (const [month, invoiceMap] of wmInvoiceRetailersByMonth.entries()) {
      const monthSummary = ensureMonth(month);

      for (const [invoiceKey, retailers] of invoiceMap.entries()) {
        const velocityMatches = velocityByInvoice.get(invoiceKey) ?? [];
        const totalCheckAmount = velocityMatches.reduce(
          (sum, v) => sum + v.totalCheckAmount,
          0
        );

        if (!totalCheckAmount) continue;

        retailers.forEach((retailer) => {
          const block = ensureRetailerBlock(monthSummary, retailer);
          block.wmInvoiceTotal += totalCheckAmount;
          block.details.push({
            label: `WM Invoice ${invoiceKey}`,
            amount: totalCheckAmount,
            kind: "invoice",
          });
        });
      }
    }

    const krogerFirstInvoiceByMonth = new Map<string, string | null>();

    for (const [month, invoiceMap] of wmInvoiceRetailersByMonth.entries()) {
      const krogerInvoices = Array.from(invoiceMap.entries())
        .filter(([, retailers]) => retailers.has("Kroger"))
        .map(([invoice]) => invoice)
        .sort();

      krogerFirstInvoiceByMonth.set(month, krogerInvoices[0] ?? null);
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
      if (!isDeductionType(row.type)) continue;

      const monthSummary = ensureMonth(row.month);

      let targetRetailer: RetailerName = retailer;
      let targetLabel = getDeductionBucket(row.type);

      if (retailer === "INFRA & Others") {
        targetRetailer = "Kroger";
        const firstKrogerInvoice = krogerFirstInvoiceByMonth.get(row.month);
        if (firstKrogerInvoice) {
          targetLabel = `${targetLabel} (allocated to WM Invoice ${firstKrogerInvoice})`;
        }
      }

      if (isHebPullout(row.type, retailer)) {
        const hasDc19 = dc19ByMonth.get(row.month) ?? false;
        if (!hasDc19) {
          const firstInvoice = Array.from(
            wmInvoiceRetailersByMonth.get(row.month)?.keys() ?? []
          ).sort()[0];

          if (firstInvoice) {
            targetLabel = `${targetLabel} (allocated to WM Invoice ${firstInvoice})`;
          }
        } else {
          targetLabel = `${targetLabel} (DC19)`;
        }
      }

      const block = ensureRetailerBlock(monthSummary, targetRetailer);
      block.deductionsTotal += row.amt;
      block.details.push({
        label: targetLabel,
        amount: -Math.abs(row.amt),
        kind: "deduction",
      });
    }

    for (const monthSummary of monthMap.values()) {
      for (const block of monthSummary.retailers) {
        block.details = mergeDetailLines(block.details);
        block.total = block.wmInvoiceTotal - block.deductionsTotal;
        block.brokerFee = block.retailer === "Kroger" ? block.total * 0.04 : 0;
      }

      monthSummary.retailers.sort((a, b) =>
        a.retailer.localeCompare(b.retailer)
      );

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
  }, [rows, velocityRows, selectedMonth]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Broker Commission Summary
          </h2>
          <p className="text-sm text-slate-500">
            WM Invoice totals, deductions, net, and broker fee.
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
                      {formatMoney(-monthSummary.grandDeductionsTotal)}
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
                            {formatMoney(-block.deductionsTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Net Total</div>
                          <div className="font-semibold text-slate-900">
                            {formatMoney(block.total)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">
                            4% Broker Fee
                          </div>
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
                            {block.details.map((detail, idx) => (
                              <tr key={`${detail.label}-${idx}`} className="border-t">
                                <td className="px-4 py-3">{detail.label}</td>
                                <td
                                  className={`px-4 py-3 text-right font-medium ${
                                    detail.kind === "deduction"
                                      ? "text-red-600"
                                      : "text-slate-900"
                                  }`}
                                >
                                  {formatMoney(detail.amount)}
                                </td>
                              </tr>
                            ))}
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