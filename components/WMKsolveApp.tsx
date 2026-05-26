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
  Shield,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

import BrokerCommissionSummaryView from "@/components/Views/BrokerCommissionSummaryView";
import BrokerCommissionDataSetsView from "@/components/Views/BrokerCommissionDataSetsView";
import AccountingSummaryView from "@/components/Views/AccountingSummaryView";
import CheckDetailsView from "@/components/Views/CheckDetailsView";
import WMInvoiceDiscrepancyView from "@/components/Views/WMInvoiceDiscrepancyView";
import InvoicesView from "@/components/Views/InvoicesView";
import ProductListView from "@/components/Views/ProductListView";
import LocationsView from "@/components/Views/LocationsView";
import DeductionTypesView from "@/components/Views/DeductionTypesView";
import UserAccountView from "@/components/Views/UserAccountView";
import AutomationView from "@/components/Views/AutomationView";
import KeHeVelocityView from "@/components/Views/KeHeVelocityView";
import KeheDashboardView from "@/components/Views/KeheDashboardView";
import TonyDashboardView from "@/components/Views/TonyDashboardView";
import TonyVelocityView from "@/components/Views/TonyVelocityView";
import HomeView from "@/components/Views/HomeView";
import TargetView from "@/components/Views/TargetView";
import TargetBrokerCommissionView from "@/components/Views/TargetBrokerCommissionView";

type Permissions = {
  email: string;
  can_view_dashboard: boolean;
  can_view_dashboard_kehe?: boolean;
  can_view_dashboard_tony?: boolean;
  can_view_broker_commission_summary: boolean;
  can_view_broker_commission_data_sets: boolean;
  can_view_accounting_summary: boolean;
  can_view_accounting_check_details: boolean;
  can_view_database_ksolve_invoices: boolean;
  can_view_database_target_invoices?: boolean;
  can_view_database_kehe_velocity: boolean;
  can_view_database_tony_velocity?: boolean;
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

  const hasActiveChild = item.children?.some(
    (child: any) => child.key === activeKey
  );

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
          hasActiveChild || isOpen
            ? "bg-slate-100 text-slate-900"
            : "text-slate-700 hover:bg-slate-100"
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
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [activeKey, setActiveKey] = useState("");
  const [openGroups, setOpenGroups] = useState({
    dashboard: false,
    "broker-commission": false,
    accounting: false,
    database: false,
    admin: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [documentUploadSignal, setDocumentUploadSignal] = useState(0);
  const [invoiceUploadSignal, setInvoiceUploadSignal] = useState(0);
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
          can_view_dashboard_kehe: true,
          can_view_dashboard_tony: true,
          can_view_broker_commission_summary: false,
          can_view_broker_commission_data_sets: false,
          can_view_accounting_summary: false,
          can_view_accounting_check_details: false,
          can_view_database_ksolve_invoices: false,
          can_view_database_target_invoices: isAdmin,
          can_view_database_kehe_velocity: false,
          can_view_database_tony_velocity: isAdmin,
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
      if (!session) router.replace("/login");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

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

    return [
      {
        label: "Dashboard",
        icon: LayoutDashboard,
        key: "dashboard",
        children: [
          { label: "Kehe Dashboard", key: "dashboard-kehe" },
          { label: "Tony's Dashboard", key: "dashboard-tony" },
        ],
      },
      {
        label: "Broker Commission",
        icon: Receipt,
        key: "broker-commission",
        children: [
          { label: "Target Broker Commission", key: "target-broker-commission" },
          { label: "KeHe Broker Commission", key: "broker-commission-summary" },
          { label: "KeHe Data Sets", key: "broker-commission-data-sets" },
        ],
      },
      {
        label: "Accounting",
        icon: BadgeDollarSign,
        key: "accounting",
        children: [
          { label: "Summary", key: "accounting-summary" },
          { label: "Check Details", key: "accounting-check-details" },
          {
            label: "WM Invoice Discrepancy",
            key: "accounting-wm-invoice-discrepancy",
          },
        ],
      },
      {
        label: "Database",
        icon: Database,
        key: "database",
        children: [
          { label: "Ksolve Invoices", key: "database-ksolve-invoices" },
          { label: "Target Invoices", key: "database-target-invoices" },
          { label: "KeHe Velocity", key: "database-kehe-velocity" },
          { label: "Tony's Velocity", key: "database-tony-velocity" },
          { label: "Product List", key: "database-product-list" },
          { label: "Locations", key: "database-locations" },
          { label: "Deduction Type", key: "database-deduction-type" },
        ],
      },
      {
        label: "Admin",
        icon: Shield,
        key: "admin",
        children: [
          { label: "User Account", key: "admin-user-account" },
          { label: "Automation", key: "admin-automation" },
        ],
      },
    ];
  }, [permissions]);

  const renderContent = () => {
    switch (activeKey) {
      case "dashboard-kehe":
        return <KeheDashboardView />;
      case "dashboard-tony":
        return <TonyDashboardView />;
      case "target-broker-commission":
        return <TargetBrokerCommissionView />;
      case "broker-commission-summary":
        return <BrokerCommissionSummaryView />;
      case "broker-commission-data-sets":
        return <BrokerCommissionDataSetsView />;
      case "accounting-summary":
        return <AccountingSummaryView />;
      case "accounting-check-details":
        return <CheckDetailsView />;
      case "accounting-wm-invoice-discrepancy":
        return <WMInvoiceDiscrepancyView />;
      case "database-ksolve-invoices":
        return (
          <InvoicesView
            invoiceUploadSignal={invoiceUploadSignal}
            documentUploadSignal={documentUploadSignal}
            canReprocess={!!permissions?.can_reprocess_invoices}
            isAdmin={userEmail.toLowerCase() === "kevin@wondermonday.com"}
          />
        );
      case "database-target-invoices":
        return <TargetView />;
      case "database-kehe-velocity":
        return <KeHeVelocityView />;
      case "database-tony-velocity":
        return <TonyVelocityView />;
      case "database-product-list":
        return <ProductListView />;
      case "database-locations":
        return <LocationsView />;
      case "database-deduction-type":
        return <DeductionTypesView />;
      case "admin-user-account":
        return <UserAccountView />;
      case "admin-automation":
        return <AutomationView />;
      default:
        return <HomeView />;
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

      <main className="flex-1 h-screen overflow-y-auto">
        <div
          id="app-main-header"
          className="sticky top-0 z-30 border-b border-slate-200 bg-slate-100 px-6 pb-4 pt-5"
        >
          <div className="rounded-3xl border border-slate-200 bg-white/95 px-6 py-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
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
                    WM-KSOLVE
                  </h1>
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
                      onClick={() =>
                        setDocumentUploadSignal((prev) => prev + 1)
                      }
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
        </div>

        <div className="px-6 py-5">{renderContent()}</div>
      </main>
    </div>
  );
}