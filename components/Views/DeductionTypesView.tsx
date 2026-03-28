"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type DeductionTypeRow = {
  id: string;
  document_type: string;
  deduction_type: string;
  created_at?: string;
};

export default function DeductionTypesView() {
  const [rows, setRows] = useState<DeductionTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRows = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("deduction_types")
        .select("id, document_type, deduction_type, created_at")
        .order("document_type", { ascending: true });

      if (error) throw error;

      setRows(data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load deduction types.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900">Deduction Type Mapping</h2>
        <p className="mt-1 text-sm text-slate-500">
          Document Type is what comes from the document/PDF/Excel. Deduction Type is our tag.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading deduction types...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-600">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No deduction types found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Document Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Deduction Type
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.document_type}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {row.deduction_type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}