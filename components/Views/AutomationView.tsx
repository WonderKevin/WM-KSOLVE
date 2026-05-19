"use client";

import React, { useState } from "react";
import { Download, FileSpreadsheet, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

type KsolveDocument = {
  DocumentLink: string;
  DocumentType: string;
  DocumentDisplayName: string;
  FileSizeInBytes: number;
  CreatedOn: string;
  FileSizeDisplayable: string;
  StoragePath?: string;
  SignedUrl?: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AutomationView() {
  const [runningInvoiceFile, setRunningInvoiceFile] = useState(false);
  const [runningInvoiceSummary, setRunningInvoiceSummary] = useState(false);
  const [savingInvoiceFile, setSavingInvoiceFile] = useState(false);
  const [savingInvoiceSummary, setSavingInvoiceSummary] = useState(false);

  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());

  const [invoiceFileScheduleDay, setInvoiceFileScheduleDay] = useState("monday");
  const [invoiceFileScheduleTime, setInvoiceFileScheduleTime] = useState("01:00");

  const [summaryScheduleDay, setSummaryScheduleDay] = useState("monday");
  const [summaryScheduleTime, setSummaryScheduleTime] = useState("01:00");

  const [documents, setDocuments] = useState<KsolveDocument[]>([]);

  const downloadAll = () => {
    documents.forEach((document, index) => {
      const url = document.SignedUrl || document.DocumentLink;
      if (!url) return;

      setTimeout(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }, index * 500);
    });
  };

  const runAutomation = async ({
    includeInvoiceSummary,
    includeInvoiceFiles,
  }: {
    includeInvoiceSummary: boolean;
    includeInvoiceFiles: boolean;
  }) => {
    if (!startDate || !endDate) {
      alert("Please select a start date and end date.");
      return;
    }

    const label = includeInvoiceSummary ? "Invoice Summary" : "Invoice File";

    const confirmed = window.confirm(
      `Run ${label} for check dates from ${startDate} to ${endDate}?`
    );

    if (!confirmed) return;

    try {
      if (includeInvoiceSummary) {
        setRunningInvoiceSummary(true);
      } else {
        setRunningInvoiceFile(true);
      }

      setDocuments([]);

      const response = await fetch("/api/automation/ksolve/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          includeInvoiceSummary,
          includeInvoiceFiles,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.message || "Automation failed.");
      }

      setDocuments(result?.result?.documents || []);

      alert(result?.message || `${label} completed.`);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : `Failed to run ${label}.`);
    } finally {
      setRunningInvoiceFile(false);
      setRunningInvoiceSummary(false);
    }
  };

  const saveSchedule = async ({
    includeInvoiceSummary,
    includeInvoiceFiles,
    day,
    time,
  }: {
    includeInvoiceSummary: boolean;
    includeInvoiceFiles: boolean;
    day: string;
    time: string;
  }) => {
    const label = includeInvoiceSummary ? "Invoice Summary" : "Invoice File";

    try {
      if (includeInvoiceSummary) {
        setSavingInvoiceSummary(true);
      } else {
        setSavingInvoiceFile(true);
      }

      const response = await fetch("/api/automation/ksolve/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          time,
          includeInvoiceSummary,
          includeInvoiceFiles,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.message || "Failed to save schedule.");
      }

      setDocuments(result?.result?.documents || []);

      alert(result?.message || `${label} schedule saved: every ${day} at ${time}`);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : `Failed to save ${label} schedule.`);
    } finally {
      setSavingInvoiceFile(false);
      setSavingInvoiceSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">K-Solve Automation</h2>
        <p className="mt-2 text-sm text-slate-500">
          Run K-Solve downloads manually by check date range, or schedule weekly uploads.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
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
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="mt-1 h-5 w-5 text-slate-700" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Invoice File</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Download invoice files only. Supporting documents are ignored.
                </p>
              </div>
            </div>

            <Button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={() =>
                runAutomation({
                  includeInvoiceSummary: false,
                  includeInvoiceFiles: true,
                })
              }
              disabled={runningInvoiceFile || runningInvoiceSummary}
            >
              <Play className="mr-2 h-4 w-4" />
              {runningInvoiceFile ? "Running..." : "Run Invoice File"}
            </Button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="mt-1 h-5 w-5 text-slate-700" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Invoice Summary</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Generate the invoice summary spreadsheet from rows matching the selected check date range.
                </p>
              </div>
            </div>

            <Button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={() =>
                runAutomation({
                  includeInvoiceSummary: true,
                  includeInvoiceFiles: false,
                })
              }
              disabled={runningInvoiceFile || runningInvoiceSummary}
            >
              <Play className="mr-2 h-4 w-4" />
              {runningInvoiceSummary ? "Running..." : "Run Invoice Summary"}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Schedule Upload</h3>
            <p className="mt-1 text-sm text-slate-500">
              Scheduled uploads run for the previous Monday through Sunday.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Invoice File</h3>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Run day
                <select
                  value={invoiceFileScheduleDay}
                  onChange={(e) => setInvoiceFileScheduleDay(e.target.value)}
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
                  value={invoiceFileScheduleTime}
                  onChange={(e) => setInvoiceFileScheduleTime(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-6 rounded-2xl border-slate-200"
              onClick={() =>
                saveSchedule({
                  includeInvoiceSummary: false,
                  includeInvoiceFiles: true,
                  day: invoiceFileScheduleDay,
                  time: invoiceFileScheduleTime,
                })
              }
              disabled={savingInvoiceFile || savingInvoiceSummary}
            >
              <Save className="mr-2 h-4 w-4" />
              {savingInvoiceFile ? "Saving..." : "Schedule Invoice File"}
            </Button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Invoice Summary</h3>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Run day
                <select
                  value={summaryScheduleDay}
                  onChange={(e) => setSummaryScheduleDay(e.target.value)}
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
                  value={summaryScheduleTime}
                  onChange={(e) => setSummaryScheduleTime(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-6 rounded-2xl border-slate-200"
              onClick={() =>
                saveSchedule({
                  includeInvoiceSummary: true,
                  includeInvoiceFiles: false,
                  day: summaryScheduleDay,
                  time: summaryScheduleTime,
                })
              }
              disabled={savingInvoiceFile || savingInvoiceSummary}
            >
              <Save className="mr-2 h-4 w-4" />
              {savingInvoiceSummary ? "Saving..." : "Schedule Invoice Summary"}
            </Button>
          </div>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">Available downloads</h3>

            <Button
              type="button"
              className="rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={downloadAll}
            >
              <Download className="mr-2 h-4 w-4" />
              Download all
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {documents.map((document) => {
              const url = document.SignedUrl || document.DocumentLink;

              return (
                <div
                  key={`${document.DocumentDisplayName}-${document.CreatedOn}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {document.DocumentDisplayName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {document.DocumentType} • {document.FileSizeDisplayable}
                  </p>

                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download document
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}