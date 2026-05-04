"use client";

import React, { useState } from "react";
import { CalendarClock, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AutomationView() {
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());

  const [scheduleDay, setScheduleDay] = useState("monday");
  const [scheduleTime, setScheduleTime] = useState("08:00");

  const runAutomation = async () => {
    if (!startDate || !endDate) {
      alert("Please select a start date and end date.");
      return;
    }

    const confirmed = window.confirm(
      `Run K-Solve automation for check dates from ${startDate} to ${endDate}?`
    );

    if (!confirmed) return;

    try {
      setRunning(true);

      const response = await fetch("/api/automation/ksolve/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.message || "Automation failed.");
      }

      alert(result?.message || "K-Solve automation started.");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to start K-Solve automation.");
    } finally {
      setRunning(false);
    }
  };

  const saveSchedule = async () => {
    try {
      setSaving(true);

      const response = await fetch("/api/automation/ksolve/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: scheduleDay, time: scheduleTime }),
      });

      if (!response.ok) throw new Error(await response.text());

      alert(`Schedule saved: every ${scheduleDay} at ${scheduleTime}`);
    } catch (error) {
      console.error(error);
      alert("Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">K-Solve Automation</h2>
        <p className="mt-2 text-sm text-slate-500">
          Run the K-Solve document automation manually by check date range, or schedule weekly uploads.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Manual Run</h3>
          <p className="mt-1 text-sm text-slate-500">
            Select the check date range to download and upload eligible documents.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              End date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
              />
            </label>
          </div>

          <Button
            type="button"
            className="mt-6 rounded-2xl bg-slate-900 hover:bg-slate-800"
            onClick={runAutomation}
            disabled={running}
          >
            <Play className="mr-2 h-4 w-4" />
            {running ? "Running..." : "Run"}
          </Button>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Schedule Upload</h3>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Run day
              <select
                value={scheduleDay}
                onChange={(e) => setScheduleDay(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
              >
                <option value="monday">Every Monday</option>
                <option value="tuesday">Every Tuesday</option>
                <option value="wednesday">Every Wednesday</option>
                <option value="thursday">Every Thursday</option>
                <option value="friday">Every Friday</option>
                <option value="saturday">Every Saturday</option>
                <option value="sunday">Every Sunday</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Run time
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
              />
            </label>
          </div>

          <Button
            type="button"
            variant="outline"
            className="mt-6 rounded-2xl border-slate-200"
            onClick={saveSchedule}
            disabled={saving}
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Schedule Upload"}
          </Button>
        </div>
      </div>
    </div>
  );
}