"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, MapPin, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

interface Location {
  id: string;
  customer: string;
  retailer_area: string;
  retailer: string;
  created_at: string;
}

export default function LocationsView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer: "",
    retailer_area: "",
    retailer: "",
  });

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
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

  return (
    <>
      <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Locations</h2>
            <p className="mt-1 text-sm text-slate-500">
              {locations.length.toLocaleString()} location{locations.length !== 1 ? "s" : ""}
            </p>
          </div>

          <Button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-xl"
          >
            <Plus className="h-4 w-4" />
            Add Location
          </Button>
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
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Retailer Area</th>
                  <th className="px-4 py-3">Retailer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {locations.map((loc) => (
                  <tr key={loc.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{loc.customer}</td>
                    <td className="px-4 py-3 text-slate-600">{loc.retailer_area}</td>
                    <td className="px-4 py-3 text-slate-600">{loc.retailer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
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

            <div className="space-y-4 py-2">
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
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose} className="rounded-2xl">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="rounded-2xl">
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
        </div>
      )}
    </>
  );
}