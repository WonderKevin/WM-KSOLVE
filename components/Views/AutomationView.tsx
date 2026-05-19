"use client";

import { useState } from "react";

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
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());

  const [manualInvoiceSummary, setManualInvoiceSummary] = useState(true);
  const [manualInvoiceFile, setManualInvoiceFile] = useState(true);

  const [scheduleInvoiceSummary, setScheduleInvoiceSummary] = useState(true);
  const [scheduleInvoiceFile, setScheduleInvoiceFile] = useState(true);

  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<KsolveDocument[]>([]);
  const [message, setMessage] = useState("");

  async function runAutomation() {
    try {
      setLoading(true);
      setMessage("");
      setDocuments([]);

      const response = await fetch("/api/automation/ksolve/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          includeInvoiceSummary: manualInvoiceSummary,
          includeInvoiceFiles: manualInvoiceFile,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || "Automation failed.");
      }

      setDocuments(result?.result?.documents || []);
      setMessage(result?.message || "K-Solve automation completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Automation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runScheduleUpload() {
    try {
      setLoading(true);
      setMessage("");
      setDocuments([]);

      const response = await fetch("/api/automation/ksolve/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          includeInvoiceSummary: scheduleInvoiceSummary,
          includeInvoiceFiles: scheduleInvoiceFile,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || "Scheduled upload failed.");
      }

      setDocuments(result?.result?.documents || []);
      setMessage(result?.message || "Scheduled upload completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Scheduled upload failed."
      );
    } finally {
      setLoading(false);
    }
  }

  function downloadAll() {
    documents.forEach((document, index) => {
      const url = document.SignedUrl || document.DocumentLink;

      if (!url) return;

      setTimeout(() => {
        window.open(url, "_blank");
      }, index * 500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Manual Run</h2>
          <p className="mt-1 text-sm text-gray-500">
            Select the check date range to download and upload eligible
            documents.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Start date
            <input
              type="date"
              className="mt-2 w-full rounded-xl border px-4 py-3"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>

          <label className="text-sm font-medium">
            End date
            <input
              type="date"
              className="mt-2 w-full rounded-xl border px-4 py-3"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>

        <div className="rounded-xl border bg-gray-50 p-4">
          <div className="mb-3 text-sm font-semibold">Manual options</div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={manualInvoiceSummary}
                onChange={(event) =>
                  setManualInvoiceSummary(event.target.checked)
                }
              />
              Invoice Summary
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={manualInvoiceFile}
                onChange={(event) => setManualInvoiceFile(event.target.checked)}
              />
              Invoice File
            </label>
          </div>
        </div>

        <button
          onClick={runAutomation}
          disabled={loading}
          className="rounded-xl bg-black px-5 py-3 text-white disabled:opacity-50"
        >
          {loading ? "Running..." : "Run"}
        </button>
      </div>

      <div className="rounded-2xl border bg-white p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Schedule Upload</h2>
          <p className="mt-1 text-sm text-gray-500">
            Runs previous Monday through Sunday.
          </p>
        </div>

        <div className="rounded-xl border bg-gray-50 p-4">
          <div className="mb-3 text-sm font-semibold">Schedule options</div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scheduleInvoiceSummary}
                onChange={(event) =>
                  setScheduleInvoiceSummary(event.target.checked)
                }
              />
              Invoice Summary
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scheduleInvoiceFile}
                onChange={(event) =>
                  setScheduleInvoiceFile(event.target.checked)
                }
              />
              Invoice File
            </label>
          </div>
        </div>

        <button
          onClick={runScheduleUpload}
          disabled={loading}
          className="rounded-xl border px-5 py-3 disabled:opacity-50"
        >
          {loading ? "Running..." : "Schedule Upload"}
        </button>
      </div>

      {message && (
        <div className="rounded-xl bg-gray-100 p-4 text-sm">{message}</div>
      )}

      {documents.length > 0 && (
        <div className="rounded-2xl border bg-white p-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-semibold">Available downloads</h3>

            <button
              onClick={downloadAll}
              className="rounded-xl bg-blue-600 px-5 py-3 text-white"
            >
              Download All
            </button>
          </div>

          <div className="space-y-4">
            {documents.map((document) => {
              const url = document.SignedUrl || document.DocumentLink;

              return (
                <div
                  key={`${document.DocumentDisplayName}-${document.CreatedOn}`}
                  className="rounded-2xl border p-5"
                >
                  <div className="font-medium break-all">
                    {document.DocumentDisplayName}
                  </div>

                  <div className="mt-1 text-sm text-gray-500">
                    {document.DocumentType} • {document.FileSizeDisplayable}
                  </div>

                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex rounded-xl bg-black px-4 py-2 text-white"
                    >
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