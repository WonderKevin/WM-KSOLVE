"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type TonyVelocityRow = {
  id?: string;
  month: string;
  warehouse: string;
  location: string;
  customer: string;
  cheesecakes: string;
  item_pack: string;
  item_size: string;
  vendor_item: string;
  quantity_shipped: number;
  ext_net_ship_weight: number;
  actual_cost_gross: number;
  source_file_name?: string;
};

type TonyLocation = {
  id?: string;
  customer: string;
  location: string;
};

type MissingLocation = {
  customer: string;
  location: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(month: string, year: string) {
  return `${month} '${String(year).slice(-2)}`;
}

function normalize(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function findColumn(headers: string[], candidates: string[]) {
  const normalized = headers.map((h) => normalizeKey(h));
  for (const candidate of candidates) {
    const c = normalizeKey(candidate);
    const exactIndex = normalized.findIndex((h) => h === c);
    if (exactIndex >= 0) return headers[exactIndex];
  }
  for (const candidate of candidates) {
    const c = normalizeKey(candidate);
    const containsIndex = normalized.findIndex((h) => h.includes(c) || c.includes(h));
    if (containsIndex >= 0) return headers[containsIndex];
  }
  return "";
}

function getCell(row: Record<string, unknown>, headers: string[], candidates: string[]) {
  const col = findColumn(headers, candidates);
  return col ? row[col] : "";
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (value: string | number) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function readWorkbookRows(file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function LocationResolutionModal({
  missing,
  suggestions,
  onCancel,
  onSave,
}: {
  missing: MissingLocation[];
  suggestions: TonyLocation[];
  onCancel: () => void;
  onSave: (items: MissingLocation[]) => void;
}) {
  const [items, setItems] = useState<MissingLocation[]>(missing);

  const updateLocation = (customer: string, location: string) => {
    setItems((prev) =>
      prev.map((item) => (item.customer === customer ? { ...item, location } : item))
    );
  };

  const getSuggestions = (value: string) => {
    const q = normalizeKey(value);
    if (!q) return suggestions.slice(0, 8);
    return suggestions
      .filter((s) => normalizeKey(s.location).includes(q) || normalizeKey(s.customer).includes(q))
      .slice(0, 8);
  };

  const canSave = items.every((item) => item.location.trim());

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6">
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-xl font-bold text-slate-900">New locations need mapping</h2>
          <p className="mt-1 text-sm text-slate-500">
            These customers are not in Tony&apos;s Location database yet. Type a location or choose a suggestion, then save.
          </p>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-6">
          <div className="space-y-4">
            {items.map((item) => {
              const options = getSuggestions(item.location || item.customer);
              return (
                <div key={item.customer} className="rounded-2xl border border-slate-200 p-4">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Customer
                      </label>
                      <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                        {item.customer}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Location
                      </label>
                      <input
                        value={item.location}
                        onChange={(e) => updateLocation(item.customer, e.target.value)}
                        placeholder="Type location..."
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>

                  {options.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {options.map((option) => (
                        <button
                          key={`${item.customer}-${option.customer}-${option.location}`}
                          type="button"
                          onClick={() => updateLocation(item.customer, option.location)}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        >
                          {option.location}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(items)}
            disabled={!canSave}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save locations & continue upload
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TonyVelocityView() {
  const velocityInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<TonyVelocityRow[]>([]);
  const [locations, setLocations] = useState<TonyLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingVelocity, setUploadingVelocity] = useState(false);
  const [uploadingLocations, setUploadingLocations] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [searchQuery, setSearchQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("All Months");

  const [pendingRows, setPendingRows] = useState<TonyVelocityRow[]>([]);
  const [pendingSourceName, setPendingSourceName] = useState("");
  const [missingLocations, setMissingLocations] = useState<MissingLocation[]>([]);
  const [showVelocityUploadOptions, setShowVelocityUploadOptions] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [manualCustomer, setManualCustomer] = useState("");
  const [manualLocation, setManualLocation] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [{ data: velocityData, error: velocityError }, { data: locationData, error: locationError }] =
        await Promise.all([
          supabase.from("tony_velocity").select("*").order("month", { ascending: false }),
          supabase.from("tony_locations").select("*").order("customer", { ascending: true }),
        ]);

      if (velocityError) throw velocityError;
      if (locationError) throw locationError;

      setRows((velocityData ?? []) as TonyVelocityRow[]);
      setLocations((locationData ?? []) as TonyLocation[]);
    } catch (err: any) {
      setError(err?.message || "Failed to load Tony velocity data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations) {
      map.set(normalizeKey(loc.customer), normalize(loc.location));
    }
    return map;
  }, [locations]);

  const parseVelocityRows = async (file: File) => {
    const rawRows = await readWorkbookRows(file);
    if (!rawRows.length) return [];

    const headers = Object.keys(rawRows[0]);
    const month = monthLabel(selectedMonth, selectedYear);

    return rawRows
      .map((row) => {
        const customer = normalize(getCell(row, headers, ["sh Long Description", "Customer", "Ship to Customer"]));
        const location = locationMap.get(normalizeKey(customer)) || "";
        return {
          month,
          warehouse: normalize(getCell(row, headers, ["Warehouse"])),
          location,
          customer,
          cheesecakes: normalize(getCell(row, headers, ["Cheesecakes"])),
          item_pack: normalize(getCell(row, headers, ["Item Pack"])),
          item_size: normalize(getCell(row, headers, ["Item Size"])),
          vendor_item: normalize(getCell(row, headers, ["Vendor Item"])),
          quantity_shipped: toNumber(getCell(row, headers, ["Quantity shipped", "Quantity shipped Mar 26 to Mar 26"])),
          ext_net_ship_weight: toNumber(getCell(row, headers, ["Ext Net Ship Weight", "Ext Net Ship Weight Mar 26 to Mar 26"])),
          actual_cost_gross: toNumber(getCell(row, headers, ["Actual Cost Gross", "Actual Cost Gross Mar 26 to Mar 26"])),
          source_file_name: file.name,
        };
      })
      .filter((row) => row.customer || row.warehouse || row.vendor_item);
  };

  const uploadVelocityRows = async (uploadRows: TonyVelocityRow[]) => {
    if (!uploadRows.length) {
      setNotice("No rows found in the uploaded file.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("tony_velocity")
      .delete()
      .eq("month", monthLabel(selectedMonth, selectedYear));

    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase.from("tony_velocity").insert(uploadRows);
    if (insertError) throw insertError;

    setNotice(`Uploaded ${uploadRows.length.toLocaleString()} Tony velocity rows.`);
    setShowVelocityUploadOptions(false);
    await loadData();
  };

  const handleVelocityFile = async (file?: File) => {
    if (!file) return;
    setUploadingVelocity(true);
    setError("");
    setNotice("");
    try {
      const parsed = await parseVelocityRows(file);
      const missingMap = new Map<string, MissingLocation>();

      for (const row of parsed) {
        if (row.customer && !row.location) {
          missingMap.set(row.customer, { customer: row.customer, location: "" });
        }
      }

      if (missingMap.size > 0) {
        setPendingRows(parsed);
        setPendingSourceName(file.name);
        setMissingLocations(Array.from(missingMap.values()));
        return;
      }

      await uploadVelocityRows(parsed);
    } catch (err: any) {
      setError(err?.message || "Failed to upload Tony velocity file.");
    } finally {
      setUploadingVelocity(false);
      if (velocityInputRef.current) velocityInputRef.current.value = "";
    }
  };

  const handleLocationFile = async (file?: File) => {
    if (!file) return;
    setUploadingLocations(true);
    setError("");
    setNotice("");
    try {
      const rawRows = await readWorkbookRows(file);
      if (!rawRows.length) {
        setNotice("No location rows found.");
        return;
      }

      const headers = Object.keys(rawRows[0]);
      const parsed = rawRows
        .map((row) => ({
          customer: normalize(getCell(row, headers, ["Customer", "Ship to Customer", "sh Long Description"])),
          location: normalize(getCell(row, headers, ["Location", "Mapped Location"])),
        }))
        .filter((row) => row.customer && row.location);

      if (!parsed.length) {
        setNotice("No Customer + Location mappings found in the uploaded file.");
        return;
      }

      const { error: upsertError } = await supabase
        .from("tony_locations")
        .upsert(parsed, { onConflict: "customer" });

      if (upsertError) throw upsertError;

      setNotice(`Uploaded ${parsed.length.toLocaleString()} location mappings.`);
      setShowLocationModal(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to upload Tony location file.");
    } finally {
      setUploadingLocations(false);
      if (locationInputRef.current) locationInputRef.current.value = "";
    }
  };

  const saveMissingLocations = async (items: MissingLocation[]) => {
    setUploadingVelocity(true);
    setError("");
    setNotice("");
    try {
      const mappings = items.map((item) => ({
        customer: normalize(item.customer),
        location: normalize(item.location),
      }));

      const { error: upsertError } = await supabase
        .from("tony_locations")
        .upsert(mappings, { onConflict: "customer" });

      if (upsertError) throw upsertError;

      const newMap = new Map(locationMap);
      for (const item of mappings) {
        newMap.set(normalizeKey(item.customer), item.location);
      }

      const resolvedRows = pendingRows.map((row) => ({
        ...row,
        location: row.location || newMap.get(normalizeKey(row.customer)) || "",
        source_file_name: pendingSourceName || row.source_file_name,
      }));

      setMissingLocations([]);
      setPendingRows([]);
      setPendingSourceName("");

      await uploadVelocityRows(resolvedRows);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to save location mappings.");
    } finally {
      setUploadingVelocity(false);
    }
  };


  const saveManualLocation = async () => {
    const customer = normalize(manualCustomer);
    const location = normalize(manualLocation);
    if (!customer || !location) {
      setError("Please enter both Customer and Location.");
      return;
    }

    setUploadingLocations(true);
    setError("");
    setNotice("");
    try {
      const { error: upsertError } = await supabase
        .from("tony_locations")
        .upsert([{ customer, location }], { onConflict: "customer" });

      if (upsertError) throw upsertError;

      setManualCustomer("");
      setManualLocation("");
      setNotice("Location mapping saved.");
      setShowLocationModal(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to save location mapping.");
    } finally {
      setUploadingLocations(false);
    }
  };

  const monthOptions = useMemo(
    () => ["All Months", ...Array.from(new Set(rows.map((row) => row.month).filter(Boolean))).sort((a, b) => b.localeCompare(a))],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const monthMatch = monthFilter === "All Months" || row.month === monthFilter;
      const searchMatch =
        !q ||
        row.month.toLowerCase().includes(q) ||
        row.warehouse.toLowerCase().includes(q) ||
        row.location.toLowerCase().includes(q) ||
        row.customer.toLowerCase().includes(q) ||
        row.cheesecakes.toLowerCase().includes(q) ||
        row.vendor_item.toLowerCase().includes(q);

      return monthMatch && searchMatch;
    });
  }, [rows, searchQuery, monthFilter]);

  const exportRows = () => {
    downloadCsv(
      "tony-velocity-export",
      [
        "Month",
        "Warehouse",
        "Location",
        "Customer",
        "Cheesecakes",
        "Item Pack",
        "Item Size",
        "Vendor Item",
        "Quantity shipped",
        "Ext Net Ship Weight",
        "Actual Cost Gross",
      ],
      filteredRows.map((row) => [
        row.month,
        row.warehouse,
        row.location,
        row.customer,
        row.cheesecakes,
        row.item_pack,
        row.item_size,
        row.vendor_item,
        row.quantity_shipped,
        row.ext_net_ship_weight,
        row.actual_cost_gross,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Tony&apos;s Velocity</h2>
            <p className="mt-1 text-sm text-slate-500">
              Upload Tony&apos;s velocity files, map customers to locations, and export filtered results.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Search</label>
              <div className="relative min-w-[260px]">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search month, warehouse, customer..."
                  className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Month Filter</label>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="h-10 min-w-[160px] rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
              >
                {monthOptions.map((month) => (
                  <option key={month}>{month}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={exportRows}
              disabled={!filteredRows.length}
              title="Export to Excel"
              aria-label="Export to Excel"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileSpreadsheet className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowLocationModal(true)}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              disabled={uploadingLocations}
            >
              <Upload className="h-4 w-4" />
              {uploadingLocations ? "Uploading..." : "Upload Location"}
            </button>

            <button
              type="button"
              onClick={() => setShowVelocityUploadOptions((open) => !open)}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={uploadingVelocity}
            >
              <Upload className="h-4 w-4" />
              {uploadingVelocity ? "Uploading..." : "Upload Velocity File"}
            </button>

            <input
              ref={locationInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => handleLocationFile(e.target.files?.[0])}
            />
            <input
              ref={velocityInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => handleVelocityFile(e.target.files?.[0])}
            />
          </div>
        </div>

        {showVelocityUploadOptions && (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_160px_180px]">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Upload Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                >
                  {MONTHS.map((month) => (
                    <option key={month}>{month}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                <input
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => velocityInputRef.current?.click()}
                  disabled={uploadingVelocity}
                  className="h-11 w-full rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Choose File for {monthLabel(selectedMonth, selectedYear)}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Tony&apos;s Velocity Rows</h3>
            <p className="text-sm text-slate-500">
              {loading ? "Loading..." : `${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} rows shown`}
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-[1500px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <tr>
                  {[
                    "Month",
                    "Warehouse",
                    "Location",
                    "Customer",
                    "Cheesecakes",
                    "Item Pack",
                    "Item Size",
                    "Vendor Item",
                    "Quantity shipped",
                    "Ext Net Ship Weight",
                    "Actual Cost Gross",
                  ].map((header) => (
                    <th key={header} className="px-4 py-3 text-left font-semibold text-slate-700">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                      No Tony velocity rows found.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, i) => (
                    <tr key={row.id ?? `${row.month}-${row.customer}-${i}`} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.month}</td>
                      <td className="px-4 py-3 text-slate-700">{row.warehouse}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.location}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customer}</td>
                      <td className="px-4 py-3 text-slate-700">{row.cheesecakes}</td>
                      <td className="px-4 py-3 text-slate-700">{row.item_pack}</td>
                      <td className="px-4 py-3 text-slate-700">{row.item_size}</td>
                      <td className="px-4 py-3 text-slate-700">{row.vendor_item}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.quantity_shipped.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.ext_net_ship_weight.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.actual_cost_gross.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>


      {showLocationModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-xl font-bold text-slate-900">Upload or Add Tony Location</h2>
              <p className="mt-1 text-sm text-slate-500">
                Add one Customer → Location mapping, or bulk upload an Excel/CSV with columns Customer and Location.
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Manual Entry</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Customer</label>
                    <input
                      value={manualCustomer}
                      onChange={(e) => setManualCustomer(e.target.value)}
                      placeholder="Example: ANDRONICO'S #0173"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
                    <input
                      value={manualLocation}
                      onChange={(e) => setManualLocation(e.target.value)}
                      placeholder="Example: ANDRONICOS"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={saveManualLocation}
                    disabled={uploadingLocations}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save Location
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Bulk Upload</h3>
                <p className="mb-3 text-sm text-slate-500">
                  Upload an Excel or CSV file with exactly these columns: Customer and Location.
                </p>
                <button
                  type="button"
                  onClick={() => locationInputRef.current?.click()}
                  disabled={uploadingLocations}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  {uploadingLocations ? "Uploading..." : "Choose Location File"}
                </button>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {missingLocations.length > 0 && (
        <LocationResolutionModal
          missing={missingLocations}
          suggestions={locations}
          onCancel={() => {
            setMissingLocations([]);
            setPendingRows([]);
            setPendingSourceName("");
          }}
          onSave={saveMissingLocations}
        />
      )}
    </div>
  );
}
