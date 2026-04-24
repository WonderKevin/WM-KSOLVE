"use client";

import React from "react";

export default function HomeView() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-3xl font-bold text-slate-900">
          WM-KSOLVE Dashboard
        </h1>
        <p className="text-sm text-slate-500">
          Use the sidebar to navigate between dashboards, reports, and tools.
        </p>

        <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
          <div className="rounded-xl border border-slate-200 p-3">
            📊 Dashboard
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            💰 Commission
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            🧾 Accounting
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            🗄 Database
          </div>
        </div>
      </div>
    </div>
  );
}