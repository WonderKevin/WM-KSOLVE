"use client";

import React, { useEffect, useState } from "react";
import { Download, Play, Save } from "lucide-react";
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

  const [invoiceFileStartDate, setInvoiceFileStartDate] = useState(todayIso());
  const [invoiceFileEndDate, setInvoiceFileEndDate] = useState(todayIso());

  const [summaryStartDate, setSummaryStartDate] = useState(todayIso());
  const [summaryEndDate, setSummaryEndDate] = useState(todayIso());

  const [invoiceFileScheduleDay, setInvoiceFileScheduleDay] =
    useState("monday");
  const [invoiceFileScheduleTime, setInvoiceFileScheduleTime] =
    useState("01:00");

  const [summaryScheduleDay, setSummaryScheduleDay] = useState("monday");
  const [summaryScheduleTime, setSummaryScheduleTime] = useState("01:00");

  const [documents, setDocuments] = useState<KsolveDocument[]>([]);

  useEffect(() => {
    async function loadSchedules() {
      try {
        const response = await fetch("/api/automation/ksolve/schedule");
        const result = await response.json();

        if (!response.ok || !result?.schedules) return;

        const invoiceFile = result.schedules.find(
          (schedule: any) => schedule.id === "invoice-file"
        );

        const invoiceSummary = result.schedules.find(
          (schedule: any) => schedule.id === "invoice-summary"
        );

        if (invoiceFile) {
          setInvoiceFileScheduleDay(invoiceFile.run_day);
          setInvoiceFileScheduleTime(invoiceFile.run_time);
        }

        if (invoiceSummary) {
          setSummaryScheduleDay(invoiceSummary.run_day);
          setSummaryScheduleTime(invoiceSummary.run_time);
        }
      } catch (error) {
        console.error("Failed loading K-Solve schedules:", error);
      }
    }

    loadSchedules();
  }, []);

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
    startDate,
    endDate,
  }: {
    includeInvoiceSummary: boolean;
    includeInvoiceFiles: boolean;
    startDate: string;
    endDate: string;
  }) => {
    if (!startDate || !endDate) {
      alert("Please select a start date and end date.");
      return;
    }

    const label = includeInvoiceSummary ? "Invoice Summary" : "Invoice File";

    try {
      if (includeInvoiceSummary) setRunningInvoiceSummary(true);
      else setRunningInvoiceFile(true);

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

      alert(
        result?.message ||
          `${label} automation was triggered. Check GitHub Actions for progress.`
      );
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
      if (includeInvoiceSummary) setSavingInvoiceSummary(true);
      else setSavingInvoiceFile(true);

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

      alert(
        result?.message ||
          `${label} scheduled for every ${day} at ${time}.`
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : `Failed to save ${label} schedule.`
      );
    } finally {
      setSavingInvoiceFile(false);
      setSavingInvoiceSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">
          K-Solve Automation
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Run K-Solve downloads manually by check date range, or schedule
          recurring uploads.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Manual Run</h3>
            <p className="mt-1 text-sm text-slate-500">
              Select the check date range to download and upload eligible
              documents.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              Invoice File
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Downloads K-Solve invoice documents and ImageIt files for the
              selected check date range.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Start date
                <input
                  type="date"
                  value={invoiceFileStartDate}
                  onChange={(e) => setInvoiceFileStartDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-medium text-slate-700">
                End date
                <input
                  type="date"
                  value={invoiceFileEndDate}
                  onChange={(e) => setInvoiceFileEndDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>
            </div>

            <Button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={() =>
                runAutomation({
                  includeInvoiceSummary: false,
                  includeInvoiceFiles: true,
                  startDate: invoiceFileStartDate,
                  endDate: invoiceFileEndDate,
                })
              }
              disabled={runningInvoiceFile || runningInvoiceSummary}
            >
              <Play className="mr-2 h-4 w-4" />
              {runningInvoiceFile ? "Triggering..." : "Run Invoice File"}
            </Button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              Invoice Summary
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Creates the K-Solve invoice summary spreadsheet and updates the
              invoices table for rows matching the selected check date range.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Start date
                <input
                  type="date"
                  value={summaryStartDate}
                  onChange={(e) => setSummaryStartDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-medium text-slate-700">
                End date
                <input
                  type="date"
                  value={summaryEndDate}
                  onChange={(e) => setSummaryEndDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </label>
            </div>

            <Button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 hover:bg-slate-800"
              onClick={() =>
                runAutomation({
                  includeInvoiceSummary: true,
                  includeInvoiceFiles: false,
                  startDate: summaryStartDate,
                  endDate: summaryEndDate,
                })
              }
              disabled={runningInvoiceFile || runningInvoiceSummary}
            >
              <Play className="mr-2 h-4 w-4" />
              {runningInvoiceSummary
                ? "Triggering..."
                : "Run Invoice Summary"}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              Schedule Upload
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Scheduled uploads run for the last 7 days ending yesterday.
            </p>
          </div>

          <ScheduleCard
            title="Invoice File"
            description="Downloads K-Solve invoice documents and ImageIt files. Example: if this runs Saturday, it processes Friday through the previous Saturday."
            day={invoiceFileScheduleDay}
            time={invoiceFileScheduleTime}
            setDay={setInvoiceFileScheduleDay}
            setTime={setInvoiceFileScheduleTime}
            saving={savingInvoiceFile}
            buttonText="Schedule Invoice File"
            onSave={() =>
              saveSchedule({
                includeInvoiceSummary: false,
                includeInvoiceFiles: true,
                day: invoiceFileScheduleDay,
                time: invoiceFileScheduleTime,
              })
            }
          />

          <ScheduleCard
            title="Invoice Summary"
            description="Schedules the invoice summary export and invoices table update for the last 7 days ending yesterday."
            day={summaryScheduleDay}
            time={summaryScheduleTime}
            setDay={setSummaryScheduleDay}
            setTime={setSummaryScheduleTime}
            saving={savingInvoiceSummary}
            buttonText="Schedule Invoice Summary"
            onSave={() =>
              saveSchedule({
                includeInvoiceSummary: true,
                includeInvoiceFiles: false,
                day: summaryScheduleDay,
                time: summaryScheduleTime,
              })
            }
          />
        </div>
      </div>

      {documents.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">
              Available downloads
            </h3>

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

function ScheduleCard({
  title,
  description,
  day,
  time,
  setDay,
  setTime,
  saving,
  buttonText,
  onSave,
}: {
  title: string;
  description: string;
  day: string;
  time: string;
  setDay: (value: string) => void;
  setTime: (value: string) => void;
  saving: boolean;
  buttonText: string;
  onSave: () => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Run day
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
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
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />
        </label>
      </div>

      <Button
        type="button"
        variant="outline"
        className="mt-6 rounded-2xl border-slate-200"
        onClick={onSave}
        disabled={saving}
      >
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving..." : buttonText}
      </Button>
    </div>
  );
}