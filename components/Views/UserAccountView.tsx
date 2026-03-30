"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, UserPlus } from "lucide-react";
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

const PERMISSION_GROUPS: Array<{
  label: string;
  children: Array<keyof UserPermissionRow>;
}> = [
  {
    label: "Dashboard",
    children: ["can_view_dashboard"],
  },
  {
    label: "Broker Commission",
    children: [
      "can_view_broker_commission_summary",
      "can_view_broker_commission_data_sets",
    ],
  },
  {
    label: "Accounting",
    children: [
      "can_view_accounting_summary",
      "can_view_accounting_check_details",
    ],
  },
  {
    label: "Reporting",
    children: ["can_view_reporting_report_xxx"],
  },
  {
    label: "Database",
    children: [
      "can_view_database_ksolve_invoices",
      "can_view_database_kehe_velocity",
      "can_view_database_product_list",
      "can_view_database_locations",
      "can_view_database_deduction_type",
    ],
  },
  {
    label: "Admin",
    children: ["can_view_admin", "can_view_user_account"],
  },
  {
    label: "Special",
    children: ["can_reprocess_invoices"],
  },
];

const LABEL_MAP: Record<string, string> = {
  can_view_dashboard: "Dashboard",

  can_view_broker_commission_summary: "Summary",
  can_view_broker_commission_data_sets: "Data Sets",

  can_view_accounting_summary: "Summary",
  can_view_accounting_check_details: "Check Details",

  can_view_reporting_report_xxx: "Report XXX",

  can_view_database_ksolve_invoices: "Ksolve Invoices",
  can_view_database_kehe_velocity: "KeHe Velocity",
  can_view_database_product_list: "Product List",
  can_view_database_locations: "Locations",
  can_view_database_deduction_type: "Deduction Type",

  can_view_admin: "Admin Menu",
  can_view_user_account: "User Account",

  can_reprocess_invoices: "Reprocess Invoices",
};

export default function UserAccountView() {
  const [rows, setRows] = useState<UserPermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<string[]>([]);

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
    const previousRow = rows.find((row) => row.email === email);
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
      if (previousRow) {
        updateLocalRow(email, field, Boolean(previousRow[field]));
      }
      alert("Failed to save permission change.");
    } finally {
      setSavingEmail(null);
    }
  };

  const handleGroupToggle = async (
    row: UserPermissionRow,
    fields: Array<keyof UserPermissionRow>,
    value: boolean
  ) => {
    const previousRow = { ...row };

    setRows((prev) =>
      prev.map((item) =>
        item.email === row.email
          ? fields.reduce(
              (acc, field) => ({ ...acc, [field]: value }),
              { ...item }
            )
          : item
      )
    );

    setSavingEmail(row.email);

    try {
      const payload = fields.reduce<Record<string, boolean>>((acc, field) => {
        acc[field] = value;
        return acc;
      }, {});
      payload.updated_at = true as unknown as boolean;

      const { error } = await supabase
        .from("user_permissions")
        .update({
          ...fields.reduce<Record<string, boolean>>((acc, field) => {
            acc[field] = value;
            return acc;
          }, {}),
          updated_at: new Date().toISOString(),
        })
        .eq("email", row.email);

      if (error) throw error;
    } catch (error) {
      console.error("Failed to update group permission:", error);
      setRows((prev) =>
        prev.map((item) => (item.email === row.email ? previousRow : item))
      );
      alert("Failed to save group permission change.");
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

  const toggleExpanded = (email: string) => {
    setExpandedEmails((prev) =>
      prev.includes(email)
        ? prev.filter((item) => item !== email)
        : [...prev, email]
    );
  };

  const isGroupChecked = (
    row: UserPermissionRow,
    fields: Array<keyof UserPermissionRow>
  ) => fields.every((field) => Boolean(row[field]));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">User Account</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage access by menu and submenu.
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
            <UserPlus className="mr-2 h-4 w-4" />
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
          {filteredRows.map((row) => {
            const isExpanded = expandedEmails.includes(row.email);

            return (
              <div
                key={row.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(row.email)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {row.email}
                    </div>
                    <div className="text-xs text-slate-400">
                      {savingEmail === row.email ? "Saving..." : "Click to manage access"}
                    </div>
                  </div>

                  <div className="text-slate-500">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {PERMISSION_GROUPS.map((group) => {
                        const checked = isGroupChecked(row, group.children);

                        return (
                          <div
                            key={group.label}
                            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-900">
                                {group.label}
                              </span>

                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  handleGroupToggle(row, group.children, e.target.checked)
                                }
                                className="h-4 w-4 accent-slate-900"
                              />
                            </div>

                            <div className="space-y-2">
                              {group.children.map((field) => (
                                <label
                                  key={String(field)}
                                  className="flex items-center justify-between rounded-xl px-2 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                                >
                                  <span>{LABEL_MAP[String(field)]}</span>

                                  <input
                                    type="checkbox"
                                    checked={Boolean(row[field])}
                                    onChange={(e) =>
                                      handleToggle(row.email, field, e.target.checked)
                                    }
                                    className="h-4 w-4 accent-slate-900"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}