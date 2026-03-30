"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Save } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserPermissionRow = {
  id: string;
  email: string;
  can_view_dashboard: boolean;
  can_view_broker_commission_summary: boolean;
  can_view_broker_commission_data_sets: boolean;
  can_view_accounting_summary: boolean;
  can_view_accounting_check_details: boolean;
  can_view_reporting_report_xxx: boolean;
  can_view_database_ksolve_invoices: boolean;
  can_view_database_kehe_velocity: boolean;
  can_view_database_product_list: boolean;
  can_view_database_locations: boolean;
  can_view_database_deduction_type: boolean;
  can_view_admin: boolean;
  can_view_user_account: boolean;
  can_reprocess_invoices: boolean;
  created_at?: string;
  updated_at?: string;
};

const PERMISSION_FIELDS: Array<{
  key: keyof UserPermissionRow;
  label: string;
}> = [
  { key: "can_view_dashboard", label: "Dashboard" },
  { key: "can_view_broker_commission_summary", label: "Broker Commission Summary" },
  { key: "can_view_broker_commission_data_sets", label: "Broker Commission Data Sets" },
  { key: "can_view_accounting_summary", label: "Accounting Summary" },
  { key: "can_view_accounting_check_details", label: "Accounting Check Details" },
  { key: "can_view_reporting_report_xxx", label: "Reporting / Report XXX" },
  { key: "can_view_database_ksolve_invoices", label: "Database / Ksolve Invoices" },
  { key: "can_view_database_kehe_velocity", label: "Database / KeHe Velocity" },
  { key: "can_view_database_product_list", label: "Database / Product List" },
  { key: "can_view_database_locations", label: "Database / Locations" },
  { key: "can_view_database_deduction_type", label: "Database / Deduction Type" },
  { key: "can_view_admin", label: "Admin Menu" },
  { key: "can_view_user_account", label: "Admin / User Account" },
  { key: "can_reprocess_invoices", label: "Reprocess Invoices" },
];

export default function UserAccountView() {
  const [rows, setRows] = useState<UserPermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const loadRows = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("user_permissions")
        .select("*")
        .order("email", { ascending: true });

      if (error) throw error;
      setRows(data || []);
    } catch (error) {
      console.error("Failed to load user permissions:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.email.toLowerCase().includes(q));
  }, [rows, search]);

  const updateLocalRow = (
    email: string,
    field: keyof UserPermissionRow,
    value: boolean
  ) => {
    setRows((prev) =>
      prev.map((row) =>
        row.email === email ? { ...row, [field]: value } : row
      )
    );
  };

  const handleToggle = async (
    email: string,
    field: keyof UserPermissionRow,
    value: boolean
  ) => {
    updateLocalRow(email, field, value);
    setSavingEmail(email);

    try {
      const { error } = await supabase
        .from("user_permissions")
        .update({
          [field]: value,
          updated_at: new Date().toISOString(),
        })
        .eq("email", email);

      if (error) throw error;
    } catch (error) {
      console.error("Failed to update permission:", error);
      updateLocalRow(email, field, !value);
      alert("Failed to save permission change.");
    } finally {
      setSavingEmail(null);
    }
  };

  const handleAddUser = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    setAdding(true);
    try {
      const { error } = await supabase.from("user_permissions").insert({
        email,
        can_view_dashboard: false,
        can_view_broker_commission_summary: false,
        can_view_broker_commission_data_sets: false,
        can_view_accounting_summary: false,
        can_view_accounting_check_details: false,
        can_view_reporting_report_xxx: false,
        can_view_database_ksolve_invoices: false,
        can_view_database_kehe_velocity: false,
        can_view_database_product_list: false,
        can_view_database_locations: false,
        can_view_database_deduction_type: false,
        can_view_admin: false,
        can_view_user_account: false,
        can_reprocess_invoices: false,
      });

      if (error) throw error;

      setNewEmail("");
      await loadRows();
    } catch (error: any) {
      alert(error.message || "Failed to add user.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">User Account</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage access per user and control which menus they can see.
          </p>
        </div>

        <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email"
              className="rounded-2xl pl-10"
            />
          </div>

          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Add user email"
            className="rounded-2xl sm:w-64"
          />

          <Button
            type="button"
            className="rounded-2xl bg-slate-900 hover:bg-slate-800"
            onClick={handleAddUser}
            disabled={adding}
          >
            <Save className="mr-2 h-4 w-4" />
            {adding ? "Adding..." : "Add User"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading user permissions...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No users found.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRows.map((row) => (
            <div
              key={row.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {row.email}
                  </div>
                  <div className="text-xs text-slate-400">
                    {savingEmail === row.email ? "Saving..." : "Ready"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {PERMISSION_FIELDS.map((permission) => (
                  <label
                    key={String(permission.key)}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="pr-3 text-slate-700">{permission.label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(row[permission.key])}
                      onChange={(e) =>
                        handleToggle(row.email, permission.key, e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}