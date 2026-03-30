"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Database,
  LayoutDashboard,
  Receipt,
  Upload,
  BadgeDollarSign,
  Menu,
  LogOut,
  BarChart3,
  Shield,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import DashboardView from "@/components/Views/DashboardView";
import BrokerCommissionView from "@/components/Views/BrokerCommissionView";
import BrokerCommissionDataSetsView from "@/components/Views/BrokerCommissionDataSetsView";
import AccountingSummaryView from "@/components/Views/AccountingSummaryView";
import CheckDetailsView from "@/components/Views/CheckDetailsView";
import InvoicesView from "@/components/Views/InvoicesView";
import ProductListView from "@/components/Views/ProductListView";
import LocationsView from "@/components/Views/LocationsView";
import DeductionTypesView from "@/components/Views/DeductionTypesView";
import UserAccountView from "@/components/Views/UserAccountView";
import KeHeVelocityView from "@/components/Views/KeHeVelocityView";

type Permissions = {
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
};

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

function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-lg font-semibold text-slate-900">{title}</div>
      <p className="mt-2 text-sm text-slate-500">This page is ready for the next build.</p>
    </div>
  );
}

export default function WMKsolveApp() {
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [activeKey, setActiveKey] = useState("dashboard");
  const [openGroups, setOpenGroups] = useState({
    "broker-commission": false,
    accounting: false,
    reporting: false,
    database: false,
    admin: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [invoiceUploadSignal, setInvoiceUploadSignal] = useState(0);
  const [documentUploadSignal, setDocumentUploadSignal] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [permissions, setPermissions] = useState<Permissions | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session) {
        router.replace("/login");
        return;
      }

      const email = session.user.email || "";
      setUserEmail(email);

      const { data: permissionRow } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      const isAdmin = email.toLowerCase() === "kevin@wondermonday.com";

      setPermissions(
        permissionRow || {
          email,
          can_view_dashboard: true,

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

          can_view_admin: isAdmin,
          can_view_user_account: isAdmin,

          can_reprocess_invoices: isAdmin,
        }
      );

      setCheckingSession(false);
    };

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!permissions) return;

    const allowedKeys: string[] = [];

    if (permissions.can_view_dashboard) allowedKeys.push("dashboard");
    if (permissions.can_view_broker_commission_summary) allowedKeys.push("broker-commission-summary");
    if (permissions.can_view_broker_commission_data_sets) allowedKeys.push("broker-commission-data-sets");
    if (permissions.can_view_accounting_summary) allowedKeys.push("accounting-summary");
    if (permissions.can_view_accounting_check_details) allowedKeys.push("accounting-check-details");
    if (permissions.can_view_reporting_report_xxx) allowedKeys.push("reporting-report-xxx");
    if (permissions.can_view_database_ksolve_invoices) allowedKeys.push("database-ksolve-invoices");
    if (permissions.can_view_database_kehe_velocity) allowedKeys.push("database-kehe-velocity");
    if (permissions.can_view_database_product_list) allowedKeys.push("database-product-list");
    if (permissions.can_view_database_locations) allowedKeys.push("database-locations");
    if (permissions.can_view_database_deduction_type) allowedKeys.push("database-deduction-type");
    if (permissions.can_view_user_account) allowedKeys.push("admin-user-account");

    if (!allowedKeys.includes(activeKey)) {
      setActiveKey(allowedKeys[0] || "dashboard");
    }
  }, [permissions, activeKey]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  const sidebarItems = useMemo(() => {
    if (!permissions) return [];

    const items: any[] = [];

    if (permissions.can_view_dashboard) {
      items.push({ label: "Dashboard", icon: LayoutDashboard, key: "dashboard" });
    }

    const brokerChildren = [
      permissions.can_view_broker_commission_summary
        ? { label: "Broker Commission Summary", key: "broker-commission-summary" }
        : null,
      permissions.can_view_broker_commission_data_sets
        ? { label: "Data Sets", key: "broker-commission-data-sets" }
        : null,
    ].filter(Boolean);

    if (brokerChildren.length) {
      items.push({
        label: "Broker Commission",
        icon: Receipt,
        key: "broker-commission",
        children: brokerChildren,
      });
    }

    const accountingChildren = [
      permissions.can_view_accounting_summary
        ? { label: "Summary", key: "accounting-summary" }
        : null,
      permissions.can_view_accounting_check_details
        ? { label: "Check Details", key: "accounting-check-details" }
        : null,
    ].filter(Boolean);

    if (accountingChildren.length) {
      items.push({
        label: "Accounting",
        icon: BadgeDollarSign,
        key: "accounting",
        children: accountingChildren,
      });
    }

    const reportingChildren = [
      permissions.can_view_reporting_report_xxx
        ? { label: "Report XXX", key: "reporting-report-xxx" }
        : null,
    ].filter(Boolean);

    if (reportingChildren.length) {
      items.push({
        label: "Reporting",
        icon: BarChart3,
        key: "reporting",
        children: reportingChildren,
      });
    }

    const databaseChildren = [
      permissions.can_view_database_ksolve_invoices
        ? { label: "Ksolve Invoices", key: "database-ksolve-invoices" }
        : null,
      permissions.can_view_database_kehe_velocity
        ? { label: "KeHe Velocity", key: "database-kehe-velocity" }
        : null,
      permissions.can_view_database_product_list
        ? { label: "Product List", key: "database-product-list" }
        : null,
      permissions.can_view_database_locations
        ? { label: "Locations", key: "database-locations" }
        : null,
      permissions.can_view_database_deduction_type
        ? { label: "Deduction Type", key: "database-deduction-type" }
        : null,
    ].filter(Boolean);

    if (databaseChildren.length) {
      items.push({
        label: "Database",
        icon: Database,
        key: "database",
        children: databaseChildren,
      });
    }

    const adminChildren = [
      permissions.can_view_user_account
        ? { label: "User Account", key: "admin-user-account" }
        : null,
    ].filter(Boolean);

    if (permissions.can_view_admin && adminChildren.length) {
      items.push({
        label: "Admin",
        icon: Shield,
        key: "admin",
        children: adminChildren,
      });
    }

    return items;
  }, [permissions]);

  const titleMap: Record<string, string> = {
    dashboard: "Dashboard",
    "broker-commission-summary": "Broker Commission Summary",
    "broker-commission-data-sets": "Data Sets",
    "accounting-summary": "Summary",
    "accounting-check-details": "Check Details",
    "reporting-report-xxx": "Report XXX",
    "database-ksolve-invoices": "Ksolve Invoices",
    "database-kehe-velocity": "KeHe Velocity",
    "database-product-list": "Product List",
    "database-locations": "Locations",
    "database-deduction-type": "Deduction Type",
    "admin-user-account": "User Account",
  };

  const renderContent = () => {
    switch (activeKey) {
      case "dashboard":
        return <DashboardView />;
      case "broker-commission-summary":
        return <BrokerCommissionView />;
      case "broker-commission-data-sets":
        return <BrokerCommissionDataSetsView />;
      case "accounting-summary":
        return <AccountingSummaryView />;
      case "accounting-check-details":
        return <CheckDetailsView />;
      case "reporting-report-xxx":
        return <PlaceholderView title="Report XXX" />;
      case "database-ksolve-invoices":
        return (
          <InvoicesView
            invoiceUploadSignal={invoiceUploadSignal}
            documentUploadSignal={documentUploadSignal}
            canReprocess={!!permissions?.can_reprocess_invoices}
            isAdmin={userEmail.toLowerCase() === "kevin@wondermonday.com"}
          />
        );
        case "database-kehe-velocity":
          return <KeHeVelocityView />;
      case "database-product-list":
        return <ProductListView />;
      case "database-locations":
        return <LocationsView />;
      case "database-deduction-type":
        return <DeductionTypesView />;
      case "admin-user-account":
        return <UserAccountView />;
      default:
        return <DashboardView />;
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-500 shadow-sm">
          Checking session...
        </div>
      </div>
    );
  }

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

            <div className="flex items-center gap-3">
              {activeKey === "database-ksolve-invoices" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl border-slate-200"
                    onClick={() => setInvoiceUploadSignal((prev) => prev + 1)}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Ksolve Invoices
                  </Button>

                  <Button
                    type="button"
                    className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                    onClick={() => setDocumentUploadSignal((prev) => prev + 1)}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Files
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {loggingOut ? "Logging out..." : "Logout"}
              </Button>
            </div>
          </div>
        </div>

        {renderContent()}
      </main>
    </div>
  );
}