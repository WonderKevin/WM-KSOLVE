"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const [showForm, setShowForm] = useState(false);
  const [documentType, setDocumentType] = useState("");
  const [deductionType, setDeductionType] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadRows = async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

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
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("deduction-types-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deduction_types",
        },
        async () => {
          await loadRows(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resetForm = () => {
    setDocumentType("");
    setDeductionType("");
    setShowForm(false);
    setEditingId(null);
  };

  const startAdd = () => {
    setEditingId(null);
    setDocumentType("");
    setDeductionType("");
    setShowForm(true);
    setOpenMenuId(null);
  };

  const startEdit = (row: DeductionTypeRow) => {
    setEditingId(row.id);
    setDocumentType(row.document_type);
    setDeductionType(row.deduction_type);
    setShowForm(true);
    setOpenMenuId(null);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const cleanedDocumentType = documentType.trim();
      const cleanedDeductionType = deductionType.trim();

      if (!cleanedDocumentType || !cleanedDeductionType) {
        setError("Document Type and Deduction Type are required.");
        return;
      }

      if (editingId) {
        const { error } = await supabase
          .from("deduction_types")
          .update({
            document_type: cleanedDocumentType,
            deduction_type: cleanedDeductionType,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId);

        if (error) throw error;
      } else {
        const { data: existing, error: existingError } = await supabase
          .from("deduction_types")
          .select("id")
          .ilike("document_type", cleanedDocumentType)
          .limit(1);

        if (existingError) throw existingError;

        if (existing && existing.length > 0) {
          const { error: updateError } = await supabase
            .from("deduction_types")
            .update({
              deduction_type: cleanedDeductionType,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing[0].id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("deduction_types")
            .insert({
              document_type: cleanedDocumentType,
              deduction_type: cleanedDeductionType,
              updated_at: new Date().toISOString(),
            });

          if (insertError) throw insertError;
        }
      }

      resetForm();
      await loadRows(true);
    } catch (err: any) {
      setError(err.message || "Failed to save deduction type.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: DeductionTypeRow) => {
    const ok = window.confirm(
      `Delete mapping "${row.document_type}" -> "${row.deduction_type}"?`
    );
    if (!ok) return;

    try {
      setError(null);
      const { error } = await supabase
        .from("deduction_types")
        .delete()
        .eq("id", row.id);

      if (error) throw error;

      if (editingId === row.id) resetForm();
      setOpenMenuId(null);
      await loadRows(true);
    } catch (err: any) {
      setError(err.message || "Failed to delete deduction type.");
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Deduction Type Mapping
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Document Type is what comes from the document/PDF/Excel. Deduction
            Type is our tag.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => loadRows(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>

          <Button
            type="button"
            className="rounded-2xl bg-slate-900 hover:bg-slate-800"
            onClick={startAdd}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Deduction
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Document Type
              </label>
              <Input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="e.g. Customer Spoilage Natural"
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Deduction Type
              </label>
              <Input
                value={deductionType}
                onChange={(e) => setDeductionType(e.target.value)}
                placeholder="e.g. Customer Spoils Allowance"
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : editingId ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      )}

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
                <th className="w-16 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 bg-white">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.document_type}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {row.deduction_type}
                  </td>
                  <td className="relative px-4 py-3 text-right">
                    <div className="inline-block" ref={openMenuId === row.id ? menuRef : null}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuId((prev) => (prev === row.id ? null : row.id))
                        }
                        className="rounded-full p-2 hover:bg-slate-100"
                        title="More actions"
                      >
                        <MoreHorizontal className="h-4 w-4 text-slate-600" />
                      </button>

                      {openMenuId === row.id && (
                        <div className="absolute right-4 top-12 z-20 min-w-[140px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
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