"use client";

import React, { useMemo, useState } from "react";

import DashboardView from "@/components/Views/DashboardView";
import KeheDashboardView from "@/components/Views/KeheDashboardView";
import TonyDashboardView from "@/components/Views/TonyDashboardView";

import BrokerCommissionSummaryView from "@/components/Views/BrokerCommissionSummaryView";
import BrokerCommissionDataSetsView from "@/components/Views/BrokerCommissionDataSetsView";

import InvoicesView from "@/components/Views/InvoicesView";
import KeHeVelocityView from "@/components/Views/KeHeVelocityView";
import TonyVelocityView from "@/components/Views/TonyVelocityView";
import ProductListView from "@/components/Views/ProductListView";
import LocationsView from "@/components/Views/LocationsView";
import DeductionTypesView from "@/components/Views/DeductionTypesView";

import AccountingSummaryView from "@/components/Views/AccountingSummaryView";
import CheckDetailsView from "@/components/Views/CheckDetailsView";

import UserAccountView from "@/components/Views/UserAccountView";

import TargetView from "@/components/Views/TargetView";
import TargetBrokerCommissionView from "@/components/Views/TargetBrokerCommissionView";

import {
  ChevronDown,
  ChevronRight,
  Database,
  LayoutDashboard,
  Shield,
  Wallet,
  LogOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type MenuKey =
  | "dashboard"
  | "kehe-dashboard"
  | "tony-dashboard"
  | "broker-commission-summary"
  | "broker-commission-datasets"
  | "target-broker-commission"
  | "ksolve-invoices"
  | "target-invoices"
  | "kehe-velocity"
  | "tony-velocity"
  | "product-list"
  | "locations"
  | "deduction-types"
  | "summary"
  | "check-details"
  | "user-account";

export default function WMKsolveApp() {
  const [selectedView, setSelectedView] =
    useState<MenuKey>("dashboard");

  const [openSections, setOpenSections] = useState({
    dashboard: true,
    broker: true,
    database: true,
    accounting: true,
    admin: true,
  });

  const toggleSection = (
    section:
      | "dashboard"
      | "broker"
      | "database"
      | "accounting"
      | "admin"
  ) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderView = useMemo(() => {
    switch (selectedView) {
      case "dashboard":
        return <DashboardView />;

      case "kehe-dashboard":
        return <KeheDashboardView />;

      case "tony-dashboard":
        return <TonyDashboardView />;

      case "broker-commission-summary":
        return <BrokerCommissionSummaryView />;

      case "broker-commission-datasets":
        return <BrokerCommissionDataSetsView />;

      case "target-broker-commission":
        return <TargetBrokerCommissionView />;

      case "ksolve-invoices":
        return <InvoicesView />;

      case "target-invoices":
        return <TargetView />;

      case "kehe-velocity":
        return <KeHeVelocityView />;

      case "tony-velocity":
        return <TonyVelocityView />;

      case "product-list":
        return <ProductListView />;

      case "locations":
        return <LocationsView />;

      case "deduction-types":
        return <DeductionTypesView />;

      case "summary":
        return <AccountingSummaryView />;

      case "check-details":
        return <CheckDetailsView />;

      case "user-account":
        return <UserAccountView />;

      default:
        return <DashboardView />;
    }
  }, [selectedView]);

  const menuButtonClass =
    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition hover:bg-slate-100";

  const subMenuButtonClass =
    "w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-100";

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="w-[300px] border-r border-slate-200 bg-white p-5">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            WM-KSOLVE
          </h1>
        </div>

        <div className="space-y-3">
          {/* DASHBOARD */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50">
            <button
              onClick={() => toggleSection("dashboard")}
              className={menuButtonClass}
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
              </div>

              {openSections.dashboard ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {openSections.dashboard && (
              <div className="space-y-1 px-2 pb-2">
                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("dashboard")
                  }
                >
                  Dashboard
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("kehe-dashboard")
                  }
                >
                  Kehe Dashboard
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("tony-dashboard")
                  }
                >
                  Tony&apos;s Dashboard
                </button>
              </div>
            )}
          </div>

          {/* BROKER */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50">
            <button
              onClick={() => toggleSection("broker")}
              className={menuButtonClass}
            >
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                <span>Broker Commission</span>
              </div>

              {openSections.broker ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {openSections.broker && (
              <div className="space-y-1 px-2 pb-2">
                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView(
                      "target-broker-commission"
                    )
                  }
                >
                  Target Broker Commission
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView(
                      "broker-commission-summary"
                    )
                  }
                >
                  Kehe Broker Commission
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView(
                      "broker-commission-datasets"
                    )
                  }
                >
                  KeHe Data Sets
                </button>
              </div>
            )}
          </div>

          {/* DATABASE */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50">
            <button
              onClick={() => toggleSection("database")}
              className={menuButtonClass}
            >
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                <span>Database</span>
              </div>

              {openSections.database ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {openSections.database && (
              <div className="space-y-1 px-2 pb-2">
                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("ksolve-invoices")
                  }
                >
                  Ksolve Invoices
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("target-invoices")
                  }
                >
                  Target Invoices
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("kehe-velocity")
                  }
                >
                  KeHe Velocity
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("tony-velocity")
                  }
                >
                  Tony&apos;s Velocity
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("product-list")
                  }
                >
                  Product List
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("locations")
                  }
                >
                  Locations
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("deduction-types")
                  }
                >
                  Deduction Type
                </button>
              </div>
            )}
          </div>

          {/* ACCOUNTING */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50">
            <button
              onClick={() => toggleSection("accounting")}
              className={menuButtonClass}
            >
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                <span>Accounting</span>
              </div>

              {openSections.accounting ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {openSections.accounting && (
              <div className="space-y-1 px-2 pb-2">
                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("summary")
                  }
                >
                  Summary
                </button>

                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("check-details")
                  }
                >
                  Check Details
                </button>
              </div>
            )}
          </div>

          {/* ADMIN */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50">
            <button
              onClick={() => toggleSection("admin")}
              className={menuButtonClass}
            >
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span>Admin</span>
              </div>

              {openSections.admin ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {openSections.admin && (
              <div className="space-y-1 px-2 pb-2">
                <button
                  className={subMenuButtonClass}
                  onClick={() =>
                    setSelectedView("user-account")
                  }
                >
                  User Account
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10">
          <Button
            variant="outline"
            className="w-full rounded-2xl border-red-200 text-red-600 hover:bg-red-50"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {renderView}
      </main>
    </div>
  );
}