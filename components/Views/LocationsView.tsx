"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  MapPin,
  Loader2,
  X,
  Search,
  Upload,
  FileSpreadsheet,
  Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

interface Location {
  id: string;
  customer: string;
  retailer_area: string;
  retailer: string;
  created_at: string;
}

type UploadRow = {
  customer: string;
  retailer_area: string;
  retailer: string;
};

export default function LocationsView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    customer: "",
    retailer_area: "",
    retailer: "",
  });

  const [uploadPreview, setUploadPreview] = useState<UploadRow[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");

  const fetchLocations = async () => {
    setLoading(true);

    try {
      const pageSize = 1000;
      let from = 0;
      let allRows: Location[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("locations")
          .select("*")
          .order("customer", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        const batch = data ?? [];
        allRows = [...allRows, ...batch];

        if (batch.length < pageSize) break;
        from += pageSize;
      }

      setLocations(allRows);
    } catch (error) {
      console.error("Error fetching locations:", error);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  const filteredLocations = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return locations;

    return locations.filter((loc) =>
      [loc.customer, loc.retailer_area, loc.retailer]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [locations, search]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
    setUploadError(null);
    setUploadPreview([]);
    setUploadFileName("");
    setForm({
      customer: "",
      retailer_area: "",
      retailer: "",
    });
  };

  const handleSave = async () => {
    const { customer, retailer_area, retailer } = form;

    if (!customer.trim() || !retailer_area.trim() || !retailer.trim()) {
      setError("All three fields are required.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("locations").insert([
      {
        customer: customer.trim(),
        retailer_area: retailer_area.trim(),
        retailer: retailer.trim(),
      },
    ]);

    if (error) {
      setError(error.message);
    } else {
      handleClose();
      await fetchLocations();
    }

    setSaving(false);
  };

  const handleExportToExcel = () => {
    if (!filteredLocations.length) {
      alert("No locations to export.");
      return;
    }

    const exportRows = filteredLocations.map((loc) => ({
      Customer: loc.customer,
      "Retailer Area": loc.retailer_area,
      Retailer: loc.retailer,
      "Created At": loc.created_at,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Locations");

    const fileName = search.trim()
      ? `locations_filtered_${search.trim().replace(/\s+/g, "_")}.xlsx`
      : "locations.xlsx";

    XLSX.writeFile(workbook, fileName);
  };

  const normalizeHeader = (value: string) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

  const getCellValue = (row: Record<string, any>, headerNames: string[]) => {
    const entries = Object.entries(row);

    for (const [key, value] of entries) {
      const normalizedKey = normalizeHeader(key);
      if (headerNames.includes(normalizedKey)) {
        return String(value ?? "").trim();
      }
    }

    return "";
  };

  const parseUploadRows = (rawRows: Record<string, any>[]): UploadRow[] => {
    return rawRows
      .map((row) => {
        const customer = getCellValue(row, ["customer"]);
        const retailer_area = getCellValue(row, [
          "retail area",
          "retailer area",
        ]);
        const retailer = getCellValue(row, ["retailer"]);

        return {
          customer,
          retailer_area,
          retailer,
        };
      })
      .filter((row) => row.customer && row.retailer_area && row.retailer);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadPreview([]);
    setUploadFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });

      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setUploadError("No sheet found in the uploaded file.");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
        defval: "",
      });

      if (!rawRows.length) {
        setUploadError("The uploaded file is empty.");
        return;
      }

      const parsedRows = parseUploadRows(rawRows);

      if (!parsedRows.length) {
        setUploadError(
          "No valid rows found. Make sure the file has columns: Customer, Retail Area, Retailer."
        );
        return;
      }

      setUploadPreview(parsedRows);
    } catch (err) {
      console.error("Error parsing file:", err);
      setUploadError(
        "Failed to read the file. Please upload a valid CSV or Excel file."
      );
    } finally {
      e.target.value = "";
    }
  };

  const handleUploadSave = async () => {
    if (!uploadPreview.length) {
      setUploadError("Please upload a valid file first.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const payload = uploadPreview.map((row) => ({
      customer: row.customer.trim(),
      retailer_area: row.retailer_area.trim(),
      retailer: row.retailer.trim(),
    }));

    const { error } = await supabase.from("locations").insert(payload);

    if (error) {
      setUploadError(error.message);
      setUploading(false);
      return;
    }

    handleClose();
    await fetchLocations();
    setUploading(false);
  };

  return (
    <>
      <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Locations</h2>
            <p className="mt-1 text-sm text-slate-500">
              {filteredLocations.length.toLocaleString()} of{" "}
              {locations.length.toLocaleString()} location
              {locations.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-xl"
              onClick={handleExportToExcel}
              disabled={loading || filteredLocations.length === 0}
              title="Download to Excel"
            >
              <Download className="h-4 w-4" />
            </Button>

            <Button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-xl"
            >
              <Plus className="h-4 w-4" />
              Add Location
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading locations...
          </div>
        ) : locations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
            <MapPin className="h-8 w-8" />
            <p className="text-sm">No locations yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-100 bg-white">
            <div className="sticky top-0 z-20 rounded-t-xl border-b border-slate-100 bg-white">
              <div className="p-4">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search customer, retailer area, or retailer..."
                    className="rounded-xl pl-10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <div>Customer</div>
                <div>Retailer Area</div>
                <div>Retailer</div>
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto overflow-x-auto">
              {filteredLocations.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
                  <Search className="h-8 w-8" />
                  <p className="text-sm">No matching locations found.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredLocations.map((loc) => (
                    <div
                      key={loc.id}
                      className="grid grid-cols-3 gap-4 px-4 py-3 text-sm transition-colors hover:bg-slate-50"
                    >
                      <div className="font-medium text-slate-800">
                        {loc.customer}
                      </div>
                      <div className="text-slate-600">{loc.retailer_area}</div>
                      <div className="text-slate-600">{loc.retailer}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Add Location</h2>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Add Manually
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a single location using the form below.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="customer"
                    className="text-sm font-medium text-slate-700"
                  >
                    Customer
                  </label>
                  <Input
                    id="customer"
                    name="customer"
                    placeholder="e.g. FRESH THYME #101 - CHICAGO, IL"
                    value={form.customer}
                    onChange={handleChange}
                    className="rounded-2xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="retailer_area"
                    className="text-sm font-medium text-slate-700"
                  >
                    Retailer Area
                  </label>
                  <Input
                    id="retailer_area"
                    name="retailer_area"
                    placeholder="e.g. FRESH THYME"
                    value={form.retailer_area}
                    onChange={handleChange}
                    className="rounded-2xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="retailer"
                    className="text-sm font-medium text-slate-700"
                  >
                    Retailer
                  </label>
                  <Input
                    id="retailer"
                    name="retailer"
                    placeholder="e.g. Fresh Thyme"
                    value={form.retailer}
                    onChange={handleChange}
                    className="rounded-2xl"
                  />
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="rounded-2xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-2xl"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Upload File
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload a CSV or Excel file with columns: Customer, Retail Area, Retailer.
                  </p>
                </div>

                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 transition hover:bg-slate-50">
                  <Upload className="h-4 w-4" />
                  <span>Choose CSV or Excel file</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>

                {uploadFileName && (
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <FileSpreadsheet className="h-4 w-4" />
                    <span className="truncate">{uploadFileName}</span>
                  </div>
                )}

                {uploadPreview.length > 0 && (
                  <div className="rounded-2xl border border-slate-200">
                    <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
                      {uploadPreview.length} valid row
                      {uploadPreview.length !== 1 ? "s" : ""} ready to import
                    </div>
                    <div className="max-h-56 overflow-auto">
                      <div className="grid grid-cols-3 gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <div>Customer</div>
                        <div>Retail Area</div>
                        <div>Retailer</div>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {uploadPreview.slice(0, 10).map((row, index) => (
                          <div
                            key={`${row.customer}-${index}`}
                            className="grid grid-cols-3 gap-3 px-4 py-2 text-sm"
                          >
                            <div className="truncate text-slate-800">
                              {row.customer}
                            </div>
                            <div className="truncate text-slate-600">
                              {row.retailer_area}
                            </div>
                            <div className="truncate text-slate-600">
                              {row.retailer}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {uploadError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {uploadError}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={handleUploadSave}
                    disabled={uploading || uploadPreview.length === 0}
                    className="rounded-2xl"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      "Import File"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}