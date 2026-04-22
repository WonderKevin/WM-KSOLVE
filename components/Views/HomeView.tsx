"use client";

import React from "react";

export default function HomeView() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <img
        src="/wondermonday-logo.png"
        alt="Wonder Monday"
        className="h-auto w-full max-w-[520px] object-contain"
      />
    </div>
  );
}