"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = any;

// 🔥 GROUPED PERMISSIONS (MATCHES SIDEBAR)
const PERMISSION_GROUPS = [
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

export default function UserAccountView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("user_permissions")
      .select("*")
      .order("email");

    setRows(data || []);
  };

  const toggleExpand = (email: string) => {
    setExpanded((prev) =>
      prev.includes(email)
        ? prev.filter((e) => e !== email)
        : [...prev, email]
    );
  };

  const update = async (email: string, field: string, value: boolean) => {
    setRows((prev) =>
      prev.map((r) =>
        r.email === email ? { ...r, [field]: value } : r
      )
    );

    await supabase
      .from("user_permissions")
      .update({ [field]: value })
      .eq("email", email);
  };

  // 🔥 GROUP TOGGLE (MAIN FEATURE)
  const toggleGroup = (row: Row, group: any, value: boolean) => {
    group.children.forEach((field: string) => {
      update(row.email, field, value);
    });
  };

  // 🔥 AUTO CHECK GROUP STATE
  const isGroupChecked = (row: Row, group: any) => {
    return group.children.every((f: string) => row[f]);
  };

  const filtered = rows.filter((r) =>
    r.email.toLowerCase().includes(search.toLowerCase())
  );

  const addUser = async () => {
    if (!newEmail) return;

    await supabase.from("user_permissions").insert({
      email: newEmail.toLowerCase(),
    });

    setNewEmail("");
    load();
  };

  return (
    <div className="rounded-3xl border bg-white p-6">
      {/* HEADER */}
      <div className="flex justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">User Account</h2>
          <p className="text-sm text-gray-500">
            Control access by menu
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Input
            placeholder="Email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <Button onClick={addUser}>
            <UserPlus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      {/* USERS */}
      <div className="space-y-4">
        {filtered.map((row) => {
          const open = expanded.includes(row.email);

          return (
            <div key={row.id} className="border rounded-xl">
              {/* USER HEADER */}
              <div
                onClick={() => toggleExpand(row.email)}
                className="flex justify-between p-4 cursor-pointer hover:bg-gray-50"
              >
                <div>
                  <div className="font-semibold">{row.email}</div>
                  <div className="text-xs text-gray-400">
                    Click to manage access
                  </div>
                </div>

                {open ? <ChevronDown /> : <ChevronRight />}
              </div>

              {/* PERMISSIONS */}
              {open && (
                <div className="p-4 border-t space-y-4">
                  {PERMISSION_GROUPS.map((group) => {
                    const checked = isGroupChecked(row, group);

                    return (
                      <div key={group.label} className="border rounded-lg p-3">
                        {/* MAIN MENU CHECK */}
                        <div className="flex justify-between mb-2">
                          <span className="font-semibold">{group.label}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              toggleGroup(row, group, e.target.checked)
                            }
                          />
                        </div>

                        {/* SUB MENU */}
                        <div className="grid grid-cols-2 gap-2">
                          {group.children.map((field: string) => (
                            <label
                              key={field}
                              className="flex justify-between border p-2 rounded"
                            >
                              <span className="text-sm">{field.replace("can_view_", "")}</span>
                              <input
                                type="checkbox"
                                checked={row[field] || false}
                                onChange={(e) =>
                                  update(row.email, field, e.target.checked)
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}