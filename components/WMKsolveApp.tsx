"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  LayoutDashboard,
  Receipt,
  Upload,
  BadgeDollarSign,
  Menu,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import DashboardView from "@/components/Views/DashboardView";
import BrokerCommissionView from "@/components/Views/BrokerCommissionView";
import AccountingSummaryView from "@/components/Views/AccountingSummaryView";
import CheckDetailsView from "@/components/Views/CheckDetailsView";
import InvoicesView from "@/components/Views/InvoicesView";

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { label: "Broker Commission", icon: Receipt, key: "broker-commission" },
  {
    label: "Accounting",
    icon: BadgeDollarSign,
    key: "accounting",
    children: [
      { label: "Summary", key: "accounting-summary" },
      { label: "Check Details", key: "accounting-check-details" },
    ],
  },
  { label: "Invoices", icon: Database, key: "invoices" },
];

function SidebarItem({
  item,
  activeKey,
  setActiveKey,
  openGroups,
  setOpenGroups,
}: any) {
  const isGroup = !!item.children?.length;
  const isOpen = openGroups[item.key];
  const isActive = activeKey === item.key;
  const Icon = item.icon;
  const hasActiveChild = item.children?.some((child: any) => child.key === activeKey);

  if (!isGroup) {
    return (
      <button
        type="button"
        onClick={() => setActiveKey(item.key)}
        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
          isActive
            ? "bg-slate-900 text-white shadow-sm"
            : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          setOpenGroups((prev: any) => ({
            ...prev,
            [item.key]: !prev[item.key],
          }))
        }
        className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
          hasActiveChild ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-100"
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          <span>{item.label}</span>
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {isOpen && (
        <div className="ml-8 mt-2 space-y-1">
          {item.children.map((child: any) => (
            <button
              type="button"
              key={child.key}
              onClick={() => setActiveKey(child.key)}
              className={`block w-full rounded-xl px-4 py-2 text-left text-sm transition ${
                activeKey === child.key
                  ? "bg-slate-200 font-medium text-slate-900"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WMKsolveApp() {
  const [activeKey, setActiveKey] = useState("dashboard");
  const [openGroups, setOpenGroups] = useState({
    accounting: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [invoiceUploadSignal, setInvoiceUploadSignal] = useState(0);
  const [documentUploadSignal, setDocumentUploadSignal] = useState(0);

  const titleMap: Record<string, string> = {
    dashboard: "Dashboard",
    "broker-commission": "Broker Commission",
    "accounting-summary": "Summary",
    "accounting-check-details": "Check Details",
    invoices: "Invoices",
  };

  const renderContent = () => {
    switch (activeKey) {
      case "dashboard":
        return <DashboardView />;
      case "broker-commission":
        return <BrokerCommissionView />;
      case "accounting-summary":
        return <AccountingSummaryView />;
      case "accounting-check-details":
        return <CheckDetailsView />;
      case "invoices":
        return (
          <InvoicesView
            invoiceUploadSignal={invoiceUploadSignal}
            documentUploadSignal={documentUploadSignal}
          />
        );
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      {sidebarOpen && (
        <aside className="w-72 border-r border-slate-200 bg-white px-4 py-6">
          <div className="mb-8 px-3">
            <div className="text-2xl font-extrabold tracking-tight text-slate-900">
              WM-KSOLVE
            </div>
          </div>

          <div className="space-y-2">
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
        </aside>
      )}

      <main className="flex-1 px-6 py-5">
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="rounded-2xl border-slate-200"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSidebarOpen((prev) => !prev);
                }}
              >
                <Menu className="h-4 w-4" />
              </Button>

              <div>
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
                  {titleMap[activeKey] || "WM-KSOLVE"}
                </h1>
                <p className="mt-1 text-sm font-medium text-slate-400">
                  Wednesday, March 25, 2026
                </p>
              </div>
            </div>

            {activeKey === "invoices" && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl border-slate-200"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInvoiceUploadSignal((prev) => prev + 1);
                  }}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Ksolve Invoices
                </Button>

                <Button
                  type="button"
                  className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDocumentUploadSignal((prev) => prev + 1);
                  }}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Files
                </Button>
              </div>
            )}
          </div>
        </div>

        {renderContent()}
      </main>
    </div>
  );
}