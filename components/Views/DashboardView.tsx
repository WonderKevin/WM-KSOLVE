"use client";

import { Card, CardContent } from "@/components/ui/card";

export default function DashboardView() {
  return (
    <Card className="rounded-3xl">
      <CardContent>
        <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">
          Dashboard
        </div>
      </CardContent>
    </Card>
  );
}