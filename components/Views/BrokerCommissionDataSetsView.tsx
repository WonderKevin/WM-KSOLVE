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
  invoice: string;
  type: string;
  upc: string;
  item: string;
  custName: string;
  retailer: string;
  amt: number;
};

type InvoiceRow = {
  invoice_number: string;
};

type LocationRow = {
  customer: string;
  retailer: string;
};

type RetailerOverrideRow = {
  dataset_id: string;
  retailer: string;
};

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

function normalizeInvoice(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
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

function normalizeToken(token: string) {
  const map: Record<string, string> = {
    MKT: "MARKET",
    MKTB: "MARKET",
    MRKT: "MARKET",
    CTR: "CENTER",
    CTRS: "CENTER",
    COOP: "COOPERATIVE",
    CO OP: "COOPERATIVE",
    FRMR: "FARMER",
    FRMRS: "FARMERS",
    FT: "FORT",
    ST: "SAINT",
    CS: "",
    DBA: "DBA",
    I: "",
    IN: "IN",
    TX: "TX",
  };

  return map[token] ?? token;
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map(normalizeToken)
    .filter(Boolean);
}

function hasToken(tokens: string[], token: string) {
  return tokens.includes(token);
}

function commonPrefixCount(a: string[], b: string[]) {
  let count = 0;
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) break;
    count += 1;
  }
  return count;
}

function overlapCount(a: string[], b: string[]) {
  const bSet = new Set(b);
  return a.filter((token) => bSet.has(token)).length;
}

function scoreLocationMatch(custName: string, locationCustomer: string) {
  const a = tokenize(custName);
  const b = tokenize(locationCustomer);

  if (!a.length || !b.length) return -1;

  const aJoined = a.join(" ");
  const bJoined = b.join(" ");

  if (aJoined === bJoined) return 5000;

  const prefix = commonPrefixCount(a, b);
  const overlap = overlapCount(a, b);
  const aNums = a.filter((t) => /^\d+$/.test(t));
  const bSet = new Set(b);
  const numericMatches = aNums.filter((n) => bSet.has(n)).length;

  let score = 0;

  score += prefix * 220;
  score += overlap * 35;
  score += numericMatches * 160;

  if (bJoined.includes(aJoined) || aJoined.includes(bJoined)) score += 220;

  const firstTwoA = a.slice(0, 2).join(" ");
  const firstTwoB = b.slice(0, 2).join(" ");
  if (firstTwoA && firstTwoA === firstTwoB) score += 180;

  const firstThreeA = a.slice(0, 3).join(" ");
  const firstThreeB = b.slice(0, 3).join(" ");
  if (firstThreeA && firstThreeA === firstThreeB) score += 260;

  const lastA = a[a.length - 1];
  if (lastA && bSet.has(lastA)) score += 60;

  return score;
}

function categorizeRetailerName(rawRetailer: string) {
  const normalized = normalizeText(rawRetailer);

  if (!normalized) return "";

  if (normalized.includes("KROGER") || normalized === "KRO") return "Kroger";
  if (normalized.includes("FRESH THYME")) return "Fresh Thyme";
  if (normalized === "HEB" || normalized.includes("H E B")) return "HEB";

  return "INFRA & Others";
}

function directRetailerFromCustomer(custName: string) {
  const tokens = tokenize(custName);

  if (!tokens.length) return "";

  if (hasToken(tokens, "KROGER") || hasToken(tokens, "KRO")) return "Kroger";

  if (
    tokens.includes("FRESH") && tokens.includes("THYME")
  ) {
    return "Fresh Thyme";
  }

  if (tokens.includes("HEB") || (tokens.includes("H") && tokens.includes("E") && tokens.includes("B"))) {
    return "HEB";
  }

  return "";
}

function findRetailer(custName: string, locations: LocationRow[]) {
  const directRetailer = directRetailerFromCustomer(custName);
  if (directRetailer) return directRetailer;

  const normalizedCustomer = normalizeText(custName);
  if (!normalizedCustomer) return "";

  if (/^DC\s*\d+$/i.test(custName.trim())) return "";

  let bestRetailer = "";
  let bestScore = -1;

  for (const loc of locations) {
    const score = scoreLocationMatch(custName, loc.customer);
    if (score > bestScore) {
      bestScore = score;
      bestRetailer = loc.retailer || "";
    }
  }

  if (bestScore < 320) return "";

  return categorizeRetailerName(bestRetailer);
}

export default function BrokerCommissionDataSetsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

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
      { data: locationsData, error: locationsError },
      { data: overrideData, error: overrideError },
    ] = await Promise.all([
      supabase
        .from("broker_commission_datasets")
        .select("id, month, invoice, type, upc, item, cust_name, amt")
        .order("invoice", { ascending: false }),
      supabase.from("invoices").select("invoice_number"),
      supabase.from("locations").select("customer, retailer"),
      supabase.from("retailer_overrides").select("dataset_id, retailer"),
    ]);

    const locations: LocationRow[] = (locationsData ?? []).map((row: any) => ({
      customer: row.customer ?? "",
      retailer: row.retailer ?? "",
    }));

    const overrideMap = new Map(
      ((overrideData ?? []) as RetailerOverrideRow[]).map((row) => [
        row.dataset_id,
        row.retailer,
      ])
    );

    if (datasetError) {
      console.error("Failed to load datasets:", datasetError);
      setRows([]);
    } else {
      setRows(
        (datasetData ?? []).map((row: any) => {
          const inferredRetailer = findRetailer(row.cust_name ?? "", locations);
          const overrideRetailer = overrideMap.get(row.id) ?? "";

          return {
            id: row.id,
            month: row.month ?? "",
            invoice: row.invoice ?? "",
            type: row.type ?? "",
            upc: row.upc ?? "",
            item: row.item ?? "",
            custName: row.cust_name ?? "",
            retailer: overrideRetailer || inferredRetailer || "",
            amt: Number(row.amt ?? 0),
          };
        })
      );
    }

    if (locationsError) {
      console.error("Failed to load locations:", locationsError);
    }

    if (overrideError) {
      console.error("Failed to load retailer overrides:", overrideError);
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

      const missing = invoiceList.filter(
        (invoice) => !datasetInvoiceSet.has(invoice)
      );
      setMissingInvoices(missing.sort((a, b) => a.localeCompare(b)));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (typeFilterRef.current && !typeFilterRef.current.contains(target)) {
        setTypeFilterOpen(false);
      }
      if (
        retailerFilterRef.current &&
        !retailerFilterRef.current.contains(target)
      ) {
        setRetailerFilterOpen(false);
      }
      if (monthFilterRef.current && !monthFilterRef.current.contains(target)) {
        setMonthFilterOpen(false);
      }

      if (menuRowId) {
        const menuRef = actionMenuRefs.current[menuRowId];
        if (menuRef && !menuRef.contains(target)) {
          setMenuRowId(null);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuRowId]);

  const types = useMemo(
    () => [
      "All Types",
      ...Array.from(new Set(rows.map((r) => r.type).filter(Boolean))),
    ],
    [rows]
  );

  const months = useMemo(
    () => [
      "All Months",
      ...Array.from(new Set(rows.map((r) => r.month).filter(Boolean))),
    ],
    [rows]
  );

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
    if (!retailerOptions.includes(selectedRetailer)) {
      setSelectedRetailer("All Retailers");
    }
  }, [retailerOptions, selectedRetailer]);

  const data = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesType =
        selectedType === "All Types" || row.type === selectedType;

      const matchesRetailer =
        selectedRetailer === "All Retailers" ||
        (selectedRetailer === "Blank" && !row.retailer) ||
        row.retailer === selectedRetailer;

      const matchesMonth =
        selectedMonth === "All Months" || row.month === selectedMonth;

      const matchesSearch =
        !keyword ||
        row.type.toLowerCase().includes(keyword) ||
        formatMonthShort(row.month).toLowerCase().includes(keyword) ||
        row.invoice.toLowerCase().includes(keyword) ||
        row.upc.toLowerCase().includes(keyword) ||
        row.item.toLowerCase().includes(keyword) ||
        row.custName.toLowerCase().includes(keyword) ||
        row.retailer.toLowerCase().includes(keyword) ||
        row.amt.toFixed(2).includes(keyword);

      return (
        matchesType && matchesRetailer && matchesMonth && matchesSearch
      );
    });
  }, [rows, selectedType, selectedRetailer, selectedMonth, search]);

  const startEditing = (row: Row) => {
    setEditingRowId(row.id);
    setMenuRowId(null);

    if (
      row.retailer === "Fresh Thyme" ||
      row.retailer === "Kroger" ||
      row.retailer === "INFRA & Others" ||
      row.retailer === "HEB"
    ) {
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
    const finalRetailer =
      editRetailerChoice === "Add new retailer..."
        ? customRetailer.trim()
        : editRetailerChoice.trim();

    if (!finalRetailer) return;

    setSavingRowId(rowId);

    const { error } = await supabase
      .from("retailer_overrides")
      .upsert(
        {
          dataset_id: rowId,
          retailer: finalRetailer,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset_id" }
      );

    if (error) {
      console.error("Failed to save retailer override:", error);
      setSavingRowId(null);
      return;
    }

    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, retailer: finalRetailer } : row
      )
    );

    setSavingRowId(null);
    cancelEditing();
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

          <div className="relative" ref={typeFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setTypeFilterOpen((prev) => !prev);
                setRetailerFilterOpen(false);
                setMonthFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              <Filter className="mr-2 h-4 w-4" />
              {selectedType}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>

            {typeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedType(type);
                      setTypeFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={retailerFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setRetailerFilterOpen((prev) => !prev);
                setTypeFilterOpen(false);
                setMonthFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              {selectedRetailer}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>

            {retailerFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {retailerOptions.map((retailer) => (
                  <button
                    key={retailer}
                    type="button"
                    onClick={() => {
                      setSelectedRetailer(retailer);
                      setRetailerFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {retailer}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={monthFilterRef}>
            <Button
              type="button"
              onClick={() => {
                setMonthFilterOpen((prev) => !prev);
                setTypeFilterOpen(false);
                setRetailerFilterOpen(false);
              }}
              variant="outline"
              className="rounded-2xl"
            >
              {selectedMonth === "All Months"
                ? selectedMonth
                : formatMonthShort(selectedMonth)}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>

            {monthFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {months.map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => {
                      setSelectedMonth(month);
                      setMonthFilterOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    {month === "All Months" ? month : formatMonthShort(month)}
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
              <th className="p-3 text-left font-semibold">Retailer</th>
              <th className="p-3 text-left font-semibold">Amount</th>
              <th className="w-[56px] p-3 text-left font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  Loading data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No data found.
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const isEditing = editingRowId === row.id;
                const isSaving = savingRowId === row.id;

                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">{row.type}</td>
                    <td className="p-3">{formatMonthShort(row.month)}</td>
                    <td className="p-3 font-medium">{row.invoice}</td>
                    <td className="p-3">{row.upc}</td>
                    <td className="p-3">{row.item}</td>
                    <td className="p-3">{row.custName}</td>

                    <td className="p-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <select
                            value={editRetailerChoice}
                            onChange={(e) =>
                              setEditRetailerChoice(e.target.value)
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                          >
                            {EDITABLE_RETAILERS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>

                          {editRetailerChoice === "Add new retailer..." && (
                            <input
                              type="text"
                              value={customRetailer}
                              onChange={(e) =>
                                setCustomRetailer(e.target.value)
                              }
                              placeholder="Enter retailer"
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                            />
                          )}
                        </div>
                      ) : (
                        row.retailer || "-"
                      )}
                    </td>

                    <td className="p-3">${row.amt.toFixed(2)}</td>

                    <td className="p-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={
                              isSaving ||
                              !(
                                editRetailerChoice &&
                                (editRetailerChoice !== "Add new retailer..." ||
                                  customRetailer.trim())
                              )
                            }
                            onClick={() => saveRetailerEdit(row.id)}
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={cancelEditing}
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="relative"
                          ref={(el) => {
                            actionMenuRefs.current[row.id] = el;
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setMenuRowId((prev) =>
                                prev === row.id ? null : row.id
                              )
                            }
                            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                            title="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {menuRowId === row.id && (
                            <div className="absolute right-0 z-20 mt-2 w-32 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                              <button
                                type="button"
                                onClick={() => startEditing(row)}
                                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                              >
                                Edit
                              </button>
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