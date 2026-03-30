"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, MapPin, Loader2 } from "lucide-react";

// Initialize Supabase client — replace with your actual env vars
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

  // Fetch locations from Supabase
  const fetchLocations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .order("retailer_name", { ascending: true });

    if (error) {
      console.error("Error fetching locations:", error);
    } else {
      setLocations(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleSave = async () => {
    const { customer, retailer_area, retailer } = form;
    if (!customer.trim() || !retailer_area.trim() || !retailer.trim()) {
      setError("All three fields are required.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("locations").insert([
      { customer: customer.trim(), retailer_area: retailer_area.trim(), retailer: retailer.trim() },
    ]);

    if (error) {
      setError(error.message);
    } else {
      setForm({ customer: "", retailer_area: "", retailer: "" });
      setOpen(false);
      await fetchLocations();
    }
    setSaving(false);
  };

  return (
    <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
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

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading locations…
        </div>
      ) : locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
          <MapPin className="h-8 w-8" />
          <p className="text-sm">No locations yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Retailer Area</th>
                <th className="px-4 py-3">Retailer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {locations.map((loc) => (
                <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{loc.customer}</td>
                  <td className="px-4 py-3 text-slate-600">{loc.retailer_area}</td>
                  <td className="px-4 py-3 text-slate-600">{loc.retailer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Location Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="retailer_name">Customer</Label>
              <Input
                id="retailer_name"
                name="customer"
                placeholder="e.g. FRESH THYME #101 - CHICAGO, IL"
                value={form.customer}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="retailer_area">Retailer Area</Label>
              <Input
                id="retailer_area"
                name="retailer_area"
                placeholder="e.g. FRESH THYME"
                value={form.retailer_area}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="retailer">Retailer</Label>
              <Input
                id="retailer"
                name="retailer"
                placeholder="e.g. Fresh Thyme"
                value={form.retailer}
                onChange={handleChange}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}