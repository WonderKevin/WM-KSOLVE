"use client";

import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  LayoutDashboard,
  Receipt,
  Upload,
  FileText,
  Package,
  Tags,
  BadgeDollarSign,
  Percent,
  Menu,
  Search,
  Bell,
  User,
  Plus,
  Trash2,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";

const SPOILS_COLUMNS = [
  "Month",
  "Invoice",
  "UPC",
  "Product",
  "Customer",
  "Allowance $",
  "Item",
  "Retailer",
];

const sampleRows = [
  {
    Month: "Jan 2026",
    Invoice: "INV-10021",
    UPC: "012345678905",
    Product: "Sparkling Water Lime",
    Customer: "Northside Grocery",
    "Allowance $": "$125.00",
    Item: "24-pack",
    Retailer: "WM",
  },
];

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { label: "Broker Commission", icon: Receipt, key: "broker-commission" },
  {
    label: "Accounting",
    icon: BadgeDollarSign,
    key: "accounting",
    children: [{ label: "Summary", key: "accounting-summary" }],
  },
  {
    label: "Database",
    icon: Database,
    key: "database",
    children: [
      { label: "Upload", key: "database-upload", icon: Upload },
      { label: "Spoil", key: "database-spoil", icon: Trash2 },
      { label: "Slotting", key: "database-slotting", icon: Tags },
      { label: "New Item Set up", key: "database-new-item", icon: Package },
      { label: "Pass Thru Deduction", key: "database-pass-thru", icon: Percent },
      { label: "Introductory Fee", key: "database-intro-fee", icon: FileText },
    ],
  },
];

function SidebarItem({ item, activeKey, setActiveKey, openGroups, setOpenGroups }: any) {
  const isGroup = !!item.children?.length;
  const isOpen = openGroups[item.key];
  const isActive = activeKey === item.key;
  const Icon = item.icon;

  if (!isGroup) {
    return (
      <button
        onClick={() => setActiveKey(item.key)}
        className={`w-full rounded-2xl px-3 py-3 text-left ${
          isActive ? "bg-slate-900 text-white" : "hover:bg-slate-100"
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          {item.label}
        </div>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() =>
          setOpenGroups((prev: any) => ({
            ...prev,
            [item.key]: !prev[item.key],
          }))
        }
        className="flex w-full justify-between px-3 py-3 hover:bg-slate-100 rounded-2xl"
      >
        <div className="flex gap-3">
          <Icon className="h-4 w-4" />
          {item.label}
        </div>
        {isOpen ? <ChevronDown /> : <ChevronRight />}
      </button>

      {isOpen &&
        item.children.map((child: any) => (
          <button
            key={child.key}
            onClick={() => setActiveKey(child.key)}
            className="ml-6 block py-2 text-left w-full hover:bg-slate-100 rounded-xl"
          >
            {child.label}
          </button>
        ))}
    </div>
  );
}

function UploadDropzone() {
  const [files, setFiles] = useState<any[]>([]);

  const handleChange = (e: any) => {
    setFiles([...files, ...Array.from(e.target.files)]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload PDFs</CardTitle>
        <CardDescription>Upload spoil PDFs</CardDescription>
      </CardHeader>

      <CardContent>
        <label className="block cursor-pointer border-dashed border p-10 bg-gray-500 text-white text-center rounded-xl">
          <div>
            <FileText className="mx-auto mb-4" />
            <p>CHOOSE FILES</p>
            <p className="text-sm">or drop files here</p>
          </div>
          <input type="file" hidden multiple onChange={handleChange} />
        </label>

        <div className="mt-4">
          {files.map((file, i) => (
            <div key={i} className="text-sm">
              {file.name}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Table() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spoils Format</CardTitle>
      </CardHeader>

      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {SPOILS_COLUMNS.map((col) => (
                <th key={col} className="text-left p-2">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, i) => (
              <tr key={i}>
                {SPOILS_COLUMNS.map((col) => (
                  <td key={col} className="p-2">
                    {row[col]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function WMKsolveApp() {
  const [activeKey, setActiveKey] = useState("database-upload");
  const [openGroups, setOpenGroups] = useState({
    accounting: false,
    database: true,
  });

  const renderContent = () => {
    if (activeKey === "database-upload") {
      return (
        <div className="grid grid-cols-2 gap-6">
          <UploadDropzone />
          <Table />
        </div>
      );
    }

    return <div>Coming soon</div>;
  };

  return (
    <div className="flex h-screen">
      <div className="w-64 border-r p-4">
        {sidebarItems.map((item) => (
          <SidebarItem
            key={item.key}
            item={item}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
            openGroups={openGroups}
            setOpenGroups={setOpenGroups}
          />
        ))}
      </div>

      <div className="flex-1 p-6">{renderContent()}</div>
    </div>
  );
}