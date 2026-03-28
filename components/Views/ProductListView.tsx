"use client";

import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search, Trash2, X, Pencil } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type ProductItem = {
  id: string;
  upc: string;
  item_description: string;
  created_at: string;
};

export default function ProductListView() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [upc, setUpc] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const isEditMode = !!editingItemId;

  const fetchItems = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("product_list")
      .select("*")
      .order("item_description", { ascending: true });

    if (!error && data) {
      setItems(data);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return items;

    return items.filter(
      (item) =>
        item.upc.toLowerCase().includes(keyword) ||
        item.item_description.toLowerCase().includes(keyword)
    );
  }, [items, search]);

  const resetForm = () => {
    setEditingItemId(null);
    setUpc("");
    setItemDescription("");
    setErrorMessage("");
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (item: ProductItem) => {
    setEditingItemId(item.id);
    setUpc(item.upc);
    setItemDescription(item.item_description);
    setErrorMessage("");
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSaveItem = async () => {
    setErrorMessage("");

    const cleanUpc = upc.trim();
    const cleanDescription = itemDescription.trim();

    if (!cleanUpc || !cleanDescription) {
      setErrorMessage("Please complete all fields.");
      return;
    }

    setSaving(true);

    try {
      const duplicateQuery = supabase
        .from("product_list")
        .select("id")
        .eq("upc", cleanUpc);

      const { data: duplicateItems, error: duplicateCheckError } = isEditMode
        ? await duplicateQuery.neq("id", editingItemId as string)
        : await duplicateQuery;

      if (duplicateCheckError) {
        setErrorMessage("Unable to validate duplicate item.");
        return;
      }

      if (duplicateItems && duplicateItems.length > 0) {
        setErrorMessage("Item already exist please check.");
        return;
      }

      if (isEditMode) {
        const { error } = await supabase
          .from("product_list")
          .update({
            upc: cleanUpc,
            item_description: cleanDescription,
          })
          .eq("id", editingItemId);

        if (error) {
          if (error.code === "23505") {
            setErrorMessage("Item already exist please check.");
            return;
          }

          setErrorMessage(error.message || "Failed to update item.");
          return;
        }
      } else {
        const { error } = await supabase.from("product_list").insert([
          {
            upc: cleanUpc,
            item_description: cleanDescription,
          },
        ]);

        if (error) {
          if (error.code === "23505") {
            setErrorMessage("Item already exist please check.");
            return;
          }

          setErrorMessage(error.message || "Failed to add item.");
          return;
        }
      }

      handleCloseModal();
      await fetchItems();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (item: ProductItem) => {
    const confirmed = window.confirm(
      `Delete this item?\n\nUPC: ${item.upc}\nItem: ${item.item_description}`
    );

    if (!confirmed) return;

    setDeletingId(item.id);

    try {
      const { error } = await supabase.from("product_list").delete().eq("id", item.id);

      if (error) {
        alert(error.message || "Failed to delete item.");
        return;
      }

      await fetchItems();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search UPC or item description"
              className="rounded-2xl pl-10"
            />
          </div>

          <Button
            type="button"
            className="rounded-2xl bg-slate-900 hover:bg-slate-800"
            onClick={handleOpenAddModal}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700">UPC</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Item Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                      Loading items...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                      No items found.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">{item.upc}</td>
                      <td className="px-4 py-3 text-slate-700">{item.item_description}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <div className="group relative inline-block">
                            <button
                              type="button"
                              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              <MoreHorizontal className="h-5 w-5" />
                            </button>

                            <div className="invisible absolute right-0 top-full z-20 mt-2 w-40 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(item)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item)}
                                disabled={deletingId === item.id}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                {deletingId === item.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                {isEditMode ? "Edit Item" : "Add Item"}
              </h2>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">UPC</label>
                <Input
                  value={upc}
                  onChange={(e) => setUpc(e.target.value)}
                  placeholder="Type in"
                  className="rounded-2xl"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Item Description</label>
                <Input
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="Type in"
                  className="rounded-2xl"
                />
              </div>

              {errorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={handleCloseModal}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                onClick={handleSaveItem}
                disabled={saving}
              >
                {saving ? "Saving..." : isEditMode ? "Save Changes" : "Save Item"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}